# Phase 3 — Enriched Memory and Knowledge

> **Duration:** 3-4 weeks
> **Goal:** Transform flat memory into structured, scored, entity-aware cognitive store.
> **Prerequisites:** Phase 1 (1.2 Event Bus, 1.5 Temporal), Phase 2 (for full integration)

---

## Overview

Phase 3 transforms Jarvis's memory from a flat vector log into a living, scored, entity-linked knowledge system. Memory becomes intelligent: facts are scored by importance, searched with hybrid retrieval, linked to entities in a graph, and automatically summarized.

---

## 3.1 — Memory Importance Scoring

**Feasibility:** 88% | **Effort:** M

### Problem

All memories have equal weight. A casual note ("il fait beau") has the same retrieval priority as a critical fact ("RDV dentiste demain a 9h"). No way to prioritize or decay stale memories.

### Scoring Formula

```text
importance = 0.3 * recencyScore + 0.3 * accessScore + 0.2 * emotionScore + 0.2 * futureScore
```

| Factor         | Computation                                                                            | Range     |
| -------------- | -------------------------------------------------------------------------------------- | --------- |
| `recencyScore` | `exp(-decay * daysSinceCreation)`, decay = 0.05                                        | 0.0 - 1.0 |
| `accessScore`  | `min(1.0, accessCount / 10)`                                                           | 0.0 - 1.0 |
| `emotionScore` | Keyword detection: "important", "urgent", "critique", "attention" → 1.0; neutral → 0.3 | 0.0 - 1.0 |
| `futureScore`  | `eventDate` in future → 1.0; today → 0.5; past → 0.1; none → 0.3                       | 0.0 - 1.0 |

### Implementation

**Create:** `jarvis/src/memory/memory-scoring.service.ts`

```typescript
@Injectable()
export class MemoryScoringService {
  private readonly DECAY_RATE = 0.05;
  private readonly EMOTION_KEYWORDS = [
    "important",
    "urgent",
    "critique",
    "attention",
    "crucial",
    "prioritaire",
    "essentiel",
    "inquiet",
    "stresse",
  ];

  computeImportance(text: string, eventDate?: string): number {
    const recency = 1.0; // max at creation time
    const access = 0.0; // no access yet
    const emotion = this.computeEmotionScore(text);
    const future = this.computeFutureScore(eventDate);

    return 0.3 * recency + 0.3 * access + 0.2 * emotion + 0.2 * future;
  }

  recomputeImportance(
    addedAt: string,
    accessCount: number,
    text: string,
    eventDate?: string,
  ): number {
    const daysSince =
      (Date.now() - new Date(addedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recency = Math.exp(-this.DECAY_RATE * daysSince);
    const access = Math.min(1.0, accessCount / 10);
    const emotion = this.computeEmotionScore(text);
    const future = this.computeFutureScore(eventDate);

    return 0.3 * recency + 0.3 * access + 0.2 * emotion + 0.2 * future;
  }

  private computeEmotionScore(text: string): number {
    const lower = text.toLowerCase();
    for (const keyword of this.EMOTION_KEYWORDS) {
      if (lower.includes(keyword)) return 1.0;
    }
    return 0.3;
  }

  private computeFutureScore(eventDate?: string): number {
    if (!eventDate) return 0.3;
    const event = new Date(eventDate);
    const now = new Date();
    const diffHours = (event.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (diffHours > 0) return 1.0; // future
    if (diffHours > -24) return 0.5; // today
    return 0.1; // past
  }
}
```

**Modify:** `jarvis/src/memory/memory.service.ts`

- Inject `MemoryScoringService`
- On `add()`: compute importance, include in payload
- On `search()` / `query()`: weight results by `vectorScore * importance`

**Modify:** `jarvis/src/vectorstore/vectorstore.service.ts`

- Add `updateMemoryPayload(pointId: string, fields: Partial<MemoryPayload>)` method using `qdrant.setPayload()`
- Used to increment `accessCount` on each retrieval

**Event listener:** Listen to `MEMORY_SEARCHED` events to increment access count asynchronously:

```typescript
@OnEvent(JARVIS_EVENTS.MEMORY_SEARCHED)
async handleMemorySearched(event: MemorySearchedEvent) {
  for (const id of event.resultIds) {
    await this.vectorstoreService.updateMemoryPayload(id, {
      accessCount: /* current + 1 */,
    });
  }
}
```

### Verification

- Add a memory with "urgent" keyword → `importance > 0.7`
- Add a memory with future `eventDate` → `importance > 0.6`
- Search for a memory 3 times → `accessCount` increments to 3
- Older memories with no access have lower importance over time

---

## 3.2 — Hybrid RAG: BM25 + Vector Search

**Feasibility:** 90% | **Effort:** M

### Problem

Pure vector search misses exact keyword matches (proper names, technical terms, code identifiers). "What does Paul's contract say about..." fails if "Paul" is semantically distant but literally present.

### Approach: Reciprocal Rank Fusion (RRF)

Two search paths, merged with RRF:

1. **Vector search** (existing): cosine similarity via Qdrant
2. **Keyword search**: Qdrant sparse vectors (native BM25-like) OR in-memory `minisearch`

**Recommendation: Qdrant sparse vectors** (native, persisted, no separate index)

### Implementation

**Modify:** `jarvis/src/vectorstore/vectorstore.service.ts`

Add sparse vector support to document collection:

```typescript
async ensureCollection(vectorSize: number) {
  // ... existing collection creation ...
  // Add sparse vector config if not present
  await this.qdrant.updateCollection(this.collection, {
    sparse_vectors: {
      'bm25': {
        modifier: 'idf',
      },
    },
  });
}

async searchHybrid(
  queryVector: number[],
  queryText: string,
  limit: number,
): Promise<Array<{ payload: RagPayload; score: number }>> {
  // Vector search
  const vectorResults = await this.search(queryVector, limit * 2);

  // Sparse/keyword search
  const sparseResults = await this.qdrant.query(this.collection, {
    query: { indices: /* tokenized queryText */, values: /* TF-IDF weights */ },
    using: 'bm25',
    limit: limit * 2,
  });

  // RRF fusion
  return this.reciprocalRankFusion(vectorResults, sparseResults, limit);
}

private reciprocalRankFusion(
  vectorHits: ScoredPoint[],
  sparseHits: ScoredPoint[],
  limit: number,
  k: number = 60,
): ScoredPoint[] {
  const scores = new Map<string, number>();

  vectorHits.forEach((hit, rank) => {
    const id = hit.id.toString();
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  });

  sparseHits.forEach((hit, rank) => {
    const id = hit.id.toString();
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  });

  // Sort by fused score, return top `limit`
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => /* reconstruct with payload */);
}
```

**Create:** `jarvis/src/rag/tokenizer.service.ts`

Simple French tokenizer for sparse vectors:

```typescript
@Injectable()
export class TokenizerService {
  private readonly STOP_WORDS = new Set([
    "le",
    "la",
    "les",
    "un",
    "une",
    "des",
    "de",
    "du",
    "et",
    "en",
    "est",
    "que",
    "qui",
    "dans",
    "pour",
    "pas",
    "sur",
    "ce",
    "il",
    // ... more French stop words
  ]);

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\sàâäéèêëïîôùûüÿç]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !this.STOP_WORDS.has(w));
  }
}
```

**Modify:** `jarvis/src/rag/rag.service.ts`

- On `ingestFile()` / `ingestText()`: also compute and store sparse vectors
- On `ask()` / `askStream()`: use `searchHybrid()` instead of `search()`
- Add `searchMode` option: `'vector'` (default, backward compatible) or `'hybrid'`

### Verification

- Ingest a document with a proper name "Jean-Pierre Martin"
- Vector search for "Jean-Pierre Martin" may miss it
- Hybrid search for "Jean-Pierre Martin" should find it via BM25
- Compare result quality on 10 test queries (hybrid vs vector-only)

---

## 3.3 — Personal Knowledge Graph (Neo4j)

**Feasibility:** 72% | **Effort:** XL

### Problem

Memory is unstructured text. Jarvis cannot answer "When did I last see Paul?" or "What projects is Marie working on?" because there are no entity relationships.

### Infrastructure

**Docker setup:** Add to `docker-qdrant/docker-compose.yml` (or create `docker-neo4j/docker-compose.yml`):

```yaml
services:
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474" # Browser
      - "7687:7687" # Bolt
    environment:
      - NEO4J_AUTH=neo4j/jarvispassword
    volumes:
      - ./neo4j_data:/data
```

### Entity Types

```typescript
// jarvis/src/knowledge/knowledge.types.ts

export enum EntityType {
  PERSON = "person",
  PROJECT = "project",
  EVENT = "event",
  PLACE = "place",
  GOAL = "goal",
  PREFERENCE = "preference",
  ORGANIZATION = "organization",
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  properties: Record<string, string>;
  createdAt: string;
  lastSeenAt: string;
}

export interface Relation {
  id: string;
  fromEntityId: string;
  relationType: string; // 'works_with', 'located_at', 'part_of', 'knows'
  toEntityId: string;
  contextText: string;
  createdAt: string;
}
```

### Implementation

**Install dependency:**

```bash
cd jarvis && npm install neo4j-driver
```

**Create:** `jarvis/src/knowledge/knowledge.module.ts`

```typescript
@Module({
  imports: [OllamaModule],
  providers: [KnowledgeService, KnowledgeGraphService, EntityExtractorService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
```

**Create:** `jarvis/src/knowledge/knowledge-graph.service.ts`

```typescript
@Injectable()
export class KnowledgeGraphService implements OnModuleInit {
  private driver: neo4j.Driver;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const uri = this.configService.get("NEO4J_URI", "bolt://localhost:7687");
    const user = this.configService.get("NEO4J_USER", "neo4j");
    const password = this.configService.get("NEO4J_PASSWORD", "jarvispassword");
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

    // Create indexes
    const session = this.driver.session();
    try {
      await session.run(
        "CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.name)",
      );
      await session.run(
        "CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.type)",
      );
    } finally {
      await session.close();
    }
  }

  async upsertEntity(entity: Entity): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (e:Entity {name: $name, type: $type})
         ON CREATE SET e.id = $id, e.aliases = $aliases, e.createdAt = $createdAt, e.lastSeenAt = $lastSeenAt
         ON MATCH SET e.lastSeenAt = $lastSeenAt`,
        entity,
      );
    } finally {
      await session.close();
    }
  }

  async createRelation(relation: Relation): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (a:Entity {id: $fromEntityId})
         MATCH (b:Entity {id: $toEntityId})
         MERGE (a)-[r:RELATES {type: $relationType}]->(b)
         SET r.contextText = $contextText, r.createdAt = $createdAt`,
        relation,
      );
    } finally {
      await session.close();
    }
  }

  async queryByEntity(
    name: string,
  ): Promise<{ entity: Entity; relations: Relation[] }> {
    // Fuzzy match on name and aliases
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (e:Entity)
         WHERE toLower(e.name) CONTAINS toLower($name) OR $name IN e.aliases
         OPTIONAL MATCH (e)-[r]-(other:Entity)
         RETURN e, collect({relation: r, other: other}) as connections`,
        { name },
      );
      // ... parse results
    } finally {
      await session.close();
    }
  }
}
```

**Create:** `jarvis/src/knowledge/entity-extractor.service.ts`

Uses Ollama small model to extract entities from text:

```typescript
@Injectable()
export class EntityExtractorService {
  constructor(private ollamaService: OllamaService) {}

  async extract(text: string): Promise<ExtractedEntities> {
    const prompt = `Extract entities from this French text.
Return ONLY valid JSON:
{
  "entities": [
    { "name": "Paul", "type": "person" },
    { "name": "bureau", "type": "place" }
  ],
  "relations": [
    { "from": "Paul", "type": "works_at", "to": "bureau" }
  ]
}

Text: "${text}"`;

    const response = await this.ollamaService.generateWith("small", prompt);
    return this.parseEntities(response);
  }
}
```

**Event-driven integration:** Listen to `MEMORY_ADDED` events:

```typescript
@OnEvent(JARVIS_EVENTS.MEMORY_ADDED)
async handleMemoryAdded(event: MemoryAddedEvent) {
  const entities = await this.entityExtractor.extract(event.text);
  for (const entity of entities.entities) {
    await this.knowledgeGraph.upsertEntity(entity);
  }
  // Link entities to memory vector ID
}
```

### Environment Variables

Add to `jarvis/.env`:

```env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=jarvispassword
```

### Verification

- Add memory "J'ai vu Paul au bureau" → Entity `Paul` (person) and `bureau` (place) created in Neo4j
- Add memory "Paul travaille sur le projet Alpha" → Relation `Paul -> works_on -> Alpha`
- Query "Que sais-je sur Paul ?" → Returns entity info + relations
- Neo4j browser at `http://localhost:7474` shows graph

---

## 3.4 — Auto Summaries (Daily/Weekly)

**Feasibility:** 85% | **Effort:** M

### Problem

Over time, memory accumulates without consolidation. No way to get "what happened today/this week" without manual querying.

### Implementation

**Install dependency:**

```bash
cd jarvis && npm install @nestjs/schedule
```

**Modify:** `jarvis/src/app.module.ts`:

```typescript
import { ScheduleModule } from '@nestjs/schedule';

imports: [
  // ...
  ScheduleModule.forRoot(),
],
```

**Create:** `jarvis/src/memory/memory-summarizer.service.ts`

```typescript
@Injectable()
export class MemorySummarizerService {
  private readonly logger = new Logger(MemorySummarizerService.name);

  constructor(
    private memoryService: MemoryService,
    private ollamaService: OllamaService,
  ) {}

  // Run daily at 23:55
  @Cron("55 23 * * *")
  async generateDailySummary() {
    this.logger.log("Generating daily summary...");

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);

    const memories = await this.memoryService.search("", undefined, {
      field: "addedAt",
      gte: startOfDay.toISOString(),
      lte: today.toISOString(),
    });

    if (memories.results.length === 0) {
      this.logger.log("No memories today, skipping summary.");
      return;
    }

    const context = memories.results.map((r) => `- ${r.text}`).join("\n");

    const summary = await this.ollamaService.generate(
      `Voici les evenements memorises aujourd'hui:\n${context}\n\nFais un resume concis en francais de cette journee.`,
      "Tu es un assistant qui cree des resumes quotidiens concis et utiles.",
    );

    await this.memoryService.add(
      `Resume du ${today.toLocaleDateString("fr-FR")}: ${summary}`,
      "auto_summary",
      "daily_summary",
    );

    this.logger.log("Daily summary generated and stored.");
  }

  // Run weekly on Sunday at 23:55
  @Cron("55 23 * * 0")
  async generateWeeklySummary() {
    // Similar but queries last 7 days of daily summaries
    // Generates a higher-level weekly summary
  }
}
```

### Verification

- Manually trigger `generateDailySummary()` via a test endpoint or unit test
- Check that a summary memory is stored with `contextType: 'daily_summary'`
- Query "resume de la journee" → returns the daily summary

---

## 3.5 — Life Timeline Endpoint

**Feasibility:** 90% | **Effort:** S

### Problem

No dedicated endpoint to query "what happened this week" as a chronological timeline.

### Implementation

**Modify:** `jarvis/src/memory/memory.dto.ts` — add:

```typescript
export class MemoryTimelineDto {
  @IsString()
  @MinLength(1)
  query!: string; // Natural language time range: "cette semaine", "en janvier"

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
```

**Modify:** `jarvis/src/memory/memory.service.ts` — add:

```typescript
async timeline(query: string, limit?: number): Promise<TimelineResult> {
  const interval = this.temporalService.parseInterval(query);
  const effectiveLimit = limit ?? 20;

  if (!interval) {
    // Fallback: last 7 days
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    interval = { start: start.toISOString(), end: end.toISOString(), expression: 'last 7 days' };
  }

  const results = await this.search(query, effectiveLimit, {
    field: 'eventDate',
    gte: interval.start,
    lte: interval.end,
  });

  // Sort chronologically by eventDate
  const sorted = results.results.sort((a, b) =>
    new Date(a.eventDate ?? a.addedAt).getTime() - new Date(b.eventDate ?? b.addedAt).getTime()
  );

  return {
    interval,
    events: sorted,
    count: sorted.length,
  };
}
```

**Modify:** `jarvis/src/memory/memory.controller.ts` — add:

```typescript
@Post('timeline')
async timeline(@Body() dto: MemoryTimelineDto) {
  return this.memoryService.timeline(dto.query, dto.limit);
}
```

### Verification

- `POST /memory/timeline { "query": "cette semaine" }` → returns chronological events
- `POST /memory/timeline { "query": "le mois dernier" }` → returns last month events

---

## 3.6 — Semantic Chunking

**Feasibility:** 80% | **Effort:** M

### Problem

Current chunking uses fixed 1000-char windows with 150-char overlap. This splits content at arbitrary positions, potentially cutting paragraphs, sections, or logical units.

### Approach

Use embeddings to detect semantic boundaries. Compute embeddings for sliding windows; where adjacent windows have low cosine similarity, there is a topic shift — place a chunk boundary there.

### Implementation

**Modify:** `jarvis/src/rag/rag.service.ts`

```typescript
private async semanticChunk(text: string): Promise<string[]> {
  const sentences = this.splitIntoSentences(text);
  if (sentences.length <= 3) return [text];

  // Compute embeddings for each sentence
  const embeddings = await this.ollamaService.embed(sentences);

  // Compute cosine similarity between adjacent sentences
  const similarities: number[] = [];
  for (let i = 0; i < embeddings.length - 1; i++) {
    similarities.push(this.cosineSimilarity(embeddings[i], embeddings[i + 1]));
  }

  // Find breakpoints: where similarity drops below threshold
  const threshold = this.computeThreshold(similarities); // e.g., mean - 1 stddev
  const breakpoints: number[] = [];
  for (let i = 0; i < similarities.length; i++) {
    if (similarities[i] < threshold) breakpoints.push(i + 1);
  }

  // Build chunks from breakpoints
  const chunks: string[] = [];
  let start = 0;
  for (const bp of breakpoints) {
    chunks.push(sentences.slice(start, bp).join(' '));
    start = bp;
  }
  chunks.push(sentences.slice(start).join(' '));

  // Merge small chunks (< 200 chars) with neighbors
  return this.mergeSmallChunks(chunks, 200);
}

private splitIntoSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
}
```

**Configuration:** Add env var `CHUNKING_MODE=semantic|fixed` (default: `fixed` for backward compatibility).

### Verification

- Ingest a multi-topic document (e.g., PDF with distinct sections)
- Compare chunk boundaries: semantic vs fixed
- Semantic chunks should respect paragraph/section boundaries
- RAG question quality should improve (fewer irrelevant chunks in context)

---

## Implementation Order

```text
3.1 Importance Scoring (needs 1.2 Event Bus)
  |
  +--> 3.2 Hybrid RAG (independent, parallel with 3.1)
  |
  +--> 3.5 Life Timeline (needs 1.5 Temporal, parallel with 3.1)
  |
  +--> 3.6 Semantic Chunking (independent, parallel with 3.1)
  |
  v
3.3 Knowledge Graph (needs 1.2, benefits from 3.1)
  |
  v
3.4 Auto Summaries (needs 1.2, Schedule module)
```

Recommended: start with 3.1 (scoring) and 3.5 (timeline) as quick wins, then 3.2 (hybrid RAG), then 3.3 (knowledge graph — largest effort), finally 3.4 (summaries).

---

## Files Summary

### Files to Create

| File                                               | Step |
| -------------------------------------------------- | ---- |
| `jarvis/src/memory/memory-scoring.service.ts`      | 3.1  |
| `jarvis/src/rag/tokenizer.service.ts`              | 3.2  |
| `jarvis/src/rag/reranker.service.ts`               | 3.2  |
| `jarvis/src/knowledge/knowledge.module.ts`         | 3.3  |
| `jarvis/src/knowledge/knowledge.service.ts`        | 3.3  |
| `jarvis/src/knowledge/knowledge-graph.service.ts`  | 3.3  |
| `jarvis/src/knowledge/entity-extractor.service.ts` | 3.3  |
| `jarvis/src/knowledge/knowledge.types.ts`          | 3.3  |
| `jarvis/src/memory/memory-summarizer.service.ts`   | 3.4  |
| `docker-neo4j/docker-compose.yml`                  | 3.3  |

### Files to Modify

| File                                            | Steps    |
| ----------------------------------------------- | -------- |
| `jarvis/src/memory/memory.service.ts`           | 3.1, 3.5 |
| `jarvis/src/memory/memory.controller.ts`        | 3.5      |
| `jarvis/src/memory/memory.dto.ts`               | 3.5      |
| `jarvis/src/memory/memory.module.ts`            | 3.1, 3.4 |
| `jarvis/src/vectorstore/vectorstore.service.ts` | 3.1, 3.2 |
| `jarvis/src/rag/rag.service.ts`                 | 3.2, 3.6 |
| `jarvis/src/app.module.ts`                      | 3.3, 3.4 |
| `jarvis/package.json`                           | 3.3, 3.4 |
| `jarvis/.env`                                   | 3.3      |

### Dependencies to Install

```bash
cd jarvis && npm install neo4j-driver @nestjs/schedule
```

### Docker Services to Add

```bash
# Neo4j (Phase 3.3)
cd docker-neo4j && docker-compose up -d
```
