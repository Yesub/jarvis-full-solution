import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver } from 'neo4j-driver';
import type {
  KnowledgeEntity,
  KnowledgeRelation,
  EntityQueryResult,
} from './knowledge.types';

// Neo4j node/relationship properties come back as `unknown`.
// This helper safely coerces to string without triggering no-base-to-string.
function prop(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}

@Injectable()
export class KnowledgeGraphService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeGraphService.name);
  private driver: Driver | null = null;
  private graphReady = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.config.get<string>('NEO4J_URI');
    if (!uri) {
      this.logger.warn('NEO4J_URI non défini — Knowledge Graph désactivé.');
      return;
    }

    const user = this.config.get<string>('NEO4J_USER') ?? 'neo4j';
    const password = this.config.get<string>('NEO4J_PASSWORD') ?? '';

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      await this.driver.verifyConnectivity();
      await this.ensureConstraints();
      this.graphReady = true;
      this.logger.log(`Knowledge Graph connecté à ${uri}`);
    } catch (err) {
      this.logger.warn(
        `Neo4j inaccessible (${(err as Error).message}) — Knowledge Graph désactivé.`,
      );
      this.driver = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }

  get isReady(): boolean {
    return this.graphReady;
  }

  private async ensureConstraints(): Promise<void> {
    const session = this.driver!.session();
    try {
      await session.run(
        `CREATE CONSTRAINT entity_name_unique IF NOT EXISTS
         FOR (e:Entity) REQUIRE e.name IS UNIQUE`,
      );
    } finally {
      await session.close();
    }
  }

  async upsertEntities(
    entities: Array<{ name: string; type: string }>,
    memoryId: string,
  ): Promise<void> {
    if (!this.graphReady) return;

    const session = this.driver!.session();
    try {
      for (const entity of entities) {
        const name = this.normalizeName(entity.name);
        if (!name) continue;

        const now = new Date().toISOString();
        await session.run(
          `MERGE (e:Entity { name: $name })
           ON CREATE SET
             e.type      = $type,
             e.createdAt = $now,
             e.updatedAt = $now,
             e.memoryIds = [$memoryId]
           ON MATCH SET
             e.updatedAt = $now,
             e.memoryIds = CASE
               WHEN NOT $memoryId IN e.memoryIds
               THEN e.memoryIds + [$memoryId]
               ELSE e.memoryIds
             END`,
          { name, type: entity.type, memoryId, now },
        );
      }
    } finally {
      await session.close();
    }
  }

  async upsertRelation(
    from: string,
    to: string,
    relationType: string,
    context: string | undefined,
    memoryId: string,
  ): Promise<void> {
    if (!this.graphReady) return;

    const fromName = this.normalizeName(from);
    const toName = this.normalizeName(to);
    if (!fromName || !toName) return;

    const session = this.driver!.session();
    try {
      const now = new Date().toISOString();
      await session.run(
        `MATCH (a:Entity { name: $fromName })
         MATCH (b:Entity { name: $toName })
         MERGE (a)-[r:RELATION { type: $relationType }]->(b)
         ON CREATE SET
           r.context   = $context,
           r.memoryId  = $memoryId,
           r.createdAt = $now
         ON MATCH SET
           r.context   = $context,
           r.updatedAt = $now`,
        {
          fromName,
          toName,
          relationType,
          context: context ?? null,
          memoryId,
          now,
        },
      );
    } finally {
      await session.close();
    }
  }

  async findEntity(name: string): Promise<EntityQueryResult | null> {
    if (!this.graphReady) return null;

    const session = this.driver!.session();
    try {
      const result = await session.run(
        `MATCH (e:Entity { name: $name })
         OPTIONAL MATCH (e)-[r1:RELATION]->(out:Entity)
         OPTIONAL MATCH (inc:Entity)-[r2:RELATION]->(e)
         RETURN e,
           collect(DISTINCT { rel: r1, other: out }) AS outgoing,
           collect(DISTINCT { rel: r2, other: inc }) AS incoming`,
        { name: this.normalizeName(name) },
      );

      if (result.records.length === 0) return null;

      const record = result.records[0];
      const eNode = record.get('e') as { properties: Record<string, unknown> };
      const ep = eNode.properties;

      const entity: KnowledgeEntity = {
        name: prop(ep['name']),
        type: (ep['type'] as KnowledgeEntity['type']) ?? 'UNKNOWN',
        memoryIds: (ep['memoryIds'] as string[]) ?? [],
        createdAt: prop(ep['createdAt']),
        updatedAt: prop(ep['updatedAt']),
      };

      const outgoing = record.get('outgoing') as Array<{
        rel: { properties: Record<string, unknown> } | null;
        other: { properties: Record<string, unknown> } | null;
      }>;
      const incoming = record.get('incoming') as typeof outgoing;

      const relations: Array<
        KnowledgeRelation & { direction: 'outgoing' | 'incoming' }
      > = [];

      for (const { rel, other } of outgoing) {
        if (!rel || !other) continue;
        const ctx = prop(rel.properties['context']);
        const mid = prop(rel.properties['memoryId']);
        relations.push({
          from: entity.name,
          to: prop(other.properties['name']),
          type: prop(rel.properties['type']),
          ...(ctx ? { context: ctx } : {}),
          ...(mid ? { memoryId: mid } : {}),
          createdAt: prop(rel.properties['createdAt']),
          direction: 'outgoing',
        });
      }

      for (const { rel, other } of incoming) {
        if (!rel || !other) continue;
        const ctx = prop(rel.properties['context']);
        const mid = prop(rel.properties['memoryId']);
        relations.push({
          from: prop(other.properties['name']),
          to: entity.name,
          type: prop(rel.properties['type']),
          ...(ctx ? { context: ctx } : {}),
          ...(mid ? { memoryId: mid } : {}),
          createdAt: prop(rel.properties['createdAt']),
          direction: 'incoming',
        });
      }

      return { entity, relations };
    } finally {
      await session.close();
    }
  }

  async searchEntities(partial: string): Promise<KnowledgeEntity[]> {
    if (!this.graphReady) return [];

    const session = this.driver!.session();
    try {
      const result = await session.run(
        `MATCH (e:Entity)
         WHERE toLower(e.name) CONTAINS toLower($partial)
         RETURN e
         LIMIT 10`,
        { partial },
      );

      return result.records.map((r) => {
        const p = (r.get('e') as { properties: Record<string, unknown> })
          .properties;
        return {
          name: prop(p['name']),
          type: (p['type'] as KnowledgeEntity['type']) ?? 'UNKNOWN',
          memoryIds: (p['memoryIds'] as string[]) ?? [],
          createdAt: prop(p['createdAt']),
          updatedAt: prop(p['updatedAt']),
        };
      });
    } finally {
      await session.close();
    }
  }

  async runReadQuery(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown[]> {
    if (!this.graphReady) return [];

    const session = this.driver!.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map((r) => r.toObject());
    } finally {
      await session.close();
    }
  }

  async getGraphSchema(): Promise<{
    relationTypes: string[];
    entityTypes: string[];
  }> {
    if (!this.graphReady) return { relationTypes: [], entityTypes: [] };

    const [relResult, entResult] = await Promise.all([
      this.driver!.executeQuery(
        `MATCH ()-[r:RELATION]->() RETURN DISTINCT r.type AS type LIMIT 50`,
      ),
      this.driver!.executeQuery(
        `MATCH (e:Entity) RETURN DISTINCT e.type AS type LIMIT 20`,
      ),
    ]);

    const relationTypes = relResult.records
      .map((r) => prop(r.get('type')))
      .filter(Boolean);
    const entityTypes = entResult.records
      .map((r) => prop(r.get('type')))
      .filter(Boolean);

    return { relationTypes, entityTypes };
  }

  private normalizeName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '';
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
}
