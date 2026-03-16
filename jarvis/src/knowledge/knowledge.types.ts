export type EntityType =
  | 'PERSON'
  | 'PLACE'
  | 'OBJECT'
  | 'EVENT'
  | 'DATE'
  | 'ORGANIZATION'
  | 'CONCEPT'
  | 'UNKNOWN';

export const VALID_ENTITY_TYPES = new Set<EntityType>([
  'PERSON',
  'PLACE',
  'OBJECT',
  'EVENT',
  'DATE',
  'ORGANIZATION',
  'CONCEPT',
  'UNKNOWN',
]);

export interface KnowledgeEntity {
  name: string;
  type: EntityType;
  memoryIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelation {
  from: string;
  to: string;
  type: string;
  context?: string;
  memoryId?: string;
  createdAt: string;
}

export interface ExtractionResult {
  entities: Array<{ name: string; type: EntityType }>;
  relations: Array<{
    from: string;
    relation: string;
    to: string;
    context?: string;
  }>;
}

export interface EntityQueryResult {
  entity: KnowledgeEntity;
  relations: Array<KnowledgeRelation & { direction: 'outgoing' | 'incoming' }>;
}

export interface EntityResponse {
  found: boolean;
  entity?: KnowledgeEntity;
  relations?: Array<{
    direction: 'outgoing' | 'incoming';
    type: string;
    otherEntity: string;
    context?: string;
  }>;
  relatedEntities?: string[];
}
