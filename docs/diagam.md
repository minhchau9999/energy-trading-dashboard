graph TD
    subgraph Browser
        A[User asks: "What's the outlook for wind power?"] --> B{Frontend UI};
    end

    subgraph Backend Server
        C[Socket.IO Listener] --> D{Context Assembly};
        B -- WebSocket --> C;
        E[Query DB for **Last 5 Events**] --> D;
        F[Query DB for Metrics] --> D;
        D --> G[Build Prompt];
        G --> H[Call Ollama API];
    end

    subgraph Ollama
        I[LLM: llama3:8b]
    end

    H -- "HTTP POST with generic context" --> I;
    I -- "Generated Answer (may be irrelevant)" --> H;
    H --> J[Send Response to User];
    J -- WebSocket --> B;

    style E fill:#f9f,stroke:#333,stroke-width:2px