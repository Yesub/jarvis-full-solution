import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OllamaService } from '../ollama/ollama.service';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import { TemporalService } from '../temporal/temporal.service';
import type { MemoryPayload } from './memory.types';
import {
  JARVIS_EVENTS,
  type MemoryAddedEvent,
  type MemoryQueriedEvent,
  type MemorySearchedEvent,
} from '../events/jarvis.events';

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly defaultTopK: number;

  constructor(
    private readonly config: ConfigService,
    private readonly ollama: OllamaService,
    private readonly vs: VectorstoreService,
    private readonly temporal: TemporalService,
    private readonly eventEmitter: EventEmitter2,
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
      const memoryId = uuidv4();
      await this.vs.upsertMemory([
        {
          id: memoryId,
          vector,
          payload: {
            source,
            text,
            addedAt,
            contextType,
            ...(eventDate !== undefined ? { eventDate } : {}),
          } satisfies MemoryPayload,
        },
      ]);

      this.eventEmitter.emit(JARVIS_EVENTS.MEMORY_ADDED, {
        memoryId,
        text,
        source,
        ...(eventDate !== undefined ? { eventDate } : {}),
      } satisfies MemoryAddedEvent);

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

      const results = hits.map((h) => {
        const p = h.payload as MemoryPayload;
        return {
          text: p.text,
          source: p.source,
          score: h.score,
          addedAt: p.addedAt,
          eventDate: p.eventDate,
          contextType: p.contextType,
        };
      });

      this.eventEmitter.emit(JARVIS_EVENTS.MEMORY_SEARCHED, {
        query,
        resultCount: results.length,
        topK: k,
      } satisfies MemorySearchedEvent);

      return { results, topK: k };
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
      let dateFilter:
        | { field: 'eventDate' | 'addedAt'; gte?: string; lte?: string }
        | undefined;
      let temporalExpression: string | undefined;

      // Priorité à l'intervalle (semaine, plage de dates)
      const interval = this.temporal.parseInterval(q);
      if (interval) {
        dateFilter = {
          field: 'eventDate',
          gte: interval.start,
          lte: interval.end,
        };
        temporalExpression = interval.expression;
      } else {
        // Fallback : date unique → filtre sur la journée entière
        const temporal = this.temporal.parse(q);
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
          temporalExpression = temporal.expression;
        }
      }

      // 2. Chercher les souvenirs pertinents
      const { results } = await this.search(q, topK, dateFilter);

      // 3. Formater le contexte pour le LLM
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

      // 4. Générer la réponse LLM (non-streaming)
      const answer = await this.ollama.generate(prompt, system);

      this.eventEmitter.emit(JARVIS_EVENTS.MEMORY_QUERIED, {
        question: q,
        answer,
        sourceIds: sources,
        topK: results.length,
      } satisfies MemoryQueriedEvent);

      return {
        answer,
        sources,
        topK: results.length,
        ...(temporalExpression ? { temporalContext: temporalExpression } : {}),
      };
    } catch (error) {
      this.logger.error(`Requête mémoire échouée pour "${q}"`, error);
      throw new InternalServerErrorException('La requête mémoire a échoué');
    }
  }
}
