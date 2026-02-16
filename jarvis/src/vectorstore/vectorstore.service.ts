import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { RagPayload } from '../rag/rag.types';

@Injectable()
export class VectorstoreService {
  private readonly logger = new Logger(VectorstoreService.name);
  private readonly client: QdrantClient;
  private readonly collection: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('QDRANTURL') ?? 'http://localhost:6333';
    this.collection =
      this.config.get<string>('QDRANTCOLLECTION') ?? 'domainknowledge';
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
}
