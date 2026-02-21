# Jarvis — Diagrammes d'architecture (Mermaid)

## 1. Vue d'ensemble des composants

```mermaid
graph TB
    subgraph UI["jarvis-ui (Angular 4200)"]
        RagComp["RagComponent"]
        ApiSvc["ApiService"]
        SpeechSvc["SpeechService"]
    end

    subgraph Backend["jarvis (NestJS 3000)"]
        direction TB
        RAGCtrl["RAG Controller\n/rag/ingest\n/rag/ask\n/rag/ask/stream"]
        MemCtrl["Memory Controller\n/memory/add\n/memory/search\n/memory/query"]
        LLMCtrl["LLM Controller\n/llm/ask\n/llm/ask/stream"]
        STTCtrl["STT Controller\n/stt/transcribe"]
        AgentCtrl["Agent Controller\n/agent/classify\n(Phase 2.2)"]

        subgraph Services["Services internes"]
            OllamaSvc["OllamaService\nsmall / medium / large"]
            VectorSvc["VectorstoreService\ndual-collection"]
            MemSvc["MemoryService"]
            TempSvc["TemporalService\nparse / parseInterval\ndetectRecurrence / detectDirection"]
            IntentEng["IntentEngine\nLLM → regex fallback"]
            EventBus["EventEmitter2\nMEMORY_ADDED\nMEMORY_SEARCHED\nMEMORY_QUERIED"]
        end
    end

    subgraph External["Services externes"]
        Ollama["Ollama :11434\nLLM + Embeddings"]
        Qdrant["Qdrant :6333\nvector store"]
        STTServer["STT Server :8300\nWhisper turbo"]
    end

    subgraph WakeListener["wake-listener (Python)"]
        Mic["Microphone\nPyAudio 16kHz"]
        OWW["OpenWakeWord\nhey_jarvis"]
        Recorder["Recorder\nsilence RMS"]
        Classifier["CommandClassifier\nLLM → regex fallback\nADD / QUERY / UNKNOWN"]
        TTS["Piper TTS\nfr_FR-siwis-medium"]
    end

    RagComp --> ApiSvc
    RagComp --> SpeechSvc
    ApiSvc -->|"HTTP / SSE"| RAGCtrl
    ApiSvc -->|"HTTP / SSE"| LLMCtrl
    ApiSvc -->|"HTTP"| STTCtrl
    SpeechSvc -->|"WebM audio"| STTCtrl

    RAGCtrl --> OllamaSvc
    RAGCtrl --> VectorSvc
    LLMCtrl --> OllamaSvc
    MemCtrl --> MemSvc
    MemSvc --> OllamaSvc
    MemSvc --> VectorSvc
    MemSvc --> TempSvc
    MemSvc -->|"emit events"| EventBus
    STTCtrl -->|"proxy audio"| STTServer
    AgentCtrl --> IntentEng
    IntentEng -->|"generateWith('small')"| OllamaSvc

    OllamaSvc --> Ollama
    VectorSvc --> Qdrant

    Mic --> OWW
    OWW -->|"wake détecté"| Recorder
    Recorder -->|"WAV"| STTServer
    STTServer -->|"texte"| Classifier
    Classifier -->|"ADD/QUERY"| MemCtrl
    MemCtrl -->|"réponse"| TTS
```

---

## 2. Flux RAG — Ingestion de document

```mermaid
sequenceDiagram
    actor User
    participant UI as Angular UI
    participant NestJS as NestJS :3000
    participant LC as LangChain
    participant Ollama as Ollama :11434
    participant Qdrant as Qdrant :6333

    User->>UI: Upload PDF/TXT/MD (max 50 MB)
    UI->>NestJS: POST /rag/ingest (multipart)
    NestJS->>LC: PDFLoader / TextLoader
    LC-->>NestJS: texte brut
    NestJS->>LC: RecursiveCharacterTextSplitter\n(chunk 1000, overlap 150)
    LC-->>NestJS: chunks[]
    loop pour chaque chunk
        NestJS->>Ollama: POST /api/embed (qwen3-embedding:8b)
        Ollama-->>NestJS: vecteur 4096 dims
        NestJS->>Qdrant: upsert → domainknowledge\n{ source, chunkIndex, text }
    end
    NestJS-->>UI: { chunksIngested, collection }
```

---

## 3. Flux RAG — Question / Réponse streamée

```mermaid
sequenceDiagram
    actor User
    participant UI as Angular UI
    participant NestJS as NestJS :3000
    participant Ollama as Ollama :11434
    participant Qdrant as Qdrant :6333

    User->>UI: Question texte
    UI->>NestJS: POST /rag/ask/stream
    NestJS->>Ollama: embed(question) → qwen3-embedding:8b
    Ollama-->>NestJS: vecteur question
    NestJS->>Qdrant: search domainknowledge (top-K=5)
    Qdrant-->>NestJS: chunks pertinents + scores
    NestJS-->>UI: SSE event: metadata\n{ sources, topK }
    NestJS->>Ollama: generate(prompt+contexte) → large model\ngpt-oss:20b (stream)
    loop tokens streamés
        Ollama-->>NestJS: token
        NestJS-->>UI: SSE data: token
    end
    UI->>User: Réponse affichée en temps réel
```

---

## 4. Flux Mémoire — Ajout via Wake Word

```mermaid
sequenceDiagram
    actor User as Utilisateur
    participant Mic as Microphone
    participant OWW as OpenWakeWord
    participant Rec as Recorder
    participant STT as STT Server :8300
    participant CLS as CommandClassifier
    participant NestJS as NestJS :3000
    participant Temp as TemporalService
    participant Ollama as Ollama :11434
    participant Qdrant as Qdrant :6333
    participant TTS as Piper TTS
    participant EventBus as EventEmitter2

    User->>Mic: "Hey Jarvis, mémorise que..."
    Mic->>OWW: flux audio 16kHz
    OWW->>Rec: wake word détecté
    Rec->>Rec: enregistrement jusqu'au silence RMS
    Rec->>STT: POST /transcribe (WAV)
    STT-->>CLS: texte transcrit
    CLS->>CLS: regex → type ADD\nstrip préfixe
    CLS->>NestJS: POST /memory/add { text }
    NestJS->>Temp: parse(text) → eventDate?
    Temp-->>NestJS: TemporalResult | null
    NestJS->>Ollama: embed(text) → qwen3-embedding:8b
    Ollama-->>NestJS: vecteur
    NestJS->>Qdrant: upsert → jarvis_for_home\n{ text, addedAt, eventDate?, source }
    NestJS->>EventBus: emit MEMORY_ADDED\n{ id, source, eventDate, text }
    NestJS-->>CLS: { id, addedAt }
    CLS->>TTS: "C'est noté."
    TTS->>User: réponse vocale
```

---

## 5. Flux Mémoire — Question / Réponse via Wake Word

```mermaid
sequenceDiagram
    actor User as Utilisateur
    participant Mic as Microphone
    participant OWW as OpenWakeWord
    participant Rec as Recorder
    participant STT as STT Server :8300
    participant CLS as CommandClassifier
    participant NestJS as NestJS :3000
    participant Temp as TemporalService
    participant Ollama as Ollama :11434
    participant Qdrant as Qdrant :6333
    participant TTS as Piper TTS
    participant EventBus as EventEmitter2

    User->>Mic: "Hey Jarvis, rappelle-moi..."
    Mic->>OWW: flux audio 16kHz
    OWW->>Rec: wake word détecté
    Rec->>STT: POST /transcribe (WAV)
    STT-->>CLS: texte transcrit
    CLS->>CLS: regex → type QUERY
    CLS->>NestJS: POST /memory/query { question }
    NestJS->>Temp: parse(question) → temporalContext?
    Temp-->>NestJS: date extraite (ex: "ce soir" → ISO)
    NestJS->>Ollama: embed(question) → qwen3-embedding:8b
    Ollama-->>NestJS: vecteur question
    NestJS->>Qdrant: search jarvis_for_home\n(filtre eventDate si date extraite)
    Qdrant-->>NestJS: souvenirs pertinents
    NestJS->>EventBus: emit MEMORY_QUERIED
    NestJS->>Ollama: generate(contexte+souvenirs) → medium model\nmistral:latest
    Ollama-->>NestJS: réponse en français
    NestJS-->>CLS: { answer, sources, topK, temporalContext? }
    CLS->>TTS: réponse vocale
    TTS->>User: réponse parlée
```

---

## 6. Routage multi-modèle Ollama

```mermaid
graph LR
    Call["Appel OllamaService"]
    Call -->|"resolveModel('small')"| SM["qwen3:4b\nOLLAMA_LLM_SMALL_MODEL\nClassification / intention"]
    Call -->|"resolveModel('medium')\nou generate() direct"| MM["mistral:latest\nOLLAMA_LLM_MODEL\nMémoire / résumés"]
    Call -->|"resolveModel('large')"| LM["gpt-oss:20b\nOLLAMA_LLM_LARGE_MODEL\nRAG / raisonnement"]
    SM --> Ollama["Ollama :11434\nPOST /api/generate"]
    MM --> Ollama
    LM --> Ollama
```

---

## 7. Event Bus mémoire (EventEmitter2)

```mermaid
graph LR
    MemSvc["MemoryService"]
    MemSvc -->|"emit MEMORY_ADDED"| EB["EventEmitter2\nwildcard: true"]
    MemSvc -->|"emit MEMORY_SEARCHED"| EB
    MemSvc -->|"emit MEMORY_QUERIED"| EB
    EB -->|"@OnEvent"| Listener["MemoryEventsListener\nmemory.events.listener.ts"]
    Listener -->|"log"| Logger["NestJS Logger\naperçu texte 60 chars"]
```

---

## 8. Dual-collection Qdrant

```mermaid
graph TB
    subgraph Qdrant["Qdrant :6333"]
        DC["domainknowledge\nRAG documents\n{ source, chunkIndex, text }"]
        MEM["jarvis_for_home\nMémoire conversationnelle\n{ source, text, addedAt, contextType, eventDate? }"]
    end

    RAGSvc["RagService\nRagPayload"] -->|"upsert / search"| DC
    MemSvc["MemoryService\nMemoryPayload"] -->|"upsert / search"| MEM
    MEM -->|"index datetime"| DateIdx["Index addedAt\nIndex eventDate"]
```
