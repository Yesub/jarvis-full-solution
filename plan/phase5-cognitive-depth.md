# Phase 5 — Cognitive Depth

> **Duration:** 4-6 weeks
> **Goal:** Second-brain capabilities, continuous learning, hallucination prevention, sentiment memory.
> **Prerequisites:** Phase 3 (3.1 Scoring, 3.2 Hybrid RAG, 3.3 Knowledge Graph), Phase 4 (4.2 Goals)

---

## Overview

Phase 5 is the final layer that makes Jarvis truly intelligent. Context Fusion merges all knowledge sources into a unified view. The Feedback Loop lets Jarvis learn from its mistakes. The Hallucination Guard prevents false answers. Mood Memory adapts Jarvis's tone. Streaming Whisper makes conversations more natural. Second Brain mode ties everything together into a personal knowledge management system.

---

## 5.1 — Context Fusion Engine

**Feasibility:** 90% | **Effort:** M

### Problem

Memory, RAG documents, goals, and conversation history are queried in silos. A question like "Ou en suis-je sur le projet Alpha que j'ai mentionne la semaine derniere ?" requires:

1. Memory search for "projet Alpha" + temporal filter
2. RAG search in `domainknowledge` for project documentation
3. Goals search for "projet Alpha" goal
4. Knowledge graph for entities related to "Alpha"
5. Merging, deduplication, and relevance ranking

Currently, each source is queried independently with no cross-referencing.

### Architecture

```text
User question
  |
  +--> Memory search (jarvis_for_home)
  +--> RAG search (domainknowledge)
  +--> Goals search (jarvis_goals)
  +--> Knowledge Graph query (Neo4j)
  |
  v
Context Fusion (RRF + dedup)
  |
  v
Unified context → LLM prompt
```

### Implementation

**Create:** `jarvis/src/agent/context-fusion/context-fusion.types.ts`

```typescript
export interface ContextSource {
  origin: "memory" | "rag" | "goals" | "knowledge_graph" | "conversation";
  text: string;
  score: number; // normalized 0-1
  metadata: Record<string, unknown>;
}

export interface FusedContext {
  sources: ContextSource[];
  totalSources: number;
  fusionMethod: "rrf";
  prompt: string; // assembled prompt ready for LLM
}
```

**Create:** `jarvis/src/agent/context-fusion/context-fusion.service.ts`

```typescript
@Injectable()
export class ContextFusionService {
  private readonly logger = new Logger(ContextFusionService.name);

  constructor(
    private memoryService: MemoryService,
    private ragService: RagService,
    private goalsService: GoalsService,
    private knowledgeService: KnowledgeService,
    private identityService: IdentityService,
  ) {}

  async buildContext(
    question: string,
    options?: {
      includeRag?: boolean;
      includeGoals?: boolean;
      includeGraph?: boolean;
    },
  ): Promise<FusedContext> {
    const opts = {
      includeRag: true,
      includeGoals: true,
      includeGraph: true,
      ...options,
    };

    const allSources: ContextSource[] = [];

    // 1. Memory search (always)
    const memoryResults = await this.memoryService.search(question, 5);
    for (const r of memoryResults.results) {
      allSources.push({
        origin: "memory",
        text: r.text,
        score: r.score,
        metadata: {
          addedAt: r.addedAt,
          eventDate: r.eventDate,
          contextType: r.contextType,
        },
      });
    }

    // 2. RAG document search (optional)
    if (opts.includeRag) {
      try {
        const ragResults = await this.ragService.searchDocuments(question, 5);
        for (const r of ragResults) {
          allSources.push({
            origin: "rag",
            text: r.text,
            score: r.score,
            metadata: { source: r.source, chunkIndex: r.chunkIndex },
          });
        }
      } catch (e) {
        this.logger.warn(`RAG search failed: ${e.message}`);
      }
    }

    // 3. Goals search (optional)
    if (opts.includeGoals) {
      try {
        const goalsResults = await this.goalsService.searchGoals(question, 3);
        for (const r of goalsResults) {
          allSources.push({
            origin: "goals",
            text: `Objectif: ${r.title} (${r.status})`,
            score: r.score,
            metadata: { goalId: r.id, status: r.status },
          });
        }
      } catch (e) {
        this.logger.warn(`Goals search failed: ${e.message}`);
      }
    }

    // 4. Knowledge Graph (optional)
    if (opts.includeGraph) {
      try {
        const graphResults =
          await this.knowledgeService.searchEntities(question);
        for (const entity of graphResults) {
          allSources.push({
            origin: "knowledge_graph",
            text: `${entity.type}: ${entity.name} — ${entity.relations.map((r) => r.description).join(", ")}`,
            score: 0.8, // fixed score for graph results
            metadata: { entityId: entity.id, type: entity.type },
          });
        }
      } catch (e) {
        this.logger.warn(`Knowledge graph search failed: ${e.message}`);
      }
    }

    // 5. RRF fusion and dedup
    const fused = this.reciprocalRankFusion(allSources, 10);

    // 6. Build prompt
    const identityContext = this.identityService.buildSystemPromptContext();
    const contextBlock = fused
      .map((s, i) => `[Source ${i + 1} - ${s.origin}] ${s.text}`)
      .join("\n\n");

    const prompt = `${identityContext}

Contexte disponible:
${contextBlock}

Question: ${question}

Reponds en francais en utilisant prioritairement le contexte fourni. Cite les sources utilisees.`;

    return {
      sources: fused,
      totalSources: allSources.length,
      fusionMethod: "rrf",
      prompt,
    };
  }

  private reciprocalRankFusion(
    sources: ContextSource[],
    limit: number,
    k: number = 60,
  ): ContextSource[] {
    // Group by origin, rank within each group
    const byOrigin = new Map<string, ContextSource[]>();
    for (const s of sources) {
      const group = byOrigin.get(s.origin) ?? [];
      group.push(s);
      byOrigin.set(s.origin, group);
    }

    // Compute RRF scores
    const rrfScores = new Map<
      string,
      { source: ContextSource; score: number }
    >();

    for (const [, group] of byOrigin) {
      // Sort by score within group
      group.sort((a, b) => b.score - a.score);
      group.forEach((source, rank) => {
        const key = source.text.slice(0, 100); // dedup key
        const existing = rrfScores.get(key);
        const rrfScore = 1 / (k + rank);
        if (existing) {
          existing.score += rrfScore;
        } else {
          rrfScores.set(key, { source, score: rrfScore });
        }
      });
    }

    return [...rrfScores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((v) => ({ ...v.source, score: v.score }));
  }
}
```

**Modify:** `jarvis/src/agent/agent.service.ts` — use fusion for queries:

```typescript
// For MEMORY_QUERY and RAG_QUESTION, use context fusion
const fusedContext = await this.contextFusion.buildContext(
  intent.extractedContent,
  {
    includeRag: intent.primary === IntentType.RAG_QUESTION,
    includeGoals: true,
    includeGraph: true,
  },
);

const answer = await this.ollamaService.generate(fusedContext.prompt);
```

### Verification

- Store a memory about "projet Alpha", ingest a document about "Alpha", set a goal for "Alpha"
- Query "Ou en suis-je sur le projet Alpha ?" → answer draws from all 3 sources
- Verify source attribution in response ("D'apres tes souvenirs...", "Le document indique...")

---

## 5.2 — Continuous Learning / Feedback Loop

**Feasibility:** 78% | **Effort:** L

### Problem

Jarvis has no way to learn from its mistakes. If it gives a wrong answer, the same mistake will recur. No mechanism for user corrections to improve future behavior.

### Feedback Model

```typescript
// jarvis/src/feedback/feedback.types.ts

export interface Feedback {
  id: string;
  sessionId: string;
  messageIndex: number; // which message in the conversation
  intent: string;
  positive: boolean;
  correctionText?: string; // what the user said was the right answer
  sourceIds?: string[]; // which memory/RAG sources were used
  timestamp: string;
}

export interface FeedbackStats {
  totalFeedback: number;
  positiveRate: number;
  commonMisclassifications: Array<{
    expected: string;
    actual: string;
    count: number;
  }>;
}
```

### Implementation

**Create:** `jarvis/src/feedback/feedback.module.ts`

```typescript
@Module({
  imports: [MemoryModule, VectorstoreModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
```

**Create:** `jarvis/src/feedback/feedback.service.ts`

```typescript
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private actionDb: ActionDbService,
    private memoryService: MemoryService,
    private memoryScoringService: MemoryScoringService,
    private vectorstoreService: VectorstoreService,
    private eventEmitter: EventEmitter2,
  ) {}

  async recordFeedback(feedback: Omit<Feedback, 'id' | 'timestamp'>): Promise<void> {
    const record: Feedback = {
      ...feedback,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // Store in SQLite
    this.actionDb.insertFeedback(record);

    // Emit event
    this.eventEmitter.emit(JARVIS_EVENTS.FEEDBACK_RECEIVED, {
      messageId: `${feedback.sessionId}:${feedback.messageIndex}`,
      positive: feedback.positive,
      correctionText: feedback.correctionText,
    });

    // Apply learning effects
    await this.applyFeedbackEffects(record);
  }

  private async applyFeedbackEffects(feedback: Feedback): Promise<void> {
    if (feedback.positive) {
      // Positive: boost importance of sources used
      if (feedback.sourceIds) {
        for (const id of feedback.sourceIds) {
          // Increment access count (treated as positive reinforcement)
          await this.vectorstoreService.updateMemoryPayload(id, {
            accessCount: /* current + 2 */,  // double boost for positive feedback
          });
        }
      }
      this.logger.log('Positive feedback: source importance boosted.');
    } else {
      // Negative: store correction as high-importance memory
      if (feedback.correctionText) {
        await this.memoryService.add(
          `Correction: ${feedback.correctionText}`,
          'feedback_correction',
          'correction',
        );
        this.logger.log(`Negative feedback: correction stored as memory: "${feedback.correctionText}"`);
      }

      // Decrease importance of wrong sources
      if (feedback.sourceIds) {
        for (const id of feedback.sourceIds) {
          await this.vectorstoreService.updateMemoryPayload(id, {
            accessCount: /* max(0, current - 1) */,  // penalty
          });
        }
      }
    }
  }

  async getStats(): Promise<FeedbackStats> {
    const all = this.actionDb.getAllFeedback();
    const positive = all.filter(f => f.positive).length;

    return {
      totalFeedback: all.length,
      positiveRate: all.length > 0 ? positive / all.length : 0,
      commonMisclassifications: [], // TODO: aggregate from negative feedback intents
    };
  }
}
```

**Create:** `jarvis/src/feedback/feedback.controller.ts`

```typescript
@ApiTags("feedback")
@Controller("feedback")
export class FeedbackController {
  constructor(private feedbackService: FeedbackService) {}

  @Post()
  async submitFeedback(
    @Body()
    dto: {
      sessionId: string;
      messageIndex: number;
      intent: string;
      positive: boolean;
      correctionText?: string;
      sourceIds?: string[];
    },
  ) {
    await this.feedbackService.recordFeedback(dto);
    return { acknowledged: true };
  }

  @Get("stats")
  async getStats() {
    return this.feedbackService.getStats();
  }
}
```

### SQLite Schema Addition

Add to `ActionDbService.createTables()`:

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  intent TEXT NOT NULL,
  positive INTEGER NOT NULL,       -- 0 or 1
  correction_text TEXT,
  source_ids TEXT,                  -- JSON array
  timestamp TEXT NOT NULL
);
```

### Angular UI Integration

**Modify:** `jarvis-ui/src/app/agent/agent.component.ts`

Add thumbs up/down buttons on each assistant message:

```typescript
async submitFeedback(messageIndex: number, positive: boolean, correction?: string) {
  await this.apiService.submitFeedback({
    sessionId: this.sessionId,
    messageIndex,
    intent: this.messages[messageIndex].intent,
    positive,
    correctionText: correction,
  });
}
```

### Voice Feedback via Wake-Listener

The existing meta-routing (Phase 2.3) handles voice corrections:

- "C'est pas ca" / "Non" → REJECTION intent → triggers negative feedback
- "C'est parfait" / "Merci" → detected as positive feedback via keyword match

### Verification

- Give thumbs down + correction "La reunion est mardi pas lundi" → correction stored as memory
- Give thumbs up → source importance boosted
- Query same topic later → corrected answer surfaces (correction memory has high importance)
- `GET /feedback/stats` → returns accuracy rate

---

## 5.3 — Hallucination Guard

**Feasibility:** 75% | **Effort:** L

### Problem

The LLM generates plausible but ungrounded answers. When Qdrant returns no relevant sources (low similarity), the LLM still produces a confident-sounding answer based on its training data, not the user's actual memories or documents.

### Three-Layer Guard

| Layer             | Check                                     | Threshold        | Action                                         |
| ----------------- | ----------------------------------------- | ---------------- | ---------------------------------------------- |
| 1. Source quality | Max similarity score of retrieved sources | < 0.4 → refuse   | "Je n'ai pas d'information sur ce sujet."      |
| 2. Confidence     | Max similarity score                      | 0.4 - 0.7 → warn | Prefix: "Je ne suis pas certain, mais..."      |
| 3. Self-grounding | LLM self-check after generation           | NON → flag       | Append: "[Reponse potentiellement non fondee]" |

### Implementation

**Create:** `jarvis/src/agent/hallucination-guard/hallucination-guard.service.ts`

```typescript
@Injectable()
export class HallucinationGuardService {
  private readonly REFUSE_THRESHOLD = 0.4;
  private readonly WARN_THRESHOLD = 0.7;

  constructor(private ollamaService: OllamaService) {}

  assessSources(
    sources: Array<{ score: number; text: string }>,
  ): SourceAssessment {
    if (sources.length === 0) {
      return {
        level: "refuse",
        maxScore: 0,
        message: "Je n'ai pas d'information sur ce sujet dans ma memoire.",
      };
    }

    const maxScore = Math.max(...sources.map((s) => s.score));

    if (maxScore < this.REFUSE_THRESHOLD) {
      return {
        level: "refuse",
        maxScore,
        message: "Je n'ai pas trouve d'information fiable sur ce sujet.",
      };
    }

    if (maxScore < this.WARN_THRESHOLD) {
      return {
        level: "warn",
        maxScore,
        message: "Je ne suis pas certain, mais...",
      };
    }

    return { level: "pass", maxScore };
  }

  async selfGroundingCheck(
    answer: string,
    context: string,
  ): Promise<GroundingResult> {
    const prompt = `Voici un contexte et une reponse generee.

Contexte:
${context}

Reponse:
${answer}

Cette reponse peut-elle etre entierement deduite du contexte fourni ?
Reponds uniquement par OUI ou NON.`;

    const result = await this.ollamaService.generateWith("small", prompt);
    const grounded = result.trim().toUpperCase().startsWith("OUI");

    return {
      grounded,
      warning: grounded
        ? undefined
        : "Cette reponse contient potentiellement des informations non fondees sur le contexte.",
    };
  }
}

interface SourceAssessment {
  level: "pass" | "warn" | "refuse";
  maxScore: number;
  message?: string;
}

interface GroundingResult {
  grounded: boolean;
  warning?: string;
}
```

**Modify:** `jarvis/src/agent/agent.service.ts` — wrap responses with guard:

```typescript
// After getting answer from router
const sourceAssessment = this.hallucinationGuard.assessSources(
  result.sources ?? [],
);

if (sourceAssessment.level === "refuse") {
  return {
    ...response,
    answer: sourceAssessment.message!,
    hallucinationWarning: "No relevant sources found.",
  };
}

let finalAnswer = result.answer;
if (sourceAssessment.level === "warn") {
  finalAnswer = `${sourceAssessment.message} ${finalAnswer}`;
}

// Optional: self-grounding check (adds latency, use for important queries)
if (sourceAssessment.maxScore < 0.6) {
  const grounding = await this.hallucinationGuard.selfGroundingCheck(
    finalAnswer,
    contextText,
  );
  if (!grounding.grounded) {
    response.hallucinationWarning = grounding.warning;
  }
}
```

### Verification

- Query about a topic with no stored memories → "Je n'ai pas d'information..."
- Query about a topic with low-relevance matches → "Je ne suis pas certain, mais..."
- Query about a well-documented topic → clean answer, no warning
- Self-grounding catches fabricated details not in context

---

## 5.4 — Mood and Sentiment Memory

**Feasibility:** 80% | **Effort:** L

### Problem

Jarvis always responds in the same tone regardless of the user's emotional state. If the user says "Je suis stresse par le projet", Jarvis doesn't adapt its tone.

### Approach: French Sentiment Lexicon

No ML model needed. A curated lexicon of French emotional indicators detects sentiment from keywords and phrases.

### Implementation

**Create:** `jarvis/src/mood/mood.module.ts`

```typescript
@Module({
  imports: [MemoryModule],
  providers: [MoodService],
  exports: [MoodService],
})
export class MoodModule {}
```

**Create:** `jarvis/src/mood/sentiment-lexicon.ts`

```typescript
export const POSITIVE_INDICATORS = [
  { word: "content", intensity: 0.7 },
  { word: "heureux", intensity: 0.8 },
  { word: "motive", intensity: 0.7 },
  { word: "fier", intensity: 0.6 },
  { word: "enthousiaste", intensity: 0.8 },
  { word: "confiant", intensity: 0.6 },
  { word: "satisfait", intensity: 0.6 },
  { word: "super", intensity: 0.5 },
  { word: "genial", intensity: 0.7 },
  { word: "excellent", intensity: 0.7 },
];

export const NEGATIVE_INDICATORS = [
  { word: "stresse", intensity: 0.8 },
  { word: "fatigue", intensity: 0.7 },
  { word: "inquiet", intensity: 0.7 },
  { word: "deborde", intensity: 0.8 },
  { word: "frustre", intensity: 0.7 },
  { word: "decourage", intensity: 0.8 },
  { word: "epuise", intensity: 0.9 },
  { word: "anxieux", intensity: 0.8 },
  { word: "triste", intensity: 0.7 },
  { word: "en colere", intensity: 0.8 },
  { word: "deprime", intensity: 0.9 },
  { word: "mal", intensity: 0.5 },
];

export const PHRASE_INDICATORS = [
  {
    pattern: /j['']?en\s+ai\s+marre/i,
    sentiment: "negative" as const,
    intensity: 0.9,
  },
  { pattern: /ca\s+va\s+pas/i, sentiment: "negative" as const, intensity: 0.7 },
  {
    pattern: /ca\s+va\s+bien/i,
    sentiment: "positive" as const,
    intensity: 0.6,
  },
  {
    pattern: /je\s+suis\s+(?:trop|tres)\s+content/i,
    sentiment: "positive" as const,
    intensity: 0.8,
  },
  {
    pattern: /je\s+n['']?en\s+peux\s+plus/i,
    sentiment: "negative" as const,
    intensity: 0.9,
  },
];
```

**Create:** `jarvis/src/mood/mood.service.ts`

```typescript
@Injectable()
export class MoodService {
  private readonly logger = new Logger(MoodService.name);
  private recentMoods: Array<{
    sentiment: string;
    intensity: number;
    timestamp: string;
  }> = [];

  constructor(private memoryService: MemoryService) {}

  detectMood(text: string): MoodDetection {
    const lower = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); // remove accents for matching

    let sentiment: "positive" | "negative" | "neutral" = "neutral";
    let maxIntensity = 0;
    const indicators: string[] = [];

    // Check phrase patterns first (higher priority)
    for (const phrase of PHRASE_INDICATORS) {
      if (phrase.pattern.test(text)) {
        sentiment = phrase.sentiment;
        maxIntensity = Math.max(maxIntensity, phrase.intensity);
        indicators.push(phrase.pattern.source);
      }
    }

    // Check word indicators
    for (const pos of POSITIVE_INDICATORS) {
      if (
        lower.includes(
          pos.word.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        )
      ) {
        if (sentiment === "neutral") sentiment = "positive";
        maxIntensity = Math.max(maxIntensity, pos.intensity);
        indicators.push(pos.word);
      }
    }

    for (const neg of NEGATIVE_INDICATORS) {
      if (
        lower.includes(
          neg.word.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        )
      ) {
        sentiment = "negative"; // negative overrides positive
        maxIntensity = Math.max(maxIntensity, neg.intensity);
        indicators.push(neg.word);
      }
    }

    const detection: MoodDetection = {
      sentiment,
      intensity: maxIntensity,
      indicators,
    };

    // Track recent moods
    if (sentiment !== "neutral") {
      this.recentMoods.push({
        sentiment,
        intensity: maxIntensity,
        timestamp: new Date().toISOString(),
      });
      // Keep last 20
      if (this.recentMoods.length > 20) this.recentMoods.shift();

      // Store significant mood changes in memory
      if (maxIntensity > 0.7) {
        this.memoryService.add(
          `Humeur detectee: ${sentiment} (${indicators.join(", ")})`,
          "mood_detection",
          "mood",
        );
      }
    }

    return detection;
  }

  getRecentMoodTrend(): string {
    if (this.recentMoods.length === 0) return "neutral";

    const recent = this.recentMoods.slice(-5);
    const negCount = recent.filter((m) => m.sentiment === "negative").length;
    const posCount = recent.filter((m) => m.sentiment === "positive").length;

    if (negCount >= 3) return "mostly_negative";
    if (posCount >= 3) return "mostly_positive";
    return "mixed";
  }

  buildToneDirective(): string {
    const trend = this.getRecentMoodTrend();
    switch (trend) {
      case "mostly_negative":
        return "L'utilisateur semble stresse ou fatigue. Sois bienveillant, concis et encourageant. Propose de l'aide si pertinent.";
      case "mostly_positive":
        return "L'utilisateur est de bonne humeur. Sois dynamique et enthousiaste.";
      default:
        return "";
    }
  }
}

export interface MoodDetection {
  sentiment: "positive" | "negative" | "neutral";
  intensity: number; // 0.0 - 1.0
  indicators: string[];
}
```

**Modify:** `jarvis/src/agent/agent.service.ts`

```typescript
async process(dto: AgentProcessDto): Promise<AgentResponse> {
  // Detect mood before routing
  const mood = this.moodService.detectMood(dto.text);
  if (mood.sentiment !== 'neutral') {
    this.logger.debug(`Mood detected: ${mood.sentiment} (${mood.intensity})`);
  }

  // Include tone directive in system prompt
  const toneDirective = this.moodService.buildToneDirective();
  // ... pass to router/LLM generation
}
```

### Verification

- "Je suis stresse par le projet" → mood: negative, intensity: 0.8
- After 3 negative messages → tone switches to empathetic
- "Ca va super bien aujourd'hui" → mood: positive
- Mood stored in memory with `contextType: 'mood'`

---

## 5.5 — Streaming Whisper

**Feasibility:** 90% | **Effort:** S

### Problem

Current STT flow: record all audio until silence → send complete WAV → wait for transcription. This adds 1-3 seconds of latency between user finishing speaking and Jarvis starting to respond.

### Approach: Chunked Transcription

faster-whisper supports processing audio in segments. Instead of waiting for the full recording, send 5-second chunks and get partial transcriptions.

### Implementation

**Modify:** `stt-server/stt_server.py` — add streaming endpoint:

```python
from fastapi.responses import StreamingResponse
import json

@app.post("/transcribe/stream")
async def transcribe_stream(file: UploadFile = File(...)):
    """Transcribe audio and return partial results as JSON lines."""
    content = await file.read()

    # Write to temp file
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(
            tmp_path,
            language=LANGUAGE,
            vad_filter=True,
            beam_size=1,
        )

        async def generate():
            full_text = ""
            for segment in segments:
                full_text += segment.text
                yield json.dumps({
                    "partial": True,
                    "text": segment.text.strip(),
                    "start": segment.start,
                    "end": segment.end,
                    "cumulative": full_text.strip(),
                }) + "\n"

            yield json.dumps({
                "partial": False,
                "text": full_text.strip(),
                "final": True,
            }) + "\n"

        return StreamingResponse(generate(), media_type="application/x-ndjson")
    finally:
        os.unlink(tmp_path)
```

**Modify:** `wake-listener/stt_client.py` — add streaming support:

```python
def transcribe_streaming(self, wav_bytes: bytes) -> str | None:
    """Transcribe with streaming partial results."""
    try:
        response = requests.post(
            f"{self.server_url}/transcribe/stream",
            files={"file": ("recording.wav", wav_bytes, "audio/wav")},
            timeout=30,
            stream=True,
        )
        response.raise_for_status()

        full_text = ""
        for line in response.iter_lines():
            if line:
                data = json.loads(line)
                if data.get("final"):
                    full_text = data["text"]
                    break
                else:
                    logger.debug(f"Partial: {data['text']}")
                    full_text = data.get("cumulative", full_text)

        return full_text.strip() if full_text.strip() else None

    except Exception as e:
        logger.error(f"Streaming transcription failed: {e}")
        return self.transcribe(wav_bytes)  # fallback to batch
```

### Verification

- Long voice command (10+ seconds) → partial results appear in logs
- Final transcription matches batch transcription
- Fallback to batch mode if streaming endpoint fails
- Perceived latency reduction for long commands

---

## 5.6 — Second Brain / PKM Mode

**Feasibility:** 80% | **Effort:** L

### Problem

All previous phases create powerful backend capabilities, but the user interface doesn't expose the full picture. A "Second Brain" mode integrates knowledge graph visualization, timeline browsing, goals dashboard, and connected search into a unified experience.

### Angular Components

**Create:** `jarvis-ui/src/app/knowledge/knowledge.component.ts`

Knowledge graph visualization:

```typescript
@Component({
  selector: "app-knowledge",
  standalone: true,
  // Uses d3.js or @swimlane/ngx-graph for graph rendering
})
export class KnowledgeComponent {
  entities: Entity[] = [];
  relations: Relation[] = [];

  constructor(private apiService: ApiService) {}

  async loadGraph() {
    const data = await this.apiService.getKnowledgeGraph();
    this.entities = data.entities;
    this.relations = data.relations;
    this.renderGraph();
  }

  private renderGraph() {
    // D3 force-directed graph
    // Nodes = entities (color-coded by type)
    // Edges = relations (labeled)
    // Click node → show related memories
  }
}
```

**Create:** `jarvis-ui/src/app/timeline/timeline.component.ts`

Chronological memory browser:

```typescript
@Component({
  selector: "app-timeline",
  standalone: true,
})
export class TimelineComponent {
  events: TimelineEvent[] = [];
  selectedRange: string = "cette semaine";

  constructor(private apiService: ApiService) {}

  async loadTimeline() {
    const data = await this.apiService.getTimeline(this.selectedRange);
    this.events = data.events;
  }

  // Filter by entity, date range, type
  // Visual timeline with event cards
}
```

**Create:** `jarvis-ui/src/app/goals/goals.component.ts`

Goals dashboard:

```typescript
@Component({
  selector: "app-goals",
  standalone: true,
})
export class GoalsComponent {
  goals: Goal[] = [];

  constructor(private apiService: ApiService) {}

  async loadGoals() {
    this.goals = await this.apiService.getGoals();
  }

  // Progress bars, status indicators
  // Add goal form
  // Mark progress
}
```

### API Service Extensions

**Modify:** `jarvis-ui/src/app/api.service.ts`

```typescript
// Knowledge Graph
getKnowledgeGraph(): Observable<{ entities: Entity[]; relations: Relation[] }> {
  return this.http.get<any>(`${this.apiUrl}/knowledge/graph`);
}

// Timeline
getTimeline(range: string): Observable<TimelineResult> {
  return this.http.post<TimelineResult>(`${this.apiUrl}/memory/timeline`, { query: range });
}

// Goals
getGoals(): Observable<Goal[]> {
  return this.http.get<Goal[]>(`${this.apiUrl}/goals`);
}

// Feedback
submitFeedback(feedback: FeedbackDto): Observable<void> {
  return this.http.post<void>(`${this.apiUrl}/feedback`, feedback);
}
```

### Backend: Knowledge Graph API

**Create:** `jarvis/src/knowledge/knowledge.controller.ts`

```typescript
@ApiTags("knowledge")
@Controller("knowledge")
export class KnowledgeController {
  constructor(private knowledgeService: KnowledgeService) {}

  @Get("graph")
  async getGraph(@Query("limit") limit?: number) {
    return this.knowledgeService.getFullGraph(limit ?? 100);
  }

  @Get("entity/:name")
  async getEntity(@Param("name") name: string) {
    return this.knowledgeService.queryByEntity(name);
  }
}
```

### Navigation Update

**Modify:** `jarvis-ui/src/app/app.routes.ts`

```typescript
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./rag/rag.component").then((m) => m.RagComponent),
  },
  {
    path: "agent",
    loadComponent: () =>
      import("./agent/agent.component").then((m) => m.AgentComponent),
  },
  {
    path: "timeline",
    loadComponent: () =>
      import("./timeline/timeline.component").then((m) => m.TimelineComponent),
  },
  {
    path: "knowledge",
    loadComponent: () =>
      import("./knowledge/knowledge.component").then(
        (m) => m.KnowledgeComponent,
      ),
  },
  {
    path: "goals",
    loadComponent: () =>
      import("./goals/goals.component").then((m) => m.GoalsComponent),
  },
];
```

### Dependencies

```bash
cd jarvis-ui && npm install d3 @types/d3
```

### Verification

- Navigate to `/knowledge` → see entity graph with nodes and edges
- Click an entity → see related memories and relations
- Navigate to `/timeline` → see chronological view of memories
- Navigate to `/goals` → see goals with progress indicators
- All views are interconnected (click entity in timeline → opens in knowledge graph)

---

## Implementation Order

```text
5.5 Streaming Whisper (independent — can start immediately)
  |
5.3 Hallucination Guard (needs 3.2 Hybrid RAG)
  |
5.4 Mood Memory (needs 3.1 Importance Scoring)
  |
5.1 Context Fusion (needs 3.1, 3.2, 4.2 Goals)
  |
5.2 Feedback Loop (needs 2.3 Meta-Routing, 3.1 Scoring)
  |
5.6 Second Brain UI (needs all above — final integration)
```

Recommended: start with 5.5 (Streaming Whisper, quick win) and 5.3 (Hallucination Guard) in parallel, then 5.4 (Mood), then 5.1 (Context Fusion), then 5.2 (Feedback), finally 5.6 (Second Brain UI as capstone).

---

## Files Summary

### Files to Create

| File                                                                  | Step |
| --------------------------------------------------------------------- | ---- |
| `jarvis/src/agent/context-fusion/context-fusion.service.ts`           | 5.1  |
| `jarvis/src/agent/context-fusion/context-fusion.types.ts`             | 5.1  |
| `jarvis/src/feedback/feedback.module.ts`                              | 5.2  |
| `jarvis/src/feedback/feedback.service.ts`                             | 5.2  |
| `jarvis/src/feedback/feedback.controller.ts`                          | 5.2  |
| `jarvis/src/feedback/feedback.types.ts`                               | 5.2  |
| `jarvis/src/agent/hallucination-guard/hallucination-guard.service.ts` | 5.3  |
| `jarvis/src/mood/mood.module.ts`                                      | 5.4  |
| `jarvis/src/mood/mood.service.ts`                                     | 5.4  |
| `jarvis/src/mood/mood.types.ts`                                       | 5.4  |
| `jarvis/src/mood/sentiment-lexicon.ts`                                | 5.4  |
| `jarvis-ui/src/app/knowledge/knowledge.component.ts`                  | 5.6  |
| `jarvis-ui/src/app/knowledge/knowledge.component.html`                | 5.6  |
| `jarvis-ui/src/app/knowledge/knowledge.component.css`                 | 5.6  |
| `jarvis-ui/src/app/timeline/timeline.component.ts`                    | 5.6  |
| `jarvis-ui/src/app/timeline/timeline.component.html`                  | 5.6  |
| `jarvis-ui/src/app/timeline/timeline.component.css`                   | 5.6  |
| `jarvis-ui/src/app/goals/goals.component.ts`                          | 5.6  |
| `jarvis-ui/src/app/goals/goals.component.html`                        | 5.6  |
| `jarvis-ui/src/app/goals/goals.component.css`                         | 5.6  |
| `jarvis/src/knowledge/knowledge.controller.ts`                        | 5.6  |

### Files to Modify

| File                                            | Steps                  |
| ----------------------------------------------- | ---------------------- |
| `jarvis/src/agent/agent.service.ts`             | 5.1, 5.3, 5.4          |
| `jarvis/src/agent/agent.module.ts`              | 5.1, 5.3, 5.4          |
| `jarvis/src/app.module.ts`                      | 5.2, 5.4               |
| `jarvis/src/action/action-db.service.ts`        | 5.2 (feedback table)   |
| `jarvis/src/vectorstore/vectorstore.service.ts` | 5.2                    |
| `stt-server/stt_server.py`                      | 5.5                    |
| `wake-listener/stt_client.py`                   | 5.5                    |
| `jarvis-ui/src/app/api.service.ts`              | 5.2, 5.6               |
| `jarvis-ui/src/app/app.routes.ts`               | 5.6                    |
| `jarvis-ui/src/app/agent/agent.component.ts`    | 5.2 (feedback buttons) |

### Dependencies to Install

```bash
cd jarvis-ui && npm install d3 @types/d3
```
