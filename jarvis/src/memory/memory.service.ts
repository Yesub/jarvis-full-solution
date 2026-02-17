import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { OllamaService } from '../ollama/ollama.service';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import { TemporalService } from '../temporal/temporal.service';
import type { RagPayload } from '../rag/rag.types';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly defaultTopK: number;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly vs: VectorstoreService,
    private readonly temporal: TemporalService,
  ) {
    this.defaultTopK = Number(this.config.get('RAG_TOP_K') ?? 5);
  }

  async add(text: string, source = 'manual-input', contextType = 'memory') {
    try {
      const temporalResult = this.temporal.parse(text);
      const eventDate = temporalResult?.resolvedDate;

      const [vector] = await this.ollama.embed([text]);
      await this.vs.ensureMemoryCollection(vector.length);

      const addedAt = new Date().toISOString();
      await this.vs.upsertMemory([
        {
          id: uuidv4(),
          vector,
          payload: {
            source,
            chunkIndex: 0,
            text,
            addedAt,
            contextType,
            ...(eventDate !== undefined ? { eventDate } : {}),
          } satisfies RagPayload,
        },
      ]);

      return {
        source,
        upserted: 1,
        ...(temporalResult !== null
          ? {
              eventDate: temporalResult.resolvedDate,
              expression: temporalResult.expression,
            }
          : {}),
      };
    } catch (error) {
      this.logger.error(`Ajout mémoire échoué pour "${source}"`, error);
      throw new InternalServerErrorException("L'ajout en mémoire a échoué");
    }
  }

  async search(
    query: string,
    topK?: number,
    dateFilter?: { field: 'eventDate' | 'addedAt'; gte?: string; lte?: string },
  ) {
    try {
      const k = topK ?? this.defaultTopK;
      const [queryVector] = await this.ollama.embed([query]);
      const hits = await this.vs.searchMemory(queryVector, k, dateFilter);

      return {
        results: hits.map((h) => {
          const p = h.payload as RagPayload;
          return {
            text: p.text,
            source: p.source,
            score: h.score,
            addedAt: p.addedAt,
            eventDate: p.eventDate,
            contextType: p.contextType,
          };
        }),
        topK: k,
      };
    } catch (error) {
      this.logger.error('Recherche mémoire échouée', error);
      throw new InternalServerErrorException(
        'La recherche en mémoire a échoué',
      );
    }
  }

  async query(q: string, topK?: number) {
    try {
      // 1. Détecter le contexte temporel dans la question
      const temporal = this.temporal.parse(q);

      // 2. Construire un filtre de date automatique (eventDate, même journée)
      let dateFilter:
        | { field: 'eventDate' | 'addedAt'; gte?: string; lte?: string }
        | undefined;
      if (temporal?.resolvedDate) {
        const d = new Date(temporal.resolvedDate);
        const gte = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
        ).toISOString();
        const lte = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          23,
          59,
          59,
          999,
        ).toISOString();
        dateFilter = { field: 'eventDate', gte, lte };
      }

      // 3. Chercher les souvenirs pertinents
      const { results } = await this.search(q, topK, dateFilter);

      // 4. Formater le contexte pour le LLM
      const contexts = results
        .map(
          (r, i) =>
            `# Souvenir ${i + 1}${r.source ? ` (source: ${r.source})` : ''}${r.eventDate ? ` [le ${r.eventDate}]` : ''}\n${r.text}`,
        )
        .join('\n\n');

      const sources = [
        ...new Set(results.map((r) => r.source).filter(Boolean)),
      ] as string[];

      const system =
        "Tu es Jarvis, un assistant personnel pour la maison. Réponds en français. Utilise PRIORITAIREMENT les informations mémorisées pour répondre. Si aucune information pertinente n'est disponible, dis-le clairement.";

      const prompt =
        contexts.length > 0
          ? `Informations mémorisées:\n${contexts}\n\nQuestion:\n${q}\n\nRéponse:`
          : `Question:\n${q}\n\nAucune information mémorisée pertinente n'est disponible. Réponse:`;

      // 5. Générer la réponse LLM (non-streaming)
      const answer = await this.ollama.generate(prompt, system);

      return {
        answer,
        sources,
        topK: results.length,
        ...(temporal ? { temporalContext: temporal.expression } : {}),
      };
    } catch (error) {
      this.logger.error(`Requête mémoire échouée pour "${q}"`, error);
      throw new InternalServerErrorException('La requête mémoire a échoué');
    }
  }
}
