# Jarvis — Assistant IA personnel

Assistant IA local avec RAG, mémoire conversationnelle, reconnaissance vocale et synthèse vocale. Tourne entièrement en local (aucune donnée envoyée dans le cloud).

## Sommaire

- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Démarrage](#démarrage)
- [Fonctionnalités](#fonctionnalités)
- [API Reference](#api-reference)
- [Variables d'environnement](#variables-denvironnement)
- [Feuille de route](#feuille-de-route)

---

## Architecture

```text
jarvis-full-solution/
├── jarvis/          # Backend API (NestJS, port 3000)
├── jarvis-ui/       # Frontend (Angular 21, port 4200)
├── stt-server/      # Transcription vocale (FastAPI/Whisper, port 8300)
├── wake-listener/   # Détection wake word "Hey Jarvis" (Python)
└── docker-qdrant/   # Base vectorielle Qdrant (Docker, port 6333)
```

### Flux de communication

```text
Angular (4200) ──HTTP/SSE──► NestJS (3000) ──► Ollama (11434)    [LLM + Embeddings]
                                            ──► Qdrant (6333)    [Recherche vectorielle]
                                            ──► STT Server (8300) [Transcription audio]

Wake Listener (micro) ──► STT Server (8300) [Transcription]
                      ──► NestJS (3000)     [/memory/add, /memory/query]
```

### Flux principaux

#### Ingestion document

```text
Upload (PDF/TXT/MD) → LangChain parsing → chunking (1000 chars, overlap 150)
  → embeddings Ollama → Qdrant (domainknowledge)
```

#### RAG Q&A (streaming)

```text
Question → embedding → recherche Qdrant top-5 → contexte + prompt
  → LLM gpt-oss:20b (stream SSE) → réponse
```

#### Wake Word → Mémoire

```text
Microphone → "Hey Jarvis" (OpenWakeWord) → enregistrement silence RMS → WAV
  → STT Whisper → CommandClassifier (ADD / QUERY / UNKNOWN)
      ADD   → /memory/add  → TemporalService → Qdrant (jarvis_for_home) → TTS "C'est noté."
      QUERY → /memory/query → TemporalService → Qdrant search → LLM → TTS réponse
```

---

## Prérequis

| Outil | Version | Usage |
| ----- | ------- | ----- |
| Node.js | 20+ | Backend NestJS + Frontend Angular |
| Python | 3.10+ | STT server + Wake listener |
| Docker | - | Qdrant (base vectorielle) |
| [Ollama](https://ollama.com) | latest | LLM local + embeddings |

### Modèles Ollama requis

```bash
ollama pull qwen3-embedding:8b   # embeddings (4096 dims)
ollama pull qwen3:4b             # LLM small (classification, intention)
ollama pull mistral:latest       # LLM medium (mémoire, résumés)
ollama pull gpt-oss:20b          # LLM large (RAG, raisonnement)
```

> Les trois modèles LLM sont configurables via `.env`. Seul l'embed model est requis pour le RAG de base.

---

## Installation

### 1. Base vectorielle (Qdrant)

```bash
cd docker-qdrant
docker-compose up -d
```

Qdrant sera disponible sur `http://localhost:6333`.

### 2. Backend NestJS

```bash
cd jarvis
cp .env.example .env   # adapter les valeurs si besoin
npm install
```

### 3. Frontend Angular

```bash
cd jarvis-ui
npm install
```

### 4. STT Server

```bash
cd stt-server
pip install -r requirements.txt
cp .env.example .env
```

### 5. Wake Listener (optionnel)

```bash
cd wake-listener
pip install -r requirements.txt
cp .env.example .env
```

---

## Démarrage

Lancer chaque composant dans un terminal séparé :

```bash
# 1. Qdrant
cd docker-qdrant && docker-compose up -d

# 2. Backend
cd jarvis && npm run start:dev

# 3. Frontend
cd jarvis-ui && npm start

# 4. STT Server
cd stt-server && python stt_server.py

# 5. Wake Listener (optionnel)
cd wake-listener && python wake_listener.py
```

L'interface est disponible sur [http://localhost:4200](http://localhost:4200).
La doc Swagger du backend est sur [http://localhost:3000/api](http://localhost:3000/api).

---

## Fonctionnalités

### RAG — Base documentaire

- Ingestion de fichiers PDF, TXT et Markdown (jusqu'à 50 MB)
- Chunking automatique (1000 caractères, overlap 150)
- Recherche sémantique avec top-K configurable
- Réponses streamées (Server-Sent Events)

### Mémoire conversationnelle

- Stockage de faits avec contexte temporel (`"ce soir à 20h"`, `"vendredi prochain"`)
- Recherche sémantique avec filtre de plage de dates ou d'intervalle (ex. "la semaine dernière")
- Détection de récurrence (`"tous les mardis"`) et de direction temporelle (passé / futur)
- Q&A en langage naturel avec réponse LLM en français
- Event bus interne (EventEmitter2) pour les opérations mémoire

### Reconnaissance vocale

- Entrée microphone depuis l'interface web (WebM → STT)
- Transcription via Whisper turbo (français)
- Wake word "Hey Jarvis" pour utilisation mains-libres

### Synthèse vocale

- Réponses vocales via Piper TTS local (modèle `fr_FR-siwis-medium`)
- Téléchargement automatique du modèle au premier démarrage

### Multi-modèle Ollama

| Taille | Modèle | Usage |
| ------ | ------ | ----- |
| small | `qwen3:4b` | Classification, intention |
| medium | `mistral:latest` | Mémoire, résumés |
| large | `gpt-oss:20b` | RAG, raisonnement complexe |

---

## API Reference

### RAG

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/rag/ingest` | Ingestion fichier ou texte brut (max 50 MB) |
| `POST` | `/rag/ask` | Q&A avec contexte documentaire |
| `POST` | `/rag/ask/stream` | Q&A streamé (SSE) — émet `event: metadata` puis tokens |

### Mémoire

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/memory/add` | Stocker un fait avec contexte temporel optionnel |
| `POST` | `/memory/search` | Recherche sémantique avec filtre de dates |
| `POST` | `/memory/query` | Q&A complet en langage naturel |

### LLM direct

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/llm/ask` | Génération LLM sans contexte RAG |
| `POST` | `/llm/ask/stream` | Génération streamée (SSE) |

### STT

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/stt/transcribe` | Transcription audio (max 25 MB, proxy Whisper) |

### Agent (Phase 2.2+)

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `POST` | `/agent/classify` | Classification d'intention LLM (endpoint activé en Phase 2.2) |

### Santé

| Méthode | Route | Description |
| ------- | ----- | ----------- |
| `GET` | `/health` | Check de santé du backend |

---

## Variables d'environnement

### `jarvis/.env`

```env
# CORS
CORS_ORIGINS=http://localhost:4200

# Ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_LLM_SMALL_MODEL=qwen3:4b
OLLAMA_LLM_MODEL=mistral:latest
OLLAMA_LLM_LARGE_MODEL=gpt-oss:20b
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

### `stt-server/.env`

```env
STT_PORT=8300
WHISPER_MODEL=turbo
WHISPER_LANGUAGE=fr
WHISPER_DEVICE=auto
WHISPER_COMPUTE_TYPE=auto
```

### `wake-listener/.env`

```env
WAKE_MODEL=hey_jarvis
WAKE_THRESHOLD=0.5
SAMPLE_RATE=16000
SILENCE_THRESHOLD=500
SILENCE_DURATION_SEC=3.0
MAX_RECORDING_SEC=30.0
CHUNK_SIZE=1280
STT_SERVER_URL=http://127.0.0.1:8300
JARVIS_API_URL=http://127.0.0.1:3000
TTS_MODEL=fr_FR-siwis-medium
TTS_ENABLED=true
```

---

## Feuille de route

Le développement suit un plan en 5 phases. Voir [plan/SUMMARY.md](plan/SUMMARY.md) pour le détail.

| Phase | Titre | État |
| ----- | ----- | ---- |
| **1** | Fondations — types, event bus, multi-LLM, agent context, temporal enrichi | ✅ 1.1–1.5 terminés |
| **2** | Intent engine & agent core — classification LLM, routing | 🚧 2.1 terminé, 2.2–2.4 planifiés |
| **3** | Mémoire enrichie — scoring, RAG hybride, knowledge graph | 🔜 planifié |
| **4** | Actions & proactivité — action engine, goals, identity | 🔜 planifié |
| **5** | Profondeur cognitive — context fusion, feedback, hallucination guard | 🔜 planifié |

### Phase 1 — Détail des implémentations

- **1.1** — `MemoryPayload` séparé de `RagPayload` (`src/memory/memory.types.ts`)
- **1.2** — Event bus NestJS EventEmitter2 avec `MemoryEventsListener` (MEMORY_ADDED, MEMORY_SEARCHED, MEMORY_QUERIED)
- **1.3** — Routage multi-modèle Ollama via `resolveModel('small'|'medium'|'large')`
- **1.4** — Types `AgentContext`, `AgentResponse`, `ConversationMessage` dans `src/agent/agent.types.ts`
- **1.5** — `TemporalService` enrichi : `parseInterval()` (plages de dates), `detectRecurrence()` (patterns récurrents), `detectDirection()` (past/future) ; `MemoryService.query()` filtre automatiquement par intervalle `eventDate`

### Phase 2 — Détail des implémentations

- **2.1** — `IntentEngine` (`src/agent/intent/`) : classification dual-path LLM (qwen3:4b) → regex fallback ; `command_classifier.py` tente `POST /agent/classify` avant de tomber sur les regex

---

## Stack technique

| Composant | Technologies |
| --------- | ------------ |
| Backend | NestJS 11, TypeScript, LangChain, Qdrant JS Client, chrono-node |
| Frontend | Angular 21, Angular Material, vitest |
| STT | FastAPI, faster-whisper (Whisper turbo) |
| Wake listener | Python, OpenWakeWord, PyAudio, Piper TTS |
| LLM / Embeddings | Ollama (local) |
| Vector store | Qdrant (Docker) |
