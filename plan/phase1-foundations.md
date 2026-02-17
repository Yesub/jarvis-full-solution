# Phase 1 — Foundations

> **Duration:** 2-3 weeks
> **Goal:** Stabilize and extend core infrastructure for all subsequent phases.
> **Prerequisite:** None (starting point)

---

## Overview

Phase 1 prepares the codebase for the cognitive agent transformation. No user-facing features are added — this is pure infrastructure that enables Phases 2-5.

---

## 1.1 — Type Separation: Extract MemoryPayload from RagPayload

**Feasibility:** 98% | **Effort:** S

### Problem

`RagPayload` in `jarvis/src/rag/rag.types.ts` mixes RAG document fields (`source`, `chunkIndex`) with memory fields (`addedAt`, `contextType`, `eventDate`). Both `MemoryService` and `VectorstoreService` import from the RAG module, creating a coupling that will break as memory grows more complex (importance, accessCount, entityLinks).

### Implementation

**Create:** `jarvis/src/memory/memory.types.ts`

```typescript
export type MemoryPayload = {
  text: string;
  source: string;
  addedAt: string; // ISO 8601 — when stored
  contextType: string; // 'memory' | 'summary' | 'mood' | custom
  eventDate?: string; // ISO 8601 — event date from TemporalService
  importance?: number; // 0.0 - 1.0, computed by MemoryScoringService (Phase 3.1)
  accessCount?: number; // incremented on each retrieval (Phase 3.1)
};
```

**Modify:** `jarvis/src/rag/rag.types.ts` — keep only RAG fields:

```typescript
export type RagPayload = {
  source: string;
  chunkIndex: number;
  text: string;
};
```

**Modify:** `jarvis/src/memory/memory.service.ts`

- Change import from `import { RagPayload } from '../rag/rag.types'` to `import { MemoryPayload } from './memory.types'`
- Update all Qdrant point construction to use `MemoryPayload`

**Modify:** `jarvis/src/vectorstore/vectorstore.service.ts`

- Import `MemoryPayload` for memory methods (`upsertMemory`, `searchMemory`)
- Keep `RagPayload` for document methods (`upsert`, `search`)

### Verification

- `npm run build` passes with no type errors
- Existing `/memory/add` and `/memory/query` endpoints still work correctly
- Existing `/rag/ingest` and `/rag/ask` endpoints still work correctly

---

## 1.2 — Event Bus with NestJS EventEmitter2

**Feasibility:** 95% | **Effort:** M

### Problem

Modules communicate only via direct service injection. Future features (importance scoring on access, auto-summaries, knowledge graph updates, feedback effects) need decoupled event handling.

### Implementation

**Install dependency:**

```bash
cd jarvis && npm install @nestjs/event-emitter
```

**Create:** `jarvis/src/events/jarvis.events.ts`

```typescript
// Event name constants
export const JARVIS_EVENTS = {
  // Memory events
  MEMORY_ADDED: "memory.added",
  MEMORY_QUERIED: "memory.queried",
  MEMORY_SEARCHED: "memory.searched",

  // Intent events (Phase 2)
  INTENT_CLASSIFIED: "intent.classified",

  // Action events (Phase 4)
  ACTION_TRIGGERED: "action.triggered",
  REMINDER_DUE: "reminder.due",

  // Feedback events (Phase 5)
  FEEDBACK_RECEIVED: "feedback.received",
} as const;

// Payload types
export interface MemoryAddedEvent {
  memoryId: string;
  text: string;
  source: string;
  eventDate?: string;
  importance?: number;
}

export interface MemoryQueriedEvent {
  question: string;
  answer: string;
  sourceIds: string[];
  topK: number;
}

export interface MemorySearchedEvent {
  query: string;
  resultIds: string[];
}

export interface IntentClassifiedEvent {
  text: string;
  intent: string;
  confidence: number;
  sessionId?: string;
}

export interface ActionTriggeredEvent {
  type: string;
  params: Record<string, unknown>;
}

export interface ReminderDueEvent {
  reminderId: string;
  text: string;
}

export interface FeedbackReceivedEvent {
  messageId: string;
  positive: boolean;
  correctionText?: string;
}
```

**Modify:** `jarvis/src/app.module.ts`

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot({ wildcard: true }),
    // ... existing modules
  ],
})
```

**Modify:** `jarvis/src/memory/memory.service.ts` — emit events after operations:

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JARVIS_EVENTS, MemoryAddedEvent } from '../events/jarvis.events';

constructor(
  // ... existing deps
  private eventEmitter: EventEmitter2,
) {}

async add(text: string, source?: string, contextType?: string) {
  // ... existing logic ...
  const result = { /* existing return */ };

  this.eventEmitter.emit(JARVIS_EVENTS.MEMORY_ADDED, {
    memoryId: pointId,
    text,
    source: source ?? 'unknown',
    eventDate: temporal?.resolvedDate,
  } satisfies MemoryAddedEvent);

  return result;
}
```

### Verification

- `npm run build` passes
- Add a temporary `@OnEvent('memory.added')` listener that logs — verify it fires on `/memory/add`
- Remove the temporary listener after testing

---

## 1.3 — Multi-LLM Routing

**Feasibility:** 92% | **Effort:** M

### Problem

A single Ollama model (`OLLAMA_LLM_MODEL`) is used for all tasks. Intent classification needs a fast small model; RAG/memory needs quality; complex reasoning needs the best model.

### Implementation

**Modify:** `jarvis/.env` — add new env vars:

```env
# LLM Models (Multi-model routing)
OLLAMA_LLM_MODEL=gpt-oss:20b          # Default / medium — RAG, memory Q&A
OLLAMA_SMALL_MODEL=qwen3:4b            # Fast — intent classification, entity extraction
OLLAMA_LARGE_MODEL=gpt-oss:20b         # Quality — complex reasoning (same as default for now)
```

**Modify:** `jarvis/src/ollama/ollama.service.ts`

```typescript
@Injectable()
export class OllamaService {
  private readonly baseUrl: string;
  private readonly llmModel: string;
  private readonly embedModel: string;
  private readonly smallModel: string;
  private readonly largeModel: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      "OLLAMA_BASE_URL",
      "http://127.0.0.1:11434",
    );
    this.llmModel = this.configService.get<string>(
      "OLLAMA_LLM_MODEL",
      "gpt-oss:20b",
    );
    this.embedModel = this.configService.get<string>(
      "OLLAMA_EMBED_MODEL",
      "qwen3-embedding:8b",
    );
    this.smallModel = this.configService.get<string>(
      "OLLAMA_SMALL_MODEL",
      this.llmModel,
    );
    this.largeModel = this.configService.get<string>(
      "OLLAMA_LARGE_MODEL",
      this.llmModel,
    );
  }

  // New method: generate with a specific model
  async generateWith(
    model: "small" | "medium" | "large",
    prompt: string,
    system?: string,
  ): Promise<string> {
    const modelName = this.resolveModel(model);
    // Same logic as generate() but with modelName parameter
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, prompt, system, stream: false }),
    });
    const data = await response.json();
    return data.response;
  }

  // New method: stream with a specific model
  async *generateStreamWith(
    model: "small" | "medium" | "large",
    prompt: string,
    system?: string,
  ): AsyncGenerator<string> {
    const modelName = this.resolveModel(model);
    // Same logic as generateStream() but with modelName parameter
  }

  private resolveModel(model: "small" | "medium" | "large"): string {
    switch (model) {
      case "small":
        return this.smallModel;
      case "medium":
        return this.llmModel;
      case "large":
        return this.largeModel;
    }
  }

  // Existing methods remain unchanged (they use this.llmModel)
}
```

### Verification

- `npm run build` passes
- Test `generateWith('small', 'Dis bonjour')` returns a response from qwen3:4b
- Ensure `qwen3:4b` is pulled in Ollama: `ollama pull qwen3:4b`
- Existing endpoints still use the default model (no regression)

---

## 1.4 — AgentContext Types

**Feasibility:** 95% | **Effort:** S

### Problem

Every engine in later phases needs conversation context (session state, history, pending actions). Define the shared types now so all phases build on the same foundation.

### Implementation

**Create:** `jarvis/src/agent/agent.types.ts`

```typescript
export interface AgentContext {
  sessionId: string;
  history: ConversationMessage[];
  activeIntent?: string;
  pendingConfirmation?: PendingConfirmation;
  temporalContext?: string;
  identityContext?: IdentityProfile;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  intent?: string;
  confidence?: number;
}

export interface PendingConfirmation {
  action: string;
  params: Record<string, unknown>;
  expiresAt: string; // ISO 8601
}

export interface IdentityProfile {
  name: string;
  role?: string;
  currentProjects?: string[];
  priorities?: string[];
  preferences?: Record<string, string>;
}

export interface AgentProcessDto {
  sessionId?: string; // auto-generated if not provided
  text: string;
  source?: "voice" | "ui" | "api";
}

export interface AgentResponse {
  sessionId: string;
  intent: string;
  confidence: number;
  answer: string;
  sources?: Array<{ text: string; score: number }>;
  actions?: AgentAction[];
  hallucinationWarning?: string;
}

export interface AgentAction {
  type: string;
  description: string;
  status: "executed" | "pending_confirmation" | "failed";
}
```

**Create:** `jarvis/src/agent/` directory (empty module placeholder for Phase 2)

### Verification

- `npm run build` passes — types compile without errors
- Types are importable from other modules

---

## 1.5 — Enhanced Temporal Service

**Feasibility:** 85% | **Effort:** M

### Problem

Current `TemporalService` only extracts a point-in-time date. It cannot handle:

- **Intervals:** "la semaine derniere", "entre lundi et mercredi"
- **Recurrence:** "tous les mardis", "chaque vendredi"
- **Past vs future intent:** "qu'est-ce que j'ai fait hier" vs "qu'est-ce que j'ai demain"

### Implementation

**Modify:** `jarvis/src/temporal/temporal.types.ts`

```typescript
export type TemporalResult = {
  expression: string;
  resolvedDate: string; // ISO 8601 UTC
};

// New types
export type TemporalInterval = {
  expression: string;
  start: string; // ISO 8601 UTC
  end: string; // ISO 8601 UTC
};

export type RecurrencePattern = {
  expression: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  dayOfWeek?: number; // 0=Sunday, 1=Monday, ...
  dayOfMonth?: number;
  time?: string; // HH:mm
};

export type TemporalDirection = "past" | "future" | "present" | "unknown";
```

**Modify:** `jarvis/src/temporal/temporal.service.ts`

```typescript
@Injectable()
export class TemporalService {
  // Existing parse() and parseAll() remain unchanged

  /**
   * Parse an interval from text (e.g., "la semaine derniere", "entre lundi et mercredi")
   * Uses chrono-node's start/end on parsed results
   */
  parseInterval(text: string, referenceDate?: Date): TemporalInterval | null {
    const ref = referenceDate ?? new Date();
    const results = chrono.fr.parse(text, ref, { forwardDate: false });

    if (results.length === 0) return null;

    const result = results[0];
    if (result.end) {
      return {
        expression: result.text,
        start: result.start.date().toISOString(),
        end: result.end.date().toISOString(),
      };
    }

    // Single date: expand to full day
    const startDate = result.start.date();
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 999);
    return {
      expression: result.text,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    };
  }

  /**
   * Detect recurrence patterns in French text
   */
  detectRecurrence(text: string): RecurrencePattern | null {
    const lower = text.toLowerCase();

    const weeklyPatterns: Record<string, number> = {
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6,
      dimanche: 0,
    };

    // "tous les [jour]" / "chaque [jour]"
    const weeklyMatch = lower.match(
      /(?:tous\s+les|chaque)\s+(lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?)/,
    );
    if (weeklyMatch) {
      const dayName = weeklyMatch[1].replace(/s$/, "");
      return {
        expression: weeklyMatch[0],
        frequency: "weekly",
        dayOfWeek: weeklyPatterns[dayName],
      };
    }

    // "tous les jours" / "chaque jour"
    if (/(?:tous\s+les\s+jours|chaque\s+jour|quotidien)/.test(lower)) {
      return { expression: "tous les jours", frequency: "daily" };
    }

    // "tous les mois" / "chaque mois"
    if (/(?:tous\s+les\s+mois|chaque\s+mois|mensuel)/.test(lower)) {
      return { expression: "tous les mois", frequency: "monthly" };
    }

    return null;
  }

  /**
   * Determine if the text expresses past or future intent
   */
  detectDirection(text: string): TemporalDirection {
    const lower = text.toLowerCase();

    const pastIndicators = [
      /qu['']?(?:est-ce qui|ai-je)\s+(?:fait|eu|vu|dit)/,
      /(?:hier|avant-hier|la\s+semaine\s+derni[eè]re|le\s+mois\s+dernier)/,
      /(?:s['']est\s+pass[eé]|a\s+eu\s+lieu|avai[ts])/,
    ];

    const futureIndicators = [
      /(?:demain|apr[eè]s-demain|la\s+semaine\s+prochaine|le\s+mois\s+prochain)/,
      /(?:pr[eé]vu|planifi[eé]|vais|dois|faut)/,
      /(?:qu['']?(?:est-ce que|ai-je)\s+(?:pr[eé]vu|dois))/,
    ];

    for (const pattern of pastIndicators) {
      if (pattern.test(lower)) return "past";
    }
    for (const pattern of futureIndicators) {
      if (pattern.test(lower)) return "future";
    }

    return "unknown";
  }
}
```

**Modify:** `jarvis/src/memory/memory.service.ts` — use interval in `query()`:

```typescript
async query(question: string, topK?: number) {
  // Try interval first
  const interval = this.temporalService.parseInterval(question);
  let dateFilter;

  if (interval) {
    dateFilter = {
      field: 'eventDate' as const,
      gte: interval.start,
      lte: interval.end,
    };
  } else {
    // Existing single-date logic
    const temporal = this.temporalService.parse(question);
    if (temporal) {
      // ... existing same-day filter logic
    }
  }
  // ... rest of query logic unchanged
}
```

### Verification

- Unit test `parseInterval("la semaine derniere")` returns valid start/end spanning 7 days
- Unit test `detectRecurrence("tous les mardis")` returns `{ frequency: 'weekly', dayOfWeek: 2 }`
- Unit test `detectDirection("qu'ai-je fait hier")` returns `'past'`
- `/memory/query` with "qu'est-ce que j'ai cette semaine" uses interval filter correctly

---

## Implementation Order

```text
1.1 Type Separation (no dependencies)
  |
  +--> 1.2 Event Bus (no dependencies, parallel with 1.1)
  |
  +--> 1.3 Multi-LLM Routing (no dependencies, parallel with 1.1)
  |
  +--> 1.4 AgentContext Types (no dependencies, parallel with 1.1)
  |
  +--> 1.5 Enhanced Temporal (no dependencies, parallel with 1.1)
```

All 5 steps are independent and can be implemented in any order. Recommended: start with 1.1 (type separation) to establish clean boundaries, then 1.2 (event bus) and 1.3 (multi-LLM) in parallel.

---

## Files Summary

### Files to Create

| File                                 | Step |
| ------------------------------------ | ---- |
| `jarvis/src/memory/memory.types.ts`  | 1.1  |
| `jarvis/src/events/jarvis.events.ts` | 1.2  |
| `jarvis/src/agent/agent.types.ts`    | 1.4  |

### Files to Modify

| File                                            | Steps         |
| ----------------------------------------------- | ------------- |
| `jarvis/src/rag/rag.types.ts`                   | 1.1           |
| `jarvis/src/memory/memory.service.ts`           | 1.1, 1.2, 1.5 |
| `jarvis/src/vectorstore/vectorstore.service.ts` | 1.1           |
| `jarvis/src/app.module.ts`                      | 1.2           |
| `jarvis/package.json`                           | 1.2           |
| `jarvis/src/ollama/ollama.service.ts`           | 1.3           |
| `jarvis/.env`                                   | 1.3           |
| `jarvis/src/temporal/temporal.types.ts`         | 1.5           |
| `jarvis/src/temporal/temporal.service.ts`       | 1.5           |

### Dependencies to Install

```bash
cd jarvis && npm install @nestjs/event-emitter
```
