import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { RagPayload } from '../rag/rag.types';
import type { MemoryPayload } from '../memory/memory.types';

@Injectable()
export class VectorstoreService {
  private readonly logger = new Logger(VectorstoreService.name);
  private readonly client: QdrantClient;
  private readonly collection: string;
  private readonly memoryCollection: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('QDRANTURL') ?? 'http://localhost:6333';
    this.collection =
      this.config.get<string>('QDRANTCOLLECTION') ?? 'domainknowledge';
    this.memoryCollection =
      this.config.get<string>('QDRANT_MEMORY_COLLECTION') ?? 'jarvis_for_home';
    this.client = new QdrantClient({ url });
  }

  async ensureCollection(vectorSize: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections?.some(
      (c) => c.name === this.collection,
    );

    if (exists) {
      const info = await this.client.getCollection(this.collection);
      const vectors = info.config?.params?.vectors;
      const existingDim =
        typeof vectors === 'object' &&
        vectors !== null &&
        !Array.isArray(vectors)
          ? (vectors as { size?: number }).size
          : undefined;

      if (existingDim !== undefined && existingDim !== vectorSize) {
        throw new ConflictException(
          `Dimension mismatch sur la collection "${this.collection}" : ` +
            `dim existante=${existingDim}, modèle actuel=${vectorSize}. ` +
            `Supprimez la collection pour la recréer.`,
        );
      }
      return;
    }

    await this.client.createCollection(this.collection, {
      vectors: { size: vectorSize, distance: 'Cosine' },
    });
    this.logger.log(
      `Collection "${this.collection}" créée (dim=${vectorSize})`,
    );
  }

  async upsert(
    points: { id: string; vector: number[]; payload: RagPayload }[],
  ): Promise<void> {
    await this.client.upsert(this.collection, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }

  async search(queryVector: number[], limit: number) {
    return this.client.search(this.collection, {
      vector: queryVector,
      limit,
      with_payload: true,
      with_vector: false,
    });
  }

  // --- Collection mémoire (jarvis_for_home) ---

  async ensureMemoryCollection(vectorSize: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections?.some(
      (c) => c.name === this.memoryCollection,
    );

    if (!exists) {
      await this.client.createCollection(this.memoryCollection, {
        vectors: { size: vectorSize, distance: 'Cosine' },
      });
      this.logger.log(
        `Collection mémoire "${this.memoryCollection}" créée (dim=${vectorSize})`,
      );
    }

    // Indexes temporels (idempotent — Qdrant ignore si l'index existe déjà)
    await this.client.createPayloadIndex(this.memoryCollection, {
      field_name: 'addedAt',
      field_schema: 'datetime' as any,
    });
    await this.client.createPayloadIndex(this.memoryCollection, {
      field_name: 'eventDate',
      field_schema: 'datetime' as any,
    });
  }

  async upsertMemory(
    points: { id: string; vector: number[]; payload: MemoryPayload }[],
  ): Promise<void> {
    await this.client.upsert(this.memoryCollection, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }

  async searchMemory(
    queryVector: number[],
    limit: number,
    dateFilter?: { field: 'eventDate' | 'addedAt'; gte?: string; lte?: string },
  ) {
    const filter = dateFilter
      ? {
          must: [
            {
              key: dateFilter.field,
              range: {
                ...(dateFilter.gte !== undefined
                  ? { gte: dateFilter.gte }
                  : {}),
                ...(dateFilter.lte !== undefined
                  ? { lte: dateFilter.lte }
                  : {}),
              },
            },
          ],
        }
      : undefined;

    return this.client.search(this.memoryCollection, {
      vector: queryVector,
      limit,
      with_payload: true,
      with_vector: false,
      ...(filter !== undefined ? { filter } : {}),
    });
  }
}
