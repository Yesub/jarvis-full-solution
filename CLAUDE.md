# Jarvis Full Solution

Assistant IA avec RAG (Retrieval-Augmented Generation), LLM local et transcription vocale.

## Architecture

```
jarvis-full-solution/
├── jarvis/          # Backend API (NestJS, port 3000)
├── jarvis-ui/       # Frontend (Angular 21, port 4200)
├── stt-server/      # Serveur STT (FastAPI/Whisper, port 8300)
├── wake-listener/   # Détection wake word "Hey Jarvis" (OpenWakeWord, Python)
└── docker-qdrant/   # Base vectorielle Qdrant (Docker, port 6333)
```

### Flux de communication

```
Angular (4200) ──HTTP/CORS──► NestJS (3000) ──► Ollama (11434)  [LLM + Embeddings]
                                             ──► Qdrant (6333)   [Recherche vectorielle]
                                             ──► STT Server (8300) [Transcription audio]

Wake Listener (micro local) ──► STT Server (8300) [Transcription audio]
                            ──► NestJS (3000)      [Mémoire : /memory/add, /memory/query]
```

## Composants

### jarvis/ — Backend NestJS

Point d'entrée : `src/main.ts` (port 3000, Swagger sur `/api`)

Global : `AllExceptionsFilter` (erreurs structurées JSON), `LoggingInterceptor` (logs method/URL/durée), `ValidationPipe` (whitelist + transform)

| Module / Controller | Routes                                                        | Rôle                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RAG                 | `POST /rag/ingest` (max 50 MB), `/rag/ask`, `/rag/ask/stream` | Ingestion de documents (PDF/TXT/MD) et texte brut, Q&A avec contexte vectoriel. Le stream émet `event: metadata` (sources, topK) puis les tokens                                                               |
| Memory              | `POST /memory/add`, `/memory/search`, `/memory/query`         | Mémoire conversationnelle persistante avec contexte temporel. `/memory/add` stocke un fait, `/memory/search` cherche par similarité + filtre date, `/memory/query` répond en langage naturel avec contexte LLM |
| LLM                 | `POST /llm/ask`, `/llm/ask/stream`                            | Génération LLM directe sans contexte RAG (pas de system prompt)                                                                                                                                                |
| STT                 | `POST /stt/transcribe` (max 25 MB)                            | Proxy vers le serveur Python Whisper (fichier temp supprimé après transcription)                                                                                                                               |
| HealthController    | `GET /health`                                                 | Check de santé (controller standalone dans AppModule, pas de module dédié)                                                                                                                                     |
| ConfigModule        | (global)                                                      | Chargement `.env` via `@nestjs/config`                                                                                                                                                                         |
| Ollama              | (service interne)                                             | Client Ollama multi-modèle : `embed()`, `generate()`, `generateWith(size)` avec routage small/medium/large                                                                                                     |
| Agent               | `POST /agent/process`, `POST /agent/classify`                 | Orchestration complète : classification → routing → réponse contextuelle. `AgentService` + `IntentRouterService` + `AgentContextManager`. Module enregistré dans AppModule (Phase 2.2)                         |
| Vectorstore         | (service interne)                                             | Client Qdrant, gère deux collections : `domainknowledge` (documents) et `jarvis_for_home` (mémoire)                                                                                                            |
| Temporal            | (service interne)                                             | Extraction d'expressions temporelles françaises via chrono-node (`chrono.fr.parse`)                                                                                                                            |

**Stack :** NestJS 11, TypeScript, LangChain (PDFLoader, text splitting), Qdrant JS Client, chrono-node, class-validator, class-transformer

#### Module Memory (`src/memory/`)

- **MemoryService** : coordonne Ollama (embeddings + génération), VectorstoreService (collection `jarvis_for_home`), TemporalService et MemoryScoringService (Phase 3.1)
  - `add(text, source?, contextType?)` : extrait la date d'événement via TemporalService, calcule `importance` via `MemoryScoringService.computeImportance()`, embed le texte, stocke dans Qdrant avec `addedAt`, `eventDate?`, `importance` et `accessCount: 0`
  - `search(query, topK?, dateFilter?)` : recherche sémantique avec filtre de plage de dates optionnel (`eventDate` ou `addedAt`) ; re-rank les résultats par `vectorScore × importance` (fallback `0.3` pour anciens souvenirs) ; expose `importance` et `accessCount` dans chaque résultat
  - `query(question, topK?)` : Q&A complet — utilise `parseInterval()` en priorité pour les plages de dates (ex. "la semaine dernière"), sinon `parse()` étendu au jour entier ; filtre auto sur `eventDate`, génère une réponse LLM en français. Retourne `{ answer, sources, topK, temporalContext? }`
- **MemoryScoringService** (`src/memory/memory-scoring.service.ts`) — Phase 3.1 :
  - `computeImportance(text, eventDate?)` → score à la création (recency=1.0, access=0.0)
  - `recomputeImportance(addedAt, accessCount, text, eventDate?)` → score recalculé à l'accès
  - Formule : `0.3 * recency + 0.3 * access + 0.2 * emotion + 0.2 * future` (chaque facteur 0–1)
  - `emotionScore` : mots-clés (important, urgent, critique, attention, crucial, prioritaire, essentiel, inquiet, stresse) → 1.0, sinon 0.3
  - `futureScore` : `eventDate` futur → 1.0, aujourd'hui → 0.5, passé → 0.1, absent → 0.3
  - `recencyScore` : `exp(-0.05 * daysSinceCreation)`
- **DTOs** : `MemoryAddDto`, `MemorySearchDto` (avec `DateFilterDto` imbriqué), `MemoryQueryDto`
- **Types** : `MemoryPayload` défini dans `src/memory/memory.types.ts` — champs `importance?: number` et `accessCount?: number` actifs depuis Phase 3.1

#### Event Bus (`src/memory/memory.events.listener.ts`)

NestJS EventEmitter2 configuré avec `wildcard: true` dans AppModule. Les événements mémoire sont émis par `MemoryService` et consommés par `MemoryEventsListener` (injecte `VectorstoreService` + `MemoryScoringService` depuis Phase 3.1) :

| Événement         | Données                                        | Comportement                                                                                          |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `MEMORY_ADDED`    | `{ id, source?, eventDate?, text }`            | Log de confirmation avec aperçu du texte                                                              |
| `MEMORY_SEARCHED` | `{ query, resultCount, topK, resultIds[] }`    | Log + incrémente `accessCount` et recalcule `importance` pour chaque point retourné (fire-and-forget) |
| `MEMORY_QUERIED`  | `{ question, topK, sourceIds }`                | Log de la question et des IDs sources                                                                 |

#### Module Ollama (`src/ollama/`)

Routage multi-modèle via `resolveModel(size: 'small' | 'medium' | 'large')` :

| Taille   | Variable env             | Modèle par défaut | Usage                                     |
| -------- | ------------------------ | ----------------- | ----------------------------------------- |
| `small`  | `OLLAMA_LLM_SMALL_MODEL` | `qwen3:4b`        | Classification, intention, tâches légères |
| `medium` | `OLLAMA_LLM_MODEL`       | `mistral:latest`  | Génération mémoire, résumés               |
| `large`  | `OLLAMA_LLM_LARGE_MODEL` | `qwen3.5:9b`      | RAG, raisonnement complexe                |

Méthodes disponibles : `generate(prompt)` / `generateStream(prompt)` (modèle medium par défaut), `generateWith(size, prompt)` / `generateStreamWith(size, prompt)` (taille explicite).

#### Module Agent (`src/agent/`)

Créé en Phase 1.4 (types partagés), enrichi en Phase 2.1 (intent engine), complété en Phase 2.2 (module complet + routing) et Phase 2.3 (meta-routing). Enregistré dans `AppModule`.

**Types partagés** (`src/agent/agent.types.ts`) :

- `AgentContext` — session, historique, intent actif, confirmations en attente, contexte temporel
- `ConversationMessage` — rôle, contenu, timestamp, intent + confiance
- `PendingConfirmation` — paramètres d'action avec TTL (expiry ISO 8601)
- `IdentityProfile` — nom, rôle, projets, priorités, préférences utilisateur
- `AgentProcessDto` — DTO d'entrée : `sessionId`, `text`, `source`
- `AgentResponse` — `sessionId`, intent, confiance, réponse, sources, actions, `hallucinationWarning?`
- `AgentAction` — type, description, statut (`executed` | `pending_confirmation` | `failed`)
- `PENDING_ACTIONS` — constante `as const` registrant les types d'actions confirmables : `MEMORY_ADD`, `MEMORY_QUERY`, `RAG_QUESTION` ; `PendingActionType` dérivé pour le typage strict

**Intent Engine** (`src/agent/intent/`) — implémenté en Phase 2.1 :

- `IntentEngine` (`intent.engine.ts`) : classification dual-path LLM-first → regex fallback
  - `classify(text)` → `IntentResult` — méthode principale, ne lève jamais d'exception
  - `classifyWithLLM(text)` → appelle `OllamaService.generateWith('small', ...)` avec `qwen3:4b` ; extrait le JSON en gérant les balises `<think>` (qwen3) et les blocs ` ```json ` ; retourne `null` si Ollama indisponible
  - `classifyWithRegex(text)` → miroir synchrone des patterns de `command_classifier.py`
- `IntentType` (`intent.types.ts`) : enum de 18 types — mémoire (MEMORY_ADD, MEMORY_QUERY, MEMORY_UPDATE, MEMORY_DELETE), agenda (SCHEDULE_EVENT, QUERY_SCHEDULE), tâches (CREATE_TASK, QUERY_TASKS, COMPLETE_TASK), connaissance (RAG_QUESTION, GENERAL_QUESTION), objectifs (ADD_GOAL, QUERY_GOALS), actions (EXECUTE_ACTION), meta (CORRECTION, CONFIRMATION, REJECTION, CHITCHAT, UNKNOWN)
- `IntentResult` : `{ intent, confidence: number, extractedContent, entities: ExtractedEntities, source: 'llm'|'regex', priority: 'high'|'normal'|'low', secondary? }`
- `CLASSIFICATION_SYSTEM_PROMPT` (`classification-prompt.ts`) : prompt système en français pour qwen3:4b ; décrit les 18 types d'intents, impose un JSON strict sans prose ni balises markdown

**AgentService** (`src/agent/agent.service.ts`) — orchestration Phase 2.2 + 2.3 :

- `classify(text)` → délègue à `IntentEngine`
- `process(dto)` → flux principal : `getOrCreate(sessionId)` → `classify(text)` → emit event → `handleMetaIntent()` ou `router.route()` → `addMessage()` → `AgentResponse`
- `handleMetaIntent(intent, context, text)` async — gère les trois cas meta :
  - **CORRECTION** : re-classifie le texte corrigé via `IntentEngine`, re-route via `IntentRouterService` (garde anti-récursion si la correction est elle-même un meta-intent)
  - **CONFIRMATION** : valide le TTL de `PendingConfirmation`, appelle `executePendingAction()` si non expiré
  - **REJECTION** : annule l'action en attente, met à jour l'historique de session
- `executePendingAction(type, params)` → dispatche selon `PENDING_ACTIONS` : `MEMORY_ADD` → `MemoryService.add()`, `MEMORY_QUERY` → `MemoryService.query()`, `RAG_QUESTION` → `RagService.ask()`

**IntentRouterService** (`src/agent/router/intent-router.service.ts`) — Phase 2.2 :

- `route(intentResult, context)` → `EngineResult` — switch sur 18 `IntentType`
- Dispatche vers `MemoryService` (MEMORY_ADD, MEMORY_QUERY), `RagService` (RAG_QUESTION), `LlmService` (GENERAL_QUESTION, CHITCHAT)
- Intents Phase 4 (SCHEDULE_EVENT, CREATE_TASK, ADD_GOAL, EXECUTE_ACTION…) retournent un message graceful "not yet implemented"
- UNKNOWN retourne un message "je n'ai pas compris"
- Le router est stateless : aucune modification de contexte session

**AgentContextManager** (`src/agent/context/agent-context.manager.ts`) — Phase 2.2 :

- Sessions en mémoire dans un `Map<string, AgentContext>`, TTL 30 minutes
- `getOrCreate(sessionId?)` — crée un UUID si absent, nettoie les sessions expirées à chaque appel
- `addMessage(sessionId, message)` — ajoute un `ConversationMessage`, conserve les 20 derniers
- `setPendingConfirmation(sessionId, confirmation)` / `clearPendingConfirmation(sessionId)` — gère les actions en attente de confirmation utilisateur

#### Module Temporal (`src/temporal/`)

- **TemporalService** : parse les expressions de date/heure en français (ex. "ce soir à 20h", "demain", "vendredi prochain")
  - `parse(text, referenceDate?)` → `TemporalResult | null` (première expression)
  - `parseAll(text, referenceDate?)` → `TemporalResult[]` (toutes les expressions)
  - `parseInterval(text, referenceDate?)` → `TemporalInterval | null` — extrait une plage de dates (ex. "la semaine dernière", "entre lundi et mercredi") ; pour une date unique, étend au jour entier (00:00–23:59:59.999)
  - `detectRecurrence(text)` → `RecurrencePattern | null` — détecte les patterns récurrents via regex (ex. "tous les mardis" → `{ frequency: 'weekly', dayOfWeek: 2 }`, "chaque jour" → `{ frequency: 'daily' }`)
  - `detectDirection(text)` → `TemporalDirection` — détermine l'orientation temporelle (past / future / present / unknown) via indicateurs français (ex. "hier" → `'past'`, "demain" → `'future'`)

- **Types** (`src/temporal/temporal.types.ts`) :
  - `TemporalResult` : `{ expression: string, resolvedDate: string }` (ISO 8601 UTC)
  - `TemporalInterval` : `{ expression: string, start: string, end: string }` (ISO 8601 UTC)
  - `RecurrencePattern` : `{ expression: string, frequency: 'daily'|'weekly'|'monthly'|'yearly', dayOfWeek?: number, dayOfMonth?: number, time?: string }`
  - `TemporalDirection` : `'past' | 'future' | 'present' | 'unknown'`
  - Option `forwardDate: true` dans `parse()`/`parseAll()` pour résoudre les ambiguïtés vers le futur

#### Stratégie Qdrant dual-collection

| Collection        | Usage                      | Champs payload                                                                              |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `domainknowledge` | Documents RAG (PDF/TXT/MD) | `source`, `chunkIndex`, `text`                                                              |
| `jarvis_for_home` | Mémoire conversationnelle  | `source`, `text`, `addedAt`, `contextType`, `eventDate?`, `importance`, `accessCount`       |

Les index datetime sont créés automatiquement sur `addedAt` et `eventDate` dans `jarvis_for_home`. `importance` et `accessCount` sont mis à jour via `setPayload()` après chaque recherche (Phase 3.1). Méthodes `VectorstoreService` ajoutées : `retrieveMemoryPoints(ids[])` et `updateMemoryPayload(pointId, fields)` avec `wait: false` (best-effort).

### jarvis-ui/ — Frontend Angular

Point d'entrée : `src/main.ts` (port 4200)

Architecture **standalone components** (pas de NgModules). Deux routes lazy-loaded : `''` → `RagComponent`, `'agent'` → `AgentComponent`. Navigation toolbar avec onglets "RAG / LLM" et "Agent" (`routerLink` + `routerLinkActive`).

**`RagComponent`** (`src/app/rag.component.ts`) — page RAG/LLM avec 3 sections :

1. **Ingestion** — Upload de fichiers vers la base vectorielle
2. **RAG** — Questions avec contexte documentaire (streaming SSE)
3. **LLM** — Questions directes au LLM (streaming SSE)

**`AgentComponent`** (`src/app/agent/agent.component.ts`) — interface de conversation agent (Phase 2.4) :

- Historique de messages (bulles user à droite, assistant à gauche)
- Badges intent + confidence colorés par niveau (vert ≥ 80%, orange ≥ 50%, rouge < 50%)
- Streaming SSE via `POST /agent/process/stream` — event `metadata` puis tokens mot par mot
- Fallback non-streaming (`POST /agent/process`) si le stream échoue
- Gestion de `sessionId` cross-requêtes pour la continuité de session
- Micro intégré (`SpeechService`) avec transcription STT → remplissage de l'input
- Envoi sur Entrée, nouvelle ligne sur Shift+Entrée

Chaque section supporte l'entrée vocale via microphone (WebM → STT).

| Service         | Rôle                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| `ApiService`    | Appels HTTP et streaming SSE via Fetch API + ReadableStream                                  |
| `SpeechService` | Enregistrement audio via MediaRecorder (WebM)                                                |

Méthodes `ApiService` pour l'agent : `processAgent(dto)` → `POST /agent/process`, `processAgentStream(dto)` → `POST /agent/process/stream`. `StreamEvent` étendu avec `sessionId?`, `intent?`, `confidence?` pour les events `metadata` de l'agent.

**Modèles** (`src/app/models/`) : `rag.models.ts` (existant) + `agent.models.ts` (Phase 2.4) — `AgentMessage`, `AgentResponse`.

Config : `src/environments/environment.ts` → `apiUrl: 'http://localhost:3000'`

**Stack :** Angular 21, Angular Material, TypeScript, vitest

### stt-server/ — Serveur de transcription

Point d'entrée : `stt_server.py` (port configurable via `STT_PORT`, défaut 8300)

- Endpoint : `POST /transcribe` (upload audio)
- Modèle Whisper chargé au démarrage (défaut : `turbo`, langue : `fr`)
- VAD filter activé, beam size 1
- Device et compute type configurables (`WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, défaut `auto`)

**Stack :** FastAPI, Uvicorn, faster-whisper

### wake-listener/ — Détection de wake word

Point d'entrée : `wake_listener.py`

- Écoute en continu le microphone via PyAudio (16 kHz, mono)
- Détecte le wake word "Hey Jarvis" via OpenWakeWord (seuil configurable)
- Enregistre la commande vocale jusqu'à détection de silence (RMS)
- Envoie l'audio WAV au serveur STT pour transcription
- Classifie la transcription et route vers le backend NestJS (mémoire)
- Répond vocalement à l'utilisateur via Piper TTS (synthèse vocale neurale locale)

| Fichier                 | Rôle                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `wake_listener.py`      | Boucle principale : écoute micro → wake word → enregistrement → STT → classification → routage backend → réponse TTS |
| `config.py`             | Configuration via variables d'environnement (dataclass), inclut `JARVIS_API_URL` et config TTS                       |
| `recorder.py`           | Enregistrement audio post-wake avec détection de silence par RMS                                                     |
| `stt_client.py`         | Client HTTP pour envoi audio au serveur STT (`POST /transcribe`)                                                     |
| `command_classifier.py` | Classifie la transcription en `ADD` / `QUERY` / `UNKNOWN` via LLM (backend `/agent/classify`) avec fallback regex    |
| `jarvis_client.py`      | Client HTTP pour le backend NestJS (`/memory/add`, `/memory/query`)                                                  |
| `tts_client.py`         | Synthèse vocale locale via Piper TTS (modèle `fr_FR-siwis-medium`, auto-téléchargé dans `models/`)                   |

**Stack :** Python, OpenWakeWord, PyAudio, NumPy, requests, python-dotenv, piper-tts, sounddevice

#### Classification des commandes vocales (`command_classifier.py`)

Dual-path depuis Phase 2.1 : tente d'abord le backend LLM (`POST /agent/classify` via `_classify_with_llm()`), retombe sur les regex si `ConnectionError` (endpoint non encore disponible jusqu'en Phase 2.2). `wake_listener.py` passe `config.jarvis_api_url` à `_route_command()` qui le fournit à `classify()`.

| Type      | Patterns déclencheurs (exemples)                                                     | Action                                       |
| --------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| `ADD`     | "Ajoute que", "Mémorise", "Retiens", "Note", "N'oublie pas", "Enregistre"            | Supprime le préfixe et appelle `/memory/add` |
| `QUERY`   | "qu'est-ce que", "rappelle-moi", "dis-moi", "quand", "à quelle heure", "ai-je prévu" | Envoie la question à `/memory/query`         |
| `UNKNOWN` | Tout le reste                                                                        | Log uniquement, pas d'appel backend          |

### docker-qdrant/ — Base vectorielle

- `docker-compose up -d` pour démarrer Qdrant
- Port HTTP : 6333, port gRPC : 6334, stockage local dans `./qdrant_storage`
- Image `qdrant/qdrant` (sans tag, utilise `latest`)
- Collection : `domainknowledge` (distance cosinus, vecteurs 4096 dims)

## Variables d'environnement clés

Fichier `.env` dans `jarvis/` :

```env
# CORS
CORS_ORIGINS=http://localhost:4200

# Ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_LLM_SMALL_MODEL=qwen3:4b
OLLAMA_LLM_MODEL=mistral:latest
OLLAMA_LLM_LARGE_MODEL=qwen3.5:9b
OLLAMA_EMBED_MODEL=qwen3-embedding:8b

# Qdrant
QDRANTURL=http://127.0.0.1:6333
QDRANTCOLLECTION=domainknowledge
QDRANT_MEMORY_COLLECTION=jarvis_for_home

# RAG
RAG_TOP_K=5
CHUNK_SIZE=1000
CHUNK_OVERLAP=150

# STT
STT_SERVER_URL=http://127.0.0.1:8300
```

Note : `PORT` n'est pas dans le `.env` (fallback `3000` dans `main.ts`)

Fichier `.env` dans `stt-server/` :

```env
STT_PORT=8300
WHISPER_MODEL=turbo
WHISPER_LANGUAGE=fr
WHISPER_DEVICE=auto
WHISPER_COMPUTE_TYPE=auto
```

Fichier `.env` dans `wake-listener/` :

```env
# OpenWakeWord
WAKE_MODEL=hey_jarvis
WAKE_THRESHOLD=0.5

# Enregistrement
SAMPLE_RATE=16000
SILENCE_THRESHOLD=500
SILENCE_DURATION_SEC=3.0
MAX_RECORDING_SEC=30.0
CHUNK_SIZE=1280

# STT Server
STT_SERVER_URL=http://127.0.0.1:8300

# Jarvis Backend
JARVIS_API_URL=http://127.0.0.1:3000

# TTS (Piper)
TTS_MODEL=fr_FR-siwis-medium
TTS_ENABLED=true
```

## Commandes de développement

```bash
# Backend
cd jarvis && npm run start:dev

# Frontend
cd jarvis-ui && npm start

# STT
cd stt-server && python stt_server.py

# Wake Listener
cd wake-listener && python wake_listener.py

# Qdrant
cd docker-qdrant && docker-compose up -d
```

## Flux de données principaux

**Ingestion document :** Upload fichier → parsing (LangChain) → chunking (1000 chars, overlap 150) → embeddings (Ollama) → stockage Qdrant (`domainknowledge`)

**RAG Q&A :** Question → embedding → recherche Qdrant top-K → contexte + prompt → LLM → réponse streamée (SSE)

**STT :** Microphone → WebM blob → NestJS proxy → FastAPI/Whisper → texte transcrit → champ de saisie

**Wake Word → Mémoire :**

```text
Microphone (PyAudio) → OpenWakeWord ("Hey Jarvis")
  → enregistrement jusqu'au silence (RMS) → WAV
  → STT Server (Whisper) → texte transcrit
  → command_classifier (ADD / QUERY / UNKNOWN)
      ADD   → strip préfixe → /memory/add  → TemporalService → Qdrant (jarvis_for_home) → TTS "C'est noté."
      QUERY → /memory/query → TemporalService → Qdrant search → LLM → TTS réponse vocale
```

**Mémoire Q&A :** Question → TemporalService (extraction date) → embedding → recherche Qdrant `jarvis_for_home` (filtre eventDate auto) → contexte + prompt français → LLM → `{ answer, sources, topK, temporalContext? }`

## Conventions

- Backend en TypeScript strict, modules NestJS avec controller/service/DTO (Health est un controller standalone)
- Frontend Angular en architecture standalone components (pas de NgModules), tests avec vitest
- API REST, streaming via Server-Sent Events (Fetch API + ReadableStream côté client)
- Prompts système en français
- Mémoire conversationnelle séparée des documents RAG (deux collections Qdrant distinctes)
- Parsing temporel via chrono-node français (`forwardDate: true`)
- Types de payload distincts : `RagPayload` (`src/rag/rag.types.ts`) pour les documents, `MemoryPayload` (`src/memory/memory.types.ts`) pour la mémoire
- Routage LLM par taille (small/medium/large) via `OllamaService.resolveModel()` — jamais de nom de modèle en dur dans les services métier
- Événements mémoire via EventEmitter2 (`MEMORY_ADDED`, `MEMORY_SEARCHED`, `MEMORY_QUERIED`) — les listeners ne doivent pas bloquer le flux principal
