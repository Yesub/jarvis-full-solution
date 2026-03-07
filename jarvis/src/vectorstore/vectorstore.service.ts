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

      // Vecteurs nommés : { default: { size, distance } }
      const namedDim =
        typeof vectors === 'object' &&
        vectors !== null &&
        !Array.isArray(vectors) &&
        'default' in (vectors as object)
          ? (vectors as Record<string, { size?: number }>)['default']?.size
          : undefined;

      // Vecteurs non-nommés (ancienne config) : { size, distance }
      const unnamedDim =
        typeof vectors === 'object' &&
        vectors !== null &&
        !Array.isArray(vectors) &&
        !('default' in (vectors as object))
          ? (vectors as { size?: number }).size
          : undefined;

      const existingDim = namedDim ?? unnamedDim;

      if (existingDim !== undefined && existingDim !== vectorSize) {
        throw new ConflictException(
          `Dimension mismatch sur la collection "${this.collection}" : ` +
            `dim existante=${existingDim}, modèle actuel=${vectorSize}. ` +
            `Supprimez la collection pour la recréer.`,
        );
      }

      // Si la collection existe avec des vecteurs non-nommés (pas de slot bm25),
      // on la recrée avec les vecteurs nommés pour activer le mode hybride.
      const hasSparseVectors =
        info.config?.params?.sparse_vectors !== undefined &&
        info.config.params.sparse_vectors !== null;

      if (unnamedDim !== undefined && !hasSparseVectors) {
        this.logger.warn(
          `Collection "${this.collection}" en mode non-nommé détectée. ` +
            `Suppression et recréation avec vecteurs nommés (default + bm25).`,
        );
        await this.client.deleteCollection(this.collection);
        await this.createCollectionWithSparse(vectorSize);
      }
    } else {
      await this.createCollectionWithSparse(vectorSize);
    }
  }

  private async createCollectionWithSparse(vectorSize: number): Promise<void> {
    await this.client.createCollection(this.collection, {
      vectors: { default: { size: vectorSize, distance: 'Cosine' as const } },
      sparse_vectors: { bm25: { modifier: 'idf' as const } },
    });
    this.logger.log(
      `Collection "${this.collection}" créée (dim=${vectorSize}, sparse bm25)`,
    );
  }

  async upsert(
    points: {
      id: string;
      vector: number[];
      sparseVector?: { indices: number[]; values: number[] };
      payload: RagPayload;
    }[],
  ): Promise<void> {
    await this.client.upsert(this.collection, {
      wait: true,
      points: points.map((p) => ({
        id: p.id,
        vector: p.sparseVector
          ? ({ default: p.vector, bm25: p.sparseVector } as Record<
              string,
              number[] | { indices: number[]; values: number[] }
            >)
          : p.vector,
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

  async searchHybrid(
    queryVector: number[],
    sparseVector: { indices: number[]; values: number[] },
    limit: number,
  ): ReturnType<QdrantClient['search']> {
    // client.query() returns QueryResponse = { points: ScoredPoint[] }
    const response = await this.client.query(this.collection, {
      prefetch: [
        { query: queryVector, using: 'default', limit: limit * 2 },
        { query: sparseVector, using: 'bm25', limit: limit * 2 },
      ],
      query: { fusion: 'rrf' },
      limit,
      with_payload: true,
    });
    return response.points;
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
      field_schema: 'datetime' as const,
    });
    await this.client.createPayloadIndex(this.memoryCollection, {
      field_name: 'eventDate',
      field_schema: 'datetime' as const,
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

  async retrieveMemoryPoints(ids: string[]) {
    return this.client.retrieve(this.memoryCollection, {
      ids,
      with_payload: true,
      with_vector: false,
    });
  }

  async updateMemoryPayload(
    pointId: string,
    fields: Partial<MemoryPayload>,
  ): Promise<void> {
    await this.client.setPayload(this.memoryCollection, {
      payload: fields as Record<string, unknown>,
      points: [pointId],
      wait: false,
    });
  }
}
