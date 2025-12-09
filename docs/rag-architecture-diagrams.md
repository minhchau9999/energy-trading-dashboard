# RAG System Architecture Diagrams

## Current Implementation (Before RAG)

```mermaid
graph TD
    subgraph Browser
        A[User asks: What's the outlook for wind power?] --> B{Frontend UI};
    end

    subgraph Backend Server
        C[Socket.IO Listener] --> D{Context Assembly};
        B -- WebSocket --> C;
        E[Query DB for Last 5 Events] --> D;
        F[Query DB for Metrics] --> D;
        D --> G[Build Prompt];
        G --> H[Call Ollama API];
    end

    subgraph Ollama
        I[LLM: llama3:8b]
    end

    H -- HTTP POST with generic context --> I;
    I -- Generated Answer may be irrelevant --> H;
    H --> J[Send Response to User];
    J -- WebSocket --> B;

    style E fill:#ffcccc,stroke:#333,stroke-width:2px
    style I fill:#ccf,stroke:#333,stroke-width:2px
```

**Problem:** The "Last 5 Events" are completely disconnected from the user's question. The LLM gets irrelevant context.

---

## New RAG Implementation

### Phase 1: Indexing (One-time setup)

```mermaid
graph TD
    subgraph Server Startup
        A[1. Load All Events from DB] --> B{For Each Event...};
        B --> C[2. Create Event Description];
        C --> D[3. Generate Embedding Vector];
    end
    
    subgraph Ollama Embedding Model
        E[nomic-embed-text<br/>274MB model]
    end
    
    D -- Event Text --> E;
    E -- Vector 0.1, -0.8, 0.4... --> D;
    D --> F[4. Store in Vector Store];
    
    subgraph In-Memory Vector Store
        G[Event 1: Nuclear... → 0.1, -0.8, 0.4]
        H[Event 2: Wind... → -0.5, 0.2, -0.9]
        I[Event 3: Transmission... → 0.3, 0.6, 0.1]
        J[Event N... → ...]
    end
    
    F --> G;
    F --> H;
    F --> I;
    F --> J;
    
    style E fill:#9f9,stroke:#333,stroke-width:2px
    style G fill:#ffc,stroke:#333,stroke-width:1px
    style H fill:#ffc,stroke:#333,stroke-width:1px
    style I fill:#ffc,stroke:#333,stroke-width:1px
```

### Phase 2: Retrieval (Real-time per question)

```mermaid
graph TD
    subgraph Browser
        A[User asks: What's happening with atomic energy?] --> B{Frontend UI};
    end

    subgraph Backend Server - RAG Pipeline
        C[Socket.IO Listener] --> D[1. Generate Question Embedding];
        B -- WebSocket --> C;
        
        D -- Question Text --> E[nomic-embed-text];
        E -- Question Vector --> D;
        
        D --> F[2. Similarity Search];
        F -- Compare vectors --> G[Vector Store<br/>All Event Embeddings];
        G -- Top 4 Most Similar --> F;
        
        F --> H[3. Retrieved: Nuclear events];
        I[Query DB for Market Metrics] --> J[4. Combine Context];
        H --> J;
        
        J --> K[5. Build Enhanced Prompt];
        K --> L[6. Call Ollama Generation];
    end

    subgraph Ollama Generation
        M[llama3:8b<br/>4.7GB model]
    end

    L -- Prompt with relevant context --> M;
    M -- Intelligent, relevant answer --> L;
    L --> N[Send Response];
    N -- WebSocket --> B;

    style F fill:#9f9,stroke:#333,stroke-width:2px
    style E fill:#9f9,stroke:#333,stroke-width:2px
    style M fill:#ccf,stroke:#333,stroke-width:2px
    style H fill:#ffc,stroke:#333,stroke-width:2px
```

---

## Semantic Understanding Example

### How RAG Understands "Atomic Energy" = "Nuclear Power"

```
User Question: "What's happening with atomic energy?"
                      ↓
            [Embedding Model]
                      ↓
Question Vector: [0.12, -0.78, 0.42, 0.31, ...]
                      ↓
         [Cosine Similarity Search]
                      ↓
Compare with all event vectors:

Event: "Nuclear Reactor Maintenance..."
Vector: [0.11, -0.79, 0.43, 0.30, ...]
Similarity Score: 0.95 ✅ MATCH!

Event: "Wind Farm Capacity Increase..."
Vector: [-0.52, 0.18, -0.88, 0.12, ...]
Similarity Score: 0.12 ❌ No match

Event: "Coal Plant Outage..."
Vector: [0.08, -0.21, 0.15, 0.42, ...]
Similarity Score: 0.42 ❌ No match
                      ↓
        Return top 4 matches
```

---

## Complete Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Server
    participant Embeddings as Embedding Model<br/>(nomic-embed-text)
    participant VectorStore as Vector Store<br/>(In-Memory)
    participant Database as TimescaleDB
    participant LLM as Generation Model<br/>(llama3:8b)

    Note over Server,VectorStore: One-Time Indexing (Server Startup)
    Server->>Database: SELECT * FROM energy_events
    Database-->>Server: 10 events
    loop For each event
        Server->>Embeddings: Create embedding for event text
        Embeddings-->>Server: Vector [0.1, -0.8, ...]
        Server->>VectorStore: Store event + vector
    end
    Note over VectorStore: ✅ 10 events indexed

    Note over User,LLM: Real-Time Query (Per User Question)
    User->>Frontend: Ask: "What's happening with wind?"
    Frontend->>Server: WebSocket: askAI
    
    Server->>Embeddings: Create embedding for question
    Embeddings-->>Server: Question vector [...]
    
    Server->>VectorStore: Similarity search (topK=4)
    VectorStore-->>Server: 4 relevant events (wind-related)
    
    Server->>Database: Get latest market metrics
    Database-->>Server: Load, price, generation stats
    
    Server->>Server: Combine metrics + events into prompt
    
    Server->>LLM: Generate answer with context
    LLM-->>Server: Intelligent response
    
    Server->>Frontend: WebSocket: aiResponse
    Frontend->>User: Display answer
```

---

## Key Benefits Illustrated

### Before RAG
```
Question: "Wind power outlook?"
         ↓
Context: [Last 5 events]
  1. Nuclear maintenance ❌
  2. Transmission issue ❌
  3. Price spike ❌
  4. Coal outage ❌
  5. Hydro levels ❌
         ↓
LLM Answer: Generic, possibly incorrect
```

### After RAG
```
Question: "Wind power outlook?"
         ↓
Semantic Search → Find wind-related events
         ↓
Context: [Relevant events]
  1. Low wind period expected ✅
  2. High wind forecast Finland ✅
  3. Offshore wind farm online ✅
  4. Wind capacity increase ✅
         ↓
LLM Answer: Specific, data-driven, accurate
```
