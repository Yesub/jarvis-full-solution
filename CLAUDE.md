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
```

## Composants

### jarvis/ — Backend NestJS

Point d'entrée : `src/main.ts` (port 3000, Swagger sur `/api`)

Global : `AllExceptionsFilter` (erreurs structurées JSON), `LoggingInterceptor` (logs method/URL/durée), `ValidationPipe` (whitelist + transform)

| Module / Controller | Routes | Rôle |
|---------------------|--------|------|
| RAG | `POST /rag/ingest` (max 50 MB), `/rag/ask`, `/rag/ask/stream` | Ingestion de documents (PDF/TXT/MD), Q&A avec contexte vectoriel. Le stream émet `event: metadata` (sources, topK) puis les tokens |
| LLM | `POST /llm/ask`, `/llm/ask/stream` | Génération LLM directe sans contexte RAG (pas de system prompt) |
| STT | `POST /stt/transcribe` (max 25 MB) | Proxy vers le serveur Python Whisper (fichier temp supprimé après transcription) |
| HealthController | `GET /health` | Check de santé (controller standalone dans AppModule, pas de module dédié) |
| ConfigModule | (global) | Chargement `.env` via `@nestjs/config` |
| Ollama | (service interne) | Client Ollama `/api/embed` et `/api/generate` |
| Vectorstore | (service interne) | Client Qdrant (lève `ConflictException` si dimension embedding change) |

**Stack :** NestJS 11, TypeScript, LangChain (PDFLoader, text splitting), Qdrant JS Client, class-validator, class-transformer

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
- **TODO :** l'intégration avec le backend NestJS n'est pas encore implémentée (le texte transcrit est loggé mais pas envoyé)

| Fichier | Rôle |
| ------- | ---- |
| `wake_listener.py` | Boucle principale : écoute micro → détection wake word → enregistrement → transcription |
| `config.py` | Configuration via variables d'environnement (dataclass) |
| `recorder.py` | Enregistrement audio post-wake avec détection de silence par RMS |
| `stt_client.py` | Client HTTP pour envoi audio au serveur STT (`POST /transcribe`) |

**Stack :** Python, OpenWakeWord, PyAudio, NumPy, requests, python-dotenv

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

**Ingestion :** Upload fichier → parsing (LangChain) → chunking (1000 chars, overlap 150) → embeddings (Ollama) → stockage Qdrant

**RAG Q&A :** Question → embedding → recherche Qdrant top-K → contexte + prompt → LLM → réponse streamée (SSE)

**STT :** Microphone → WebM blob → NestJS proxy → FastAPI/Whisper → texte transcrit → champ de saisie

**Wake Word :** Microphone (PyAudio) → OpenWakeWord ("Hey Jarvis") → enregistrement jusqu'au silence (RMS) → WAV → STT Server → texte transcrit

## Conventions

- Backend en TypeScript strict, modules NestJS avec controller/service/DTO (Health est un controller standalone)
- Frontend Angular en architecture standalone components (pas de NgModules), tests avec vitest
- API REST, streaming via Server-Sent Events (Fetch API + ReadableStream côté client)
- Prompts système en français
