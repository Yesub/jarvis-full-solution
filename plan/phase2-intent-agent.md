# Phase 2 — Intent Engine and Agent Core

> **Duration:** 3-4 weeks
> **Goal:** Replace regex classification with LLM-based intent detection; introduce the unified `/agent/process` endpoint.
> **Prerequisites:** Phase 1 (1.3 Multi-LLM, 1.4 AgentContext)

---

## Overview

This phase is the architectural pivot. Jarvis goes from "endpoint-per-task" to "single intelligent entry point." The Agent Module receives all user input, classifies intent via LLM, routes to the appropriate engine, and returns a unified response.

---

## 2.1 — LLM Intent Classifier

**Feasibility:** 88% | **Effort:** M

### Problem

`command_classifier.py` uses static regex patterns (`_ADD_PATTERNS`, `_QUERY_PATTERNS`). It fails on novel phrasings, has no confidence scores, no entity extraction, and cannot detect multi-intent commands. Only routes to `ADD` / `QUERY` / `UNKNOWN`.

### Intent Types

```typescript
// jarvis/src/agent/intent/intent.types.ts

export enum IntentType {
  // Memory
  MEMORY_ADD = "memory_add",
  MEMORY_QUERY = "memory_query",
  MEMORY_UPDATE = "memory_update",
  MEMORY_DELETE = "memory_delete",

  // Timeline / Scheduling (Phase 4)
  SCHEDULE_EVENT = "schedule_event",
  QUERY_SCHEDULE = "query_schedule",

  // Tasks (Phase 4)
  CREATE_TASK = "create_task",
  QUERY_TASKS = "query_tasks",
  COMPLETE_TASK = "complete_task",

  // Knowledge
  RAG_QUESTION = "rag_question",
  GENERAL_QUESTION = "general_question",

  // Goals (Phase 4)
  ADD_GOAL = "add_goal",
  QUERY_GOALS = "query_goals",

  // Actions (Phase 4)
  EXECUTE_ACTION = "execute_action",

  // Meta
  CORRECTION = "correction",
  CONFIRMATION = "confirmation",
  REJECTION = "rejection",
  CHITCHAT = "chitchat",
  UNKNOWN = "unknown",
}

export interface IntentResult {
  primary: IntentType;
  confidence: number; // 0.0 - 1.0
  secondary?: IntentType; // For multi-intent commands
  extractedContent: string; // The cleaned content without intent prefix
  entities: ExtractedEntities;
  temporal?: {
    type: "datetime" | "interval" | "recurrence";
    value: string;
  };
  priority: "high" | "normal" | "low";
}

export interface ExtractedEntities {
  person?: string;
  location?: string;
  time?: string;
  duration?: string;
  object?: string;
  task?: string;
  frequency?: string;
}
```

### NestJS IntentEngine

**Create:** `jarvis/src/agent/intent/intent.engine.ts`

```typescript
@Injectable()
export class IntentEngine {
  private readonly logger = new Logger(IntentEngine.name);

  constructor(private ollamaService: OllamaService) {}

  async classify(text: string): Promise<IntentResult> {
    try {
      const result = await this.classifyWithLLM(text);
      return result;
    } catch (error) {
      this.logger.warn(
        `LLM classification failed, falling back to regex: ${error.message}`,
      );
      return this.classifyWithRegex(text);
    }
  }

  private async classifyWithLLM(text: string): Promise<IntentResult> {
    const prompt = this.buildClassificationPrompt(text);
    const response = await this.ollamaService.generateWith(
      "small",
      prompt,
      CLASSIFICATION_SYSTEM_PROMPT,
    );

    // Parse JSON from response (handle markdown code blocks)
    const json = this.extractJSON(response);
    return this.validateIntentResult(json, text);
  }

  private classifyWithRegex(text: string): IntentResult {
    // Reimplementation of command_classifier.py logic as fallback
    const lower = text.toLowerCase().trim();

    // ADD patterns
    const addPatterns = [
      /^ajoute(?:\s+(?:que|qu'|une\s+info|le\s+fait\s+que))?\s+/i,
      /^mémorise(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
      /^retiens(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
      /^note(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
      /^souviens[-\s]toi(?:\s+(?:que|qu'))?\s+/i,
      /^n'?oublie\s+pas(?:\s+(?:que|qu'))?\s+/i,
      /^enregistre(?:\s+(?:que|qu'|le\s+fait\s+que))?\s+/i,
    ];

    for (const pattern of addPatterns) {
      const match = text.match(pattern);
      if (match) {
        const content = text.slice(match[0].length).trim();
        if (content) {
          return {
            primary: IntentType.MEMORY_ADD,
            confidence: 0.75,
            extractedContent: content,
            entities: {},
            priority: "normal",
          };
        }
      }
    }

    // QUERY patterns
    const queryPatterns = [
      /\bqu['']?est[-\s]ce\s+que\b/i,
      /\brappelle[-\s]moi\b/i,
      /\bdis[-\s]moi\b/i,
      /\bquand\s+(?:est|ai|avais|se|a|dois)\b/i,
      /\bà\s+quelle\s+heure\b/i,
      /\bquel(?:le)?\s+(?:est|était|heure|jour|date)\b/i,
      /\bai[-\s]je\s+(?:prévu|quelque)\b/i,
    ];

    for (const pattern of queryPatterns) {
      if (pattern.test(text)) {
        return {
          primary: IntentType.MEMORY_QUERY,
          confidence: 0.7,
          extractedContent: text,
          entities: {},
          priority: "normal",
        };
      }
    }

    return {
      primary: IntentType.UNKNOWN,
      confidence: 0.5,
      extractedContent: text,
      entities: {},
      priority: "low",
    };
  }

  private buildClassificationPrompt(text: string): string {
    return `Classify this French voice command and extract information.

User said: "${text}"

Return ONLY valid JSON (no markdown, no explanation):
{
  "primary": "<intent>",
  "confidence": <0.0-1.0>,
  "secondary": "<intent or null>",
  "extractedContent": "<cleaned text without command prefix>",
  "entities": {
    "person": "<name or null>",
    "location": "<place or null>",
    "time": "<temporal expression or null>",
    "object": "<thing or null>",
    "task": "<action or null>"
  },
  "priority": "<high|normal|low>"
}

Available intents:
- memory_add: Store a fact ("Retiens que...", "Ajoute que...")
- memory_query: Ask about stored memories ("Qu'est-ce que j'ai prevu...")
- rag_question: Question about documents ("Que dit le contrat sur...")
- general_question: General knowledge question
- schedule_event: Create an event
- create_task: Create a todo item
- query_tasks: Ask about todos
- add_goal: Set a personal goal
- correction: Correct previous response ("Non, pas ca", "Plutot...")
- confirmation: Confirm ("Oui", "D'accord")
- rejection: Reject ("Non", "Annule")
- chitchat: Greeting or smalltalk
- unknown: Cannot determine intent`;
  }
}
```

**Create:** `jarvis/src/agent/intent/classification-prompt.ts` — system prompt constant:

```typescript
export const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a French personal assistant named Jarvis.
You MUST return ONLY valid JSON. No explanation, no markdown code blocks.
Analyze the user's French voice command and classify it.
Extract entities (person names, locations, times, objects, tasks).
Set confidence based on how clear the intent is.
Set priority to "high" if the command mentions "urgent" or a near-future time.`;
```

### Python Wake-Listener Update

**Modify:** `wake-listener/command_classifier.py` — add LLM classification via backend:

```python
import requests
import json
from enum import Enum

class CommandType(Enum):
    ADD = "ADD"
    QUERY = "QUERY"
    UNKNOWN = "UNKNOWN"

def classify(text: str, api_url: str | None = None) -> tuple[CommandType, str]:
    """Classify with LLM if backend available, fallback to regex."""
    if api_url:
        try:
            result = _classify_with_llm(text, api_url)
            if result:
                return result
        except Exception as e:
            logger.warning(f"LLM classification failed: {e}")

    return _classify_with_regex(text)

def _classify_with_llm(text: str, api_url: str) -> tuple[CommandType, str] | None:
    """Call POST /agent/classify on the NestJS backend."""
    response = requests.post(
        f"{api_url}/agent/classify",
        json={"text": text},
        timeout=5,
    )
    response.raise_for_status()
    data = response.json()

    intent = data.get("primary", "unknown")
    content = data.get("extractedContent", text)

    if intent == "memory_add":
        return (CommandType.ADD, content)
    elif intent in ("memory_query", "query_schedule", "query_tasks", "query_goals"):
        return (CommandType.QUERY, content)
    else:
        return (CommandType.UNKNOWN, text)

def _classify_with_regex(text: str) -> tuple[CommandType, str]:
    """Original regex classification (existing code, restructured)."""
    # ... existing _ADD_PATTERNS and _QUERY_PATTERNS logic ...
```

**Modify:** `wake-listener/wake_listener.py` — pass `api_url` to classifier:

```python
cmd_type, content = classify(text, api_url=config.jarvis_api_url)
```

### Verification

- Test with 20+ French phrases covering all intent types
- Verify regex fallback works when Ollama is stopped
- Verify qwen3:4b responds in < 2 seconds for classification
- Check JSON parsing handles edge cases (code blocks, extra whitespace)

---

## 2.2 — Agent Module with IntentRouter

**Feasibility:** 90% | **Effort:** L

### Architecture

```text
POST /agent/process { sessionId?, text, source? }
  |
  v
AgentService.process(dto)
  |
  +--> IntentEngine.classify(text)         // Step 1: Understand
  +--> AgentContextManager.get(sessionId)  // Step 2: Context
  +--> IntentRouter.route(intent, ctx)     // Step 3: Route
  +--> Engine.execute(intent, ctx)         // Step 4: Execute
  +--> AgentContextManager.update(result)  // Step 5: Remember
  |
  v
AgentResponse { sessionId, intent, confidence, answer, sources?, actions? }
```

### Files to Create

**`jarvis/src/agent/agent.module.ts`**

```typescript
@Module({
  imports: [OllamaModule, MemoryModule, RagModule, LlmModule, TemporalModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    IntentEngine,
    IntentRouterService,
    AgentContextManager,
  ],
  exports: [AgentService],
})
export class AgentModule {}
```

**`jarvis/src/agent/agent.controller.ts`**

```typescript
@ApiTags("agent")
@Controller("agent")
export class AgentController {
  constructor(private agentService: AgentService) {}

  @Post("process")
  async process(@Body() dto: AgentProcessDto): Promise<AgentResponse> {
    return this.agentService.process(dto);
  }

  @Post("classify")
  async classify(@Body() dto: { text: string }): Promise<IntentResult> {
    return this.agentService.classify(dto.text);
  }

  @Post("process/stream")
  async processStream(@Body() dto: AgentProcessDto, @Res() res: Response) {
    // SSE streaming pattern (same as RAG controller)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const result = await this.agentService.processStream(dto);

    // Send metadata first
    res.write(
      `event: metadata\ndata: ${JSON.stringify({
        sessionId: result.sessionId,
        intent: result.intent,
        confidence: result.confidence,
        sources: result.sources,
      })}\n\n`,
    );

    // Stream tokens
    for await (const token of result.tokenStream) {
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
}
```

**`jarvis/src/agent/agent.service.ts`**

```typescript
@Injectable()
export class AgentService {
  constructor(
    private intentEngine: IntentEngine,
    private router: IntentRouterService,
    private contextManager: AgentContextManager,
    private eventEmitter: EventEmitter2,
  ) {}

  async classify(text: string): Promise<IntentResult> {
    return this.intentEngine.classify(text);
  }

  async process(dto: AgentProcessDto): Promise<AgentResponse> {
    const sessionId = dto.sessionId ?? randomUUID();
    const context = this.contextManager.getOrCreate(sessionId);

    // Classify intent
    const intent = await this.intentEngine.classify(dto.text);

    // Emit event
    this.eventEmitter.emit(JARVIS_EVENTS.INTENT_CLASSIFIED, {
      text: dto.text,
      intent: intent.primary,
      confidence: intent.confidence,
      sessionId,
    });

    // Check for meta-intents (correction, confirmation, rejection)
    if (this.isMetaIntent(intent.primary)) {
      return this.handleMetaIntent(intent, context, sessionId);
    }

    // Route to appropriate engine
    const result = await this.router.route(intent, context);

    // Update context
    this.contextManager.addMessage(sessionId, "user", dto.text, intent.primary);
    this.contextManager.addMessage(sessionId, "assistant", result.answer);

    return {
      sessionId,
      intent: intent.primary,
      confidence: intent.confidence,
      answer: result.answer,
      sources: result.sources,
      actions: result.actions,
    };
  }

  private isMetaIntent(intent: IntentType): boolean {
    return [
      IntentType.CORRECTION,
      IntentType.CONFIRMATION,
      IntentType.REJECTION,
    ].includes(intent);
  }
}
```

**`jarvis/src/agent/router/intent-router.service.ts`**

```typescript
@Injectable()
export class IntentRouterService {
  constructor(
    private memoryService: MemoryService,
    private ragService: RagService,
    private llmService: LlmService,
  ) {}

  async route(
    intent: IntentResult,
    context: AgentContext,
  ): Promise<EngineResult> {
    switch (intent.primary) {
      case IntentType.MEMORY_ADD:
        return this.handleMemoryAdd(intent);

      case IntentType.MEMORY_QUERY:
        return this.handleMemoryQuery(intent);

      case IntentType.RAG_QUESTION:
        return this.handleRagQuestion(intent);

      case IntentType.GENERAL_QUESTION:
      case IntentType.CHITCHAT:
        return this.handleGeneralQuestion(intent);

      // Phase 4 intents — return "not yet implemented" gracefully
      case IntentType.SCHEDULE_EVENT:
      case IntentType.CREATE_TASK:
      case IntentType.ADD_GOAL:
      case IntentType.EXECUTE_ACTION:
        return {
          answer: "Cette fonctionnalite n'est pas encore disponible.",
          sources: [],
        };

      default:
        return this.handleUnknown(intent);
    }
  }

  private async handleMemoryAdd(intent: IntentResult): Promise<EngineResult> {
    const result = await this.memoryService.add(
      intent.extractedContent,
      "agent",
      "memory",
    );
    return {
      answer: result.eventDate
        ? `C'est note. J'ai detecte une date : ${result.expression}.`
        : "C'est note.",
    };
  }

  private async handleMemoryQuery(intent: IntentResult): Promise<EngineResult> {
    const result = await this.memoryService.query(intent.extractedContent);
    return {
      answer: result.answer,
      sources: result.sources,
    };
  }

  private async handleRagQuestion(intent: IntentResult): Promise<EngineResult> {
    const result = await this.ragService.ask(intent.extractedContent);
    return {
      answer: result.answer,
      sources: result.sources,
    };
  }

  private async handleGeneralQuestion(
    intent: IntentResult,
  ): Promise<EngineResult> {
    const answer = await this.llmService.ask(intent.extractedContent);
    return { answer };
  }

  private async handleUnknown(intent: IntentResult): Promise<EngineResult> {
    return {
      answer:
        "Je n'ai pas bien compris votre demande. Pouvez-vous reformuler ?",
    };
  }
}

interface EngineResult {
  answer: string;
  sources?: Array<{ text: string; score: number }>;
  actions?: AgentAction[];
}
```

**`jarvis/src/agent/context/agent-context.manager.ts`**

```typescript
@Injectable()
export class AgentContextManager {
  private sessions = new Map<string, AgentContext>();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  getOrCreate(sessionId: string): AgentContext {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        history: [],
      });
    }
    this.cleanup();
    return this.sessions.get(sessionId)!;
  }

  addMessage(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    intent?: string,
  ) {
    const ctx = this.getOrCreate(sessionId);
    ctx.history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      intent,
    });
    // Keep last 20 messages
    if (ctx.history.length > 20) {
      ctx.history = ctx.history.slice(-20);
    }
  }

  setPendingConfirmation(sessionId: string, confirmation: PendingConfirmation) {
    const ctx = this.getOrCreate(sessionId);
    ctx.pendingConfirmation = confirmation;
  }

  clearPendingConfirmation(sessionId: string) {
    const ctx = this.getOrCreate(sessionId);
    ctx.pendingConfirmation = undefined;
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, ctx] of this.sessions) {
      const lastMessage = ctx.history[ctx.history.length - 1];
      if (lastMessage) {
        const age = now - new Date(lastMessage.timestamp).getTime();
        if (age > this.TTL_MS) {
          this.sessions.delete(id);
        }
      }
    }
  }
}
```

**Modify:** `jarvis/src/app.module.ts` — add AgentModule:

```typescript
imports: [
  // ... existing
  AgentModule,
],
```

### Verification

- `POST /agent/process { "text": "Retiens que j'ai un RDV demain" }` → intent: `memory_add`, stores in memory
- `POST /agent/process { "text": "Qu'ai-je prevu demain" }` → intent: `memory_query`, returns answer
- `POST /agent/process { "text": "Que dit le contrat sur..." }` → intent: `rag_question`
- `POST /agent/classify { "text": "Bonjour Jarvis" }` → intent: `chitchat`
- Session continuity: two sequential calls with same `sessionId` maintain history
- Swagger documentation at `/api` shows new endpoints

---

## 2.3 — Meta-Routing (Correction, Confirmation, Rejection)

**Feasibility:** 85% | **Effort:** M

### Problem

If Jarvis stores the wrong memory and the user says "Non, pas ca" or "Plutot demain a 15h", there is no way to correct the previous action. Each command is independent.

### Implementation

**Modify:** `jarvis/src/agent/agent.service.ts` — add meta-intent handling:

```typescript
private async handleMetaIntent(
  intent: IntentResult,
  context: AgentContext,
  sessionId: string,
): Promise<AgentResponse> {
  const pending = context.pendingConfirmation;

  switch (intent.primary) {
    case IntentType.CONFIRMATION:
      if (pending) {
        // Execute the pending action
        const result = await this.executePendingAction(pending);
        this.contextManager.clearPendingConfirmation(sessionId);
        return { sessionId, intent: 'confirmation', confidence: intent.confidence,
                 answer: result.answer, actions: [{ type: pending.action,
                 description: 'Confirmed and executed', status: 'executed' }] };
      }
      return { sessionId, intent: 'confirmation', confidence: intent.confidence,
               answer: "Il n'y a rien en attente de confirmation." };

    case IntentType.REJECTION:
      if (pending) {
        this.contextManager.clearPendingConfirmation(sessionId);
        return { sessionId, intent: 'rejection', confidence: intent.confidence,
                 answer: "D'accord, j'annule.", actions: [{ type: pending.action,
                 description: 'Rejected', status: 'failed' }] };
      }
      return { sessionId, intent: 'rejection', confidence: intent.confidence,
               answer: "Il n'y a rien a annuler." };

    case IntentType.CORRECTION:
      // Re-classify the correction content and re-route
      const correctedIntent = await this.intentEngine.classify(intent.extractedContent);
      return this.process({
        sessionId,
        text: intent.extractedContent,
        source: 'api',
      });
  }
}
```

### Flow Example

```text
User: "Retiens que j'ai RDV avec Paul lundi"
Jarvis: "C'est note."

User: "Non, c'est mardi pas lundi"
Intent: CORRECTION, extractedContent: "j'ai RDV avec Paul mardi"
-> Re-route as MEMORY_ADD with corrected content
Jarvis: "C'est corrige. J'ai note: RDV avec Paul mardi."
```

### Verification

- Send "Oui" after a pending confirmation → action executes
- Send "Non" after a pending confirmation → action cancelled
- Send "Plutot demain" after a memory add → new memory with corrected date

---

## 2.4 — Angular Agent UI

**Feasibility:** 92% | **Effort:** M

### Problem

The Angular frontend only has RAG/LLM panels. No interface for the unified agent conversation.

### Implementation

**Create:** `jarvis-ui/src/app/agent/agent.component.ts`

Standalone Angular component with:

- Conversation history display (message bubbles, user/assistant differentiation)
- Text input with send button
- Microphone button (reuse existing `SpeechService`)
- Streaming support via `fetch()` + `ReadableStream` (same pattern as RAG)
- Session ID management (stored in component state)
- Intent badge on each assistant message (showing detected intent + confidence)

**Create:** `jarvis-ui/src/app/models/agent.models.ts`

```typescript
export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  intent?: string;
  confidence?: number;
  sources?: Array<{ text: string; score: number }>;
}

export interface AgentRequest {
  sessionId?: string;
  text: string;
  source?: "voice" | "ui";
}

export interface AgentStreamMetadata {
  sessionId: string;
  intent: string;
  confidence: number;
  sources?: Array<{ text: string; score: number }>;
}
```

**Modify:** `jarvis-ui/src/app/api.service.ts` — add agent methods:

```typescript
async processAgent(sessionId: string, text: string): Promise<AgentResponse> {
  return this.http.post<AgentResponse>(`${this.apiUrl}/agent/process`, {
    sessionId, text, source: 'ui',
  }).toPromise();
}

processAgentStream(sessionId: string, text: string): Observable<AgentStreamEvent> {
  // Same fetch + ReadableStream SSE pattern as askRagStream
}
```

**Modify:** `jarvis-ui/src/app/app.routes.ts` — add route:

```typescript
{ path: 'agent', loadComponent: () => import('./agent/agent.component').then(m => m.AgentComponent) },
```

**Modify:** Navigation — add "Agent" tab alongside existing RAG/LLM tabs.

### Verification

- Navigate to `/agent` — conversation UI loads
- Type "Bonjour" → get chitchat response with intent badge
- Type "Retiens que j'ai un rendez-vous demain" → memory stored, confirmation displayed
- Type "Qu'ai-je prevu demain" → memory query with streamed response
- Microphone works for voice input

---

## Implementation Order

```text
2.1 LLM Intent Classifier (needs 1.3 Multi-LLM)
  |
  v
2.2 Agent Module + IntentRouter (needs 2.1 + 1.4 AgentContext)
  |
  +--> 2.3 Meta-Routing (needs 2.2)
  |
  +--> 2.4 Angular Agent UI (needs 2.2, parallel with 2.3)
```

2.3 and 2.4 can be developed in parallel once 2.2 is complete.

---

## Files Summary

### Files to Create

| File                                                | Step |
| --------------------------------------------------- | ---- |
| `jarvis/src/agent/intent/intent.types.ts`           | 2.1  |
| `jarvis/src/agent/intent/intent.engine.ts`          | 2.1  |
| `jarvis/src/agent/intent/classification-prompt.ts`  | 2.1  |
| `jarvis/src/agent/agent.module.ts`                  | 2.2  |
| `jarvis/src/agent/agent.controller.ts`              | 2.2  |
| `jarvis/src/agent/agent.service.ts`                 | 2.2  |
| `jarvis/src/agent/router/intent-router.service.ts`  | 2.2  |
| `jarvis/src/agent/context/agent-context.manager.ts` | 2.2  |
| `jarvis-ui/src/app/agent/agent.component.ts`        | 2.4  |
| `jarvis-ui/src/app/agent/agent.component.html`      | 2.4  |
| `jarvis-ui/src/app/agent/agent.component.css`       | 2.4  |
| `jarvis-ui/src/app/models/agent.models.ts`          | 2.4  |

### Files to Modify

| File                                  | Steps |
| ------------------------------------- | ----- |
| `wake-listener/command_classifier.py` | 2.1   |
| `wake-listener/wake_listener.py`      | 2.1   |
| `jarvis/src/app.module.ts`            | 2.2   |
| `jarvis-ui/src/app/api.service.ts`    | 2.4   |
| `jarvis-ui/src/app/app.routes.ts`     | 2.4   |
