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

| Module / Controller | Routes | Rôle |
| ------------------- | ------ | ---- |
| RAG | `POST /rag/ingest` (max 50 MB), `/rag/ask`, `/rag/ask/stream` | Ingestion de documents (PDF/TXT/MD) et texte brut, Q&A avec contexte vectoriel. Le stream émet `event: metadata` (sources, topK) puis les tokens |
| Memory | `POST /memory/add`, `/memory/search`, `/memory/query` | Mémoire conversationnelle persistante avec contexte temporel. `/memory/add` stocke un fait, `/memory/search` cherche par similarité + filtre date, `/memory/query` répond en langage naturel avec contexte LLM |
| LLM | `POST /llm/ask`, `/llm/ask/stream` | Génération LLM directe sans contexte RAG (pas de system prompt) |
| STT | `POST /stt/transcribe` (max 25 MB) | Proxy vers le serveur Python Whisper (fichier temp supprimé après transcription) |
| HealthController | `GET /health` | Check de santé (controller standalone dans AppModule, pas de module dédié) |
| ConfigModule | (global) | Chargement `.env` via `@nestjs/config` |
| Ollama | (service interne) | Client Ollama `/api/embed` et `/api/generate` |
| Vectorstore | (service interne) | Client Qdrant, gère deux collections : `domainknowledge` (documents) et `jarvis_for_home` (mémoire) |
| Temporal | (service interne) | Extraction d'expressions temporelles françaises via chrono-node (`chrono.fr.parse`) |

**Stack :** NestJS 11, TypeScript, LangChain (PDFLoader, text splitting), Qdrant JS Client, chrono-node, class-validator, class-transformer

#### Module Memory (`src/memory/`)

- **MemoryService** : coordonne Ollama (embeddings + génération), VectorstoreService (collection `jarvis_for_home`) et TemporalService
  - `add(text, source?, contextType?)` : extrait la date d'événement via TemporalService, embed le texte, stocke dans Qdrant avec `addedAt` et `eventDate` optionnel
  - `search(query, topK?, dateFilter?)` : recherche sémantique avec filtre de plage de dates optionnel (`eventDate` ou `addedAt`)
  - `query(question, topK?)` : Q&A complet — parse le contexte temporel, filtre auto sur `eventDate` du même jour, génère une réponse LLM en français. Retourne `{ answer, sources, topK, temporalContext? }`
- **DTOs** : `MemoryAddDto`, `MemorySearchDto` (avec `DateFilterDto` imbriqué), `MemoryQueryDto`

#### Module Temporal (`src/temporal/`)

- **TemporalService** : parse les expressions de date/heure en français (ex. "ce soir à 20h", "demain", "vendredi prochain")
  - `parse(text, referenceDate?)` → `TemporalResult | null` (première expression)
  - `parseAll(text, referenceDate?)` → `TemporalResult[]` (toutes les expressions)
  - `TemporalResult` : `{ expression: string, resolvedDate: string }` (ISO 8601 UTC)
  - Option `forwardDate: true` pour résoudre les ambiguïtés vers le futur

#### Stratégie Qdrant dual-collection

| Collection | Usage | Champs payload |
| ---------- | ----- | -------------- |
| `domainknowledge` | Documents RAG (PDF/TXT/MD) | `source`, `chunkIndex`, `text` |
| `jarvis_for_home` | Mémoire conversationnelle | `source`, `text`, `addedAt`, `contextType`, `eventDate?` |

Les index datetime sont créés automatiquement sur `addedAt` et `eventDate` dans `jarvis_for_home`.

### jarvis-ui/ — Frontend Angular

Point d'entrée : `src/main.ts` (port 4200)

Architecture **standalone components** (pas de NgModules). Route unique `''` avec lazy-loading de `RagComponent`.

Page unique (`RagComponent`) avec 3 sections :

1. **Ingestion** — Upload de fichiers vers la base vectorielle
2. **RAG** — Questions avec contexte documentaire (streaming SSE)
3. **LLM** — Questions directes au LLM (streaming SSE)

Chaque section supporte l'entrée vocale via microphone (WebM → STT).

| Service | Rôle |
| ------- | ---- |
| `ApiService` | Appels HTTP et streaming SSE via Fetch API + ReadableStream |
| `SpeechService` | Enregistrement audio via MediaRecorder (WebM) |

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

| Fichier | Rôle |
| ------- | ---- |
| `wake_listener.py` | Boucle principale : écoute micro → wake word → enregistrement → STT → classification → routage backend → réponse TTS |
| `config.py` | Configuration via variables d'environnement (dataclass), inclut `JARVIS_API_URL` et config TTS |
| `recorder.py` | Enregistrement audio post-wake avec détection de silence par RMS |
| `stt_client.py` | Client HTTP pour envoi audio au serveur STT (`POST /transcribe`) |
| `command_classifier.py` | Classifie la transcription en `ADD` / `QUERY` / `UNKNOWN` via regex français |
| `jarvis_client.py` | Client HTTP pour le backend NestJS (`/memory/add`, `/memory/query`) |
| `tts_client.py` | Synthèse vocale locale via Piper TTS (modèle `fr_FR-siwis-medium`, auto-téléchargé dans `models/`) |

**Stack :** Python, OpenWakeWord, PyAudio, NumPy, requests, python-dotenv, piper-tts, sounddevice

#### Classification des commandes vocales (`command_classifier.py`)

| Type | Patterns déclencheurs (exemples) | Action |
| ---- | --------------------------------- | ------ |
| `ADD` | "Ajoute que", "Mémorise", "Retiens", "Note", "N'oublie pas", "Enregistre" | Supprime le préfixe et appelle `/memory/add` |
| `QUERY` | "qu'est-ce que", "rappelle-moi", "dis-moi", "quand", "à quelle heure", "ai-je prévu" | Envoie la question à `/memory/query` |
| `UNKNOWN` | Tout le reste | Log uniquement, pas d'appel backend |

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
OLLAMA_LLM_MODEL=gpt-oss:20b
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
