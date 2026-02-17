# Jarvis V2 — Cognitive Personal Agent: Development Plan

> **Status:** Planning complete, ready for iterative implementation
> **Constraint:** 100% local — no cloud services
> **Reference:** This file is the master roadmap. Each phase has a dedicated detail file.

---

## Table of Contents

- [Jarvis V2 — Cognitive Personal Agent: Development Plan](#jarvis-v2--cognitive-personal-agent-development-plan)
  - [Table of Contents](#table-of-contents)
  - [Feature Index with Feasibility](#feature-index-with-feasibility)
  - [5-Phase Roadmap](#5-phase-roadmap)
    - [Phase 1 — Foundations (2-3 weeks)](#phase-1--foundations-2-3-weeks)
    - [Phase 2 — Intent Engine and Agent Core (3-4 weeks)](#phase-2--intent-engine-and-agent-core-3-4-weeks)
    - [Phase 3 — Enriched Memory and Knowledge (3-4 weeks)](#phase-3--enriched-memory-and-knowledge-3-4-weeks)
    - [Phase 4 — Actions and Proactivity (3-4 weeks)](#phase-4--actions-and-proactivity-3-4-weeks)
    - [Phase 5 — Cognitive Depth (4-6 weeks)](#phase-5--cognitive-depth-4-6-weeks)
  - [Quick Wins](#quick-wins)
  - [Dependency Graph](#dependency-graph)
  - [Architectural Decisions](#architectural-decisions)
  - [Infrastructure Requirements](#infrastructure-requirements)
  - [Phase Files](#phase-files)

---

## Feature Index with Feasibility

All features assessed for 100% local feasibility.

| #   | Feature                     | Confidence | Effort | Phase | Detail File                  |
| --- | --------------------------- | ---------- | ------ | ----- | ---------------------------- |
| 1   | Memory mental model (graph) | 75%        | XL     | 3     | phase3-enriched-memory.md    |
| 2   | Temporal reasoning          | 85%        | M      | 1     | phase1-foundations.md        |
| 3   | Hybrid RAG (BM25 + vector)  | 90%        | M      | 3     | phase3-enriched-memory.md    |
| 4   | Intent Layer LLM            | 88%        | M      | 2     | phase2-intent-agent.md       |
| 5   | Event-driven Core           | 95%        | M      | 1     | phase1-foundations.md        |
| 6   | TTS (Piper)                 | DONE       | -      | -     | Already implemented          |
| 7   | Action Engine               | 80%        | L      | 4     | phase4-action-proactivity.md |
| 8   | Personal Knowledge Graph    | 72%        | XL     | 3     | phase3-enriched-memory.md    |
| 9   | Proactivity                 | 82%        | L      | 4     | phase4-action-proactivity.md |
| 10  | Continuous Learning         | 78%        | L      | 5     | phase5-cognitive-depth.md    |
| 11  | Context Fusion              | 90%        | M      | 5     | phase5-cognitive-depth.md    |
| 12  | Plugin System               | 85%        | L      | 4     | phase4-action-proactivity.md |
| 13  | Mood / Sentiment            | 80%        | L      | 5     | phase5-cognitive-depth.md    |
| 14  | Multi-device                | -          | -      | N/A   | Excluded from V2             |
| 15  | Streaming Whisper           | 90%        | S      | 5     | phase5-cognitive-depth.md    |
| 16  | Semantic Chunking           | 80%        | M      | 3     | phase3-enriched-memory.md    |
| 17  | Memory Importance Scoring   | 88%        | M      | 3     | phase3-enriched-memory.md    |
| 18  | Auto Summaries              | 85%        | M      | 3     | phase3-enriched-memory.md    |
| 19  | Hallucination Guard         | 75%        | L      | 5     | phase5-cognitive-depth.md    |
| 20  | Multi-LLM Routing           | 92%        | M      | 1     | phase1-foundations.md        |
| 21  | Life Timeline               | 90%        | S      | 3     | phase3-enriched-memory.md    |
| 22  | Goals Tracking              | 85%        | M      | 4     | phase4-action-proactivity.md |
| 23  | Identity Mode               | 90%        | S      | 4     | phase4-action-proactivity.md |
| 24  | Second Brain / PKM          | 80%        | L      | 5     | phase5-cognitive-depth.md    |

---

## 5-Phase Roadmap

```text
Phase 1 (2-3w) --> Phase 2 (3-4w) --> Phase 3 (3-4w) --> Phase 4 (3-4w) --> Phase 5 (4-6w)
Foundations         Intent + Agent      Enriched Memory     Actions + Proact.   Cognitive Depth
```

### Phase 1 — Foundations (2-3 weeks)

Stabilize and extend core infrastructure for everything that follows.

- 1.1 Type Separation — Extract `MemoryPayload` from `RagPayload`
- 1.2 Event Bus — `@nestjs/event-emitter` with typed events
- 1.3 Multi-LLM Routing — `qwen3:4b` for classification, existing model for generation
- 1.4 AgentContext Types — Shared interfaces for conversation state
- 1.5 Enhanced Temporal — Intervals, recurrence, past/future intent detection

### Phase 2 — Intent Engine and Agent Core (3-4 weeks)

Replace regex classification with LLM-based intent detection; unified `/agent/process` endpoint.

- 2.1 LLM Intent Classifier — qwen3:4b structured JSON, regex fallback
- 2.2 Agent Module — `POST /agent/process` with IntentRouter
- 2.3 Meta-Routing — Correction/Confirmation/Rejection handling
- 2.4 Angular Agent UI — Chat panel with conversation history

### Phase 3 — Enriched Memory and Knowledge (3-4 weeks)

Transform flat memory into structured, scored, entity-aware cognitive store.

- 3.1 Importance Scoring — Recency + access + emotion + future formula
- 3.2 Hybrid RAG (BM25) — Qdrant sparse vectors + RRF fusion
- 3.3 Knowledge Graph — Neo4j Docker, LLM entity extraction
- 3.4 Auto Summaries — Daily/weekly cron via Ollama
- 3.5 Life Timeline — `POST /memory/timeline` endpoint
- 3.6 Semantic Chunking — Replace fixed-size with semantic boundaries

### Phase 4 — Actions and Proactivity (3-4 weeks)

Jarvis acts: reminders, goals, automations, and proactive nudges.

- 4.1 Action Engine — SQLite for reminders/todos, notification polling
- 4.2 Goals Tracking — New Qdrant collection, progress updates
- 4.3 Identity Mode — `identity.json` config, system prompt enrichment
- 4.4 Proactivity — 15min scheduled scan, urgency scoring
- 4.5 Plugin System — `JarvisPlugin` interface, dynamic modules

### Phase 5 — Cognitive Depth (4-6 weeks)

Second-brain capabilities, continuous learning, hallucination prevention.

- 5.1 Context Fusion — Merge memory + RAG + goals per query
- 5.2 Feedback Loop — Thumbs up/down, memory correction
- 5.3 Hallucination Guard — Similarity threshold + self-grounding
- 5.4 Mood / Sentiment — French lexicon, tone adaptation
- 5.5 Streaming Whisper — Chunked transcription, lower latency
- 5.6 Second Brain / PKM — Knowledge graph UI, timeline, goals dashboard

---

## Quick Wins

Features with highest impact-to-effort ratio, achievable in 2-5 days each:

1. **Multi-LLM Routing** (Phase 1.3) — Add `OLLAMA_SMALL_MODEL` env var, immediate perf gain
2. **Intent LLM** (Phase 2.1) — Replace regex, instant comprehension boost
3. **Identity Mode** (Phase 4.3) — JSON config file, 1 hour of work
4. **Life Timeline** (Phase 3.5) — 80% already built, just a new endpoint
5. **Memory Importance Scoring** (Phase 3.1) — Simple formula, big search relevance impact

---

## Dependency Graph

```text
Phase 1 (Foundations)
  1.1 Type Separation --------------------------+
  1.2 Event Bus --------------------------------+--> Phase 3 (Scoring, Summaries, KG)
  1.3 Multi-LLM Routing -----------------------+--> Phase 2 (Intent Engine)
  1.4 AgentContext -----------------------------+
  1.5 Temporal Intervals -----------------------+--> Phase 3 (Timeline), Phase 4 (Reminders)

Phase 2 (Intent + Agent)
  2.1 LLM Classifier (needs 1.3) --------------+
  2.2 Agent Module (needs 2.1, 1.4) -----------+--> Phase 4 (Action/Goals routing)
  2.3 Meta-Routing (needs 2.2) ----------------+--> Phase 5 (Feedback Loop)
  2.4 Angular Agent UI (needs 2.2) ------------+

Phase 3 (Enriched Memory)
  3.1 Importance Scoring (needs 1.2) ----------+
  3.2 Hybrid RAG (independent) ----------------+--> Phase 5 (Context Fusion, Guard)
  3.3 Knowledge Graph (needs 1.2, 3.1) --------+--> Phase 5 (Second Brain)
  3.4 Auto Summaries (needs 1.2) --------------+
  3.5 Timeline (needs 1.5) --------------------+
  3.6 Semantic Chunking (independent) ---------+

Phase 4 (Actions)
  4.1 Action Engine (needs 2.2) ---------------+
  4.2 Goals (needs 2.2) ----------------------+--> Phase 5 (Context Fusion, Brain)
  4.3 Identity (needs 1.4) --------------------+
  4.4 Proactivity (needs 4.1, 3.1) -----------+
  4.5 Plugin System (needs 2.2) ---------------+

Phase 5 (Cognitive Depth)
  5.1 Context Fusion (needs 3.1, 3.2, 4.2) ---+
  5.2 Feedback Loop (needs 2.3, 3.1) ---------+
  5.3 Hallucination Guard (needs 3.2) ---------+
  5.4 Mood Memory (needs 3.1) ----------------+
  5.5 Streaming Whisper (independent) ---------+
  5.6 Second Brain (needs 5.1, 3.3, 4.2) -----+
```

---

## Architectural Decisions

| ID    | Decision                           | Rationale                                                               |
| ----- | ---------------------------------- | ----------------------------------------------------------------------- |
| ADR-1 | Neo4j for Knowledge Graph          | Powerful graph traversal for entity relations. Docker alongside Qdrant. |
| ADR-2 | EventEmitter2 in-process           | Sufficient for local use. Upgrade path to Bull queues later.            |
| ADR-3 | qwen3:4b for intent classification | Fast, good French, structured JSON. Regex fallback for resilience.      |
| ADR-4 | No additional Python ML models     | All inference via Ollama. Minimal footprint.                            |
| ADR-5 | SQLite for CRUD data               | Reminders, todos, feedback. Right tool for structured data.             |
| ADR-6 | Qdrant sparse vectors for BM25     | Native Qdrant 1.7+ feature. No external search engine.                  |
| ADR-7 | Multi-device excluded from V2      | Network sync too complex for local-only. Candidate for V3.              |

---

## Infrastructure Requirements

| Service   | Current | V2 Addition                           |
| --------- | ------- | ------------------------------------- |
| Ollama    | Yes     | Add `qwen3:4b` model                  |
| Qdrant    | Yes     | Sparse vectors config, new collection |
| Neo4j     | No      | New Docker container (Phase 3)        |
| SQLite    | No      | Via `better-sqlite3` npm (Phase 4)    |
| node-cron | No      | Via `@nestjs/schedule` (Phase 3)      |

---

## Phase Files

| File                                                         | Phase | Status |
| ------------------------------------------------------------ | ----- | ------ |
| [phase1-foundations.md](phase1-foundations.md)               | 1     | Ready  |
| [phase2-intent-agent.md](phase2-intent-agent.md)             | 2     | Ready  |
| [phase3-enriched-memory.md](phase3-enriched-memory.md)       | 3     | Ready  |
| [phase4-action-proactivity.md](phase4-action-proactivity.md) | 4     | Ready  |
| [phase5-cognitive-depth.md](phase5-cognitive-depth.md)       | 5     | Ready  |
