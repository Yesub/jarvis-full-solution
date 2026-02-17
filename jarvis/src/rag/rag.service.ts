import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { OllamaService } from '../ollama/ollama.service';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import type { RagPayload } from './rag.types';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly defaultTopK: number;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly vs: VectorstoreService,
  ) {
    this.chunkSize = Number(this.config.get('CHUNK_SIZE') ?? 1000);
    this.chunkOverlap = Number(this.config.get('CHUNK_OVERLAP') ?? 150);
    this.defaultTopK = Number(this.config.get('RAG_TOP_K') ?? 5);
  }

  private splitter() {
    return new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });
  }

  async ingestFile(filePath: string, originalName: string) {
    try {
      const ext = extname(originalName).toLowerCase();
      let fullText = '';

      if (ext === '.pdf') {
        const loader = new PDFLoader(filePath);
        const docs = await loader.load();
        fullText = docs.map((d) => d.pageContent).join('\n');
      } else {
        fullText = (await readFile(filePath)).toString('utf-8');
      }

      const split = this.splitter();
      const chunks = await split.splitText(fullText);

      const probe = await this.ollama.embed(['dimension probe']);
      const dim = probe[0].length;
      await this.vs.ensureCollection(dim);

      const batchSize = 64;
      let upserted = 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await this.ollama.embed(batch);

        const points = batch.map((text, j) => ({
          id: uuidv4(),
          vector: vectors[j],
          payload: {
            source: originalName,
            chunkIndex: i + j,
            text,
          } satisfies RagPayload,
        }));

        await this.vs.upsert(points);
        upserted += points.length;
      }

      return { source: originalName, chunks: chunks.length, upserted };
    } catch (error) {
      this.logger.error(`Ingestion échouée pour ${originalName}`, error);
      throw new InternalServerErrorException("L'ingestion du fichier a échoué");
    }
  }

  async ingestText(
    text: string,
    source: string = 'manual-input',
    contextType: string = 'memory',
    eventDate?: string,
  ): Promise<{ source: string; chunks: number; upserted: number }> {
    try {
      const split = this.splitter();
      const chunks = await split.splitText(text);

      const probe = await this.ollama.embed(['dimension probe']);
      const dim = probe[0].length;
      await this.vs.ensureMemoryCollection(dim);

      const batchSize = 64;
      const addedAt = new Date().toISOString();
      let upserted = 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await this.ollama.embed(batch);

        const points = batch.map((chunkText, j) => ({
          id: uuidv4(),
          vector: vectors[j],
          payload: {
            source,
            chunkIndex: i + j,
            text: chunkText,
            addedAt,
            contextType,
            ...(eventDate !== undefined ? { eventDate } : {}),
          } satisfies RagPayload,
        }));

        await this.vs.upsertMemory(points);
        upserted += points.length;
      }

      return { source, chunks: chunks.length, upserted };
    } catch (error) {
      this.logger.error(`Ingestion texte échouée pour "${source}"`, error);
      throw new InternalServerErrorException("L'ingestion du texte a échoué");
    }
  }

  async askStream(
    question: string,
    topK?: number,
  ): Promise<{
    sources: string[];
    topK: number;
    tokenStream: AsyncGenerator<string>;
  }> {
    const k = topK ?? this.defaultTopK;
    const [qVec] = await this.ollama.embed([question]);
    const hits = await this.vs.search(qVec, k);

    const contexts = (hits ?? [])
      .map((h, idx) => {
        const p = h.payload as RagPayload;
        return `# Extrait ${idx + 1} (source: ${p.source}, chunk: ${p.chunkIndex})\n${p.text}`;
      })
      .join('\n\n');

    const system = `Tu es un assistant expert du domaine.
Réponds en français.
Utilise PRIORITAIREMENT le contexte fourni.
Si le contexte ne contient pas la réponse, dis-le explicitement.`;

    const prompt = `Contexte:\n${contexts}\n\nQuestion:\n${question}\n\nRéponse:`;

    return {
      sources: hits.map((h) => (h.payload as RagPayload)?.source),
      topK: k,
      tokenStream: this.ollama.generateStream(prompt, system),
    };
  }

  async ask(question: string, topK?: number) {
    const k = topK ?? this.defaultTopK;
    const [qVec] = await this.ollama.embed([question]);
    const hits = await this.vs.search(qVec, k);

    const contexts = (hits ?? [])
      .map((h, idx) => {
        const p = h.payload as RagPayload;
        return `# Extrait ${idx + 1} (source: ${p.source}, chunk: ${p.chunkIndex})\n${p.text}`;
      })
      .join('\n\n');

    const system = `Tu es un assistant expert du domaine.
Réponds en français.
Utilise PRIORITAIREMENT le contexte fourni.
Si le contexte ne contient pas la réponse, dis-le explicitement.`;

    const prompt = `Contexte:\n${contexts}\n\nQuestion:\n${question}\n\nRéponse:`;
    const answer = await this.ollama.generate(prompt, system);

    return {
      answer,
      topK: k,
      sources: hits.map((h) => (h.payload as RagPayload)?.source),
    };
  }
}
