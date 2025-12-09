const { OllamaEmbeddings } = require("@langchain/ollama");
const { MemoryVectorStore } = require("@langchain/core/vectorstores");
const { pool } = require('./db');
const axios = require('axios');

// 1. Initialize Models and Vector Store
// =======================================

const embeddings = new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
});

const generationModel = process.env.OLLAMA_MODEL || 'llama3:8b';
const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';

let vectorStore; // This will be our in-memory RAG store

// 2. Indexing: Load data from PostgreSQL into the vector store
// ============================================================

async function initializeVectorStore() {
    try {
        console.log("Initializing vector store: Fetching events from database...");
        const result = await pool.query('SELECT id, title, description, category FROM energy_events');
        const events = result.rows;

        if (events.length === 0) {
            console.warn("No events found in the database to index. RAG will be limited.");
            // Create an empty store to prevent errors
            vectorStore = await new MemoryVectorStore(embeddings);
            return;
        }

        // Convert database rows into a format LangChain understands
        const documents = events.map(event => ({
            pageContent: `Event Category: ${event.category}. Title: ${event.title}. Description: ${event.description}`,
            metadata: {
                id: event.id,
                category: event.category,
            },
        }));

        // Create the in-memory vector store. This is the core of the indexing process.
        // It calls the embedding model for each document and stores the resulting vector.
        vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);

        console.log(`Vector store initialized successfully with ${events.length} events.`);

    } catch (error) {
        console.error("Fatal error during vector store initialization:", error);
        // If the vector store fails, we can't proceed with RAG.
        // We could implement a fallback to the old method here if needed.
    }
}

// 3. Retrieval: Find relevant documents for a given question
// ===========================================================

async function retrieveRelevantEvents(question) {
    if (!vectorStore || vectorStore.memoryVectors.length === 0) {
        console.warn("Vector store is not initialized or is empty. Cannot retrieve relevant events.");
        return []; // Return empty array if the store isn't ready
    }

    try {
        // This is the core of the retrieval process.
        // It embeds the user's question and finds the most similar documents in the store.
        const searchResults = await vectorStore.similaritySearch(question, 4); // Find top 4 most relevant events

        // Format the results to be injected into the prompt
        const relevantEventsText = searchResults.map((result, index) =>
            `Relevant Event ${index + 1}:\n${result.pageContent}`
        ).join('\n\n');

        return relevantEventsText;

    } catch (error) {
        console.error("Error during similarity search:", error);
        return ""; // Return empty string on error
    }
}

// 4. Context Assembly: Get base metrics
// ======================================

async function assembleBaseMarketContext(country, period) {
    // This function remains largely the same, fetching numerical data.
    // For simplicity, we'll keep the basic query for now.
    // This is where you would add STDDEV, PERCENTILE, etc. as discussed.
    try {
        const query = `
            SELECT
                AVG(day_ahead_price) as avg_price,
                AVG(actual_load) as avg_load,
                STDDEV(day_ahead_price) as price_volatility,
                (AVG(solar_generation + wind_onshore) / NULLIF(AVG(actual_load), 0)) * 100 as renewable_share
            FROM energy_data
            WHERE country = $1 AND timestamp >= NOW() - $2::interval;
        `;
        const result = await pool.query(query, [country, period]);
        const metrics = result.rows[0];

        if (!metrics || metrics.avg_price === null) {
            return "No market data available for the selected period.";
        }

        return `
- Country: ${country}
- Period: ${period}
- Average Price: €${parseFloat(metrics.avg_price).toFixed(2)}/MWh
- Average Load: ${parseFloat(metrics.avg_load).toFixed(0)} MW
- Price Volatility (Std Dev): €${parseFloat(metrics.price_volatility).toFixed(2)}
- Renewable Share: ${parseFloat(metrics.renewable_share).toFixed(1)}%
        `;
    } catch (error) {
        console.error("Error fetching base market context:", error);
        return "Could not fetch market context.";
    }
}

// 5. Generation: Build the prompt and call the LLM
// =================================================

function buildPrompt(question, baseContext, relevantEvents) {
    const system_prompt = `You are an expert energy trading advisor. Your role is to provide concise, data-driven analysis based *only* on the information provided below. Do not use any prior knowledge.

Think step-by-step to formulate your answer:
1.  Review the quantitative market data (price, load, volatility).
2.  Review the qualitative event data that has been retrieved based on the user's question.
3.  Synthesize both quantitative and qualitative data to directly answer the user's question.
4.  Provide a final, concise answer.`;

    const context_section = `
--- CONTEXT ---
**Quantitative Market Data:**
${baseContext}

**Qualitative Event Data (retrieved for relevance to the question):**
${relevantEvents || "No specific events were found to be relevant to your question."}
--- END CONTEXT ---
`;

    const final_prompt = `${system_prompt}\n\n${context_section}\n\n**User Question:** "${question}"\n\n**Final Answer:**`;
    return final_prompt;
}

async function generateInsight(question, baseContext, relevantEvents) {
    const prompt = buildPrompt(question, baseContext, relevantEvents);

    try {
        const response = await axios.post(`${ollamaUrl}/api/generate`, {
            model: generationModel,
            prompt: prompt,
            stream: false,
        });
        return response.data.response;
    } catch (error) {
        console.error("Error calling Ollama generation API:", error.message);
        if (error.code === 'ECONNREFUSED') {
            return "Error: Could not connect to the Ollama server. Please ensure it is running.";
        }
        return "Error: Failed to generate a response from the AI model.";
    }
}

module.exports = {
    initializeVectorStore,
    assembleBaseMarketContext,
    retrieveRelevantEvents,
    generateInsight,
};
