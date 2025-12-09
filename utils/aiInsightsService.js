const { Ollama } = require('ollama');
const { MemoryVectorStore } = require("@langchain/core/vectorstores");
const { OllamaEmbeddings } = require("@langchain/ollama");
const WebTools = require('./webTools');

class AIInsightsService {
    constructor(databaseManager, logger = console) {
        this.db = databaseManager;
        this.logger = logger; // Use custom logger or default to console
        this.cache = new Map();
        this.cacheTTL = parseInt(process.env.AI_INSIGHTS_CACHE_TTL) || 300000; // 5 minutes
        this.isEnabled = process.env.AI_INSIGHTS_ENABLED === 'true';
        this.lastContextUpdate = null;
        this.marketContext = null;
        this.ollamaHost = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'llama3:8b';
        
        // Initialize Ollama client
        this.ollama = new Ollama({ host: this.ollamaHost });
        
        // Initialize Web Tools for online information access
        this.webTools = new WebTools();
        this.webToolsEnabled = process.env.WEB_TOOLS_ENABLED !== 'false'; // Enabled by default
        
        // RAG: Initialize embedding model and vector store
        this.embeddings = new OllamaEmbeddings({
            model: "nomic-embed-text",
            baseUrl: this.ollamaHost,
        });
        this.vectorStore = null;
        this.vectorStoreInitialized = false;
        
        if (this.isEnabled) {
            this.testOllama();
            this.initializeVectorStore();
        }
    }

    async testOllama() {
        try {
            // Test if Ollama is accessible - try to chat with a simple message
            const test = await this.ollama.chat({
                model: this.model,
                messages: [{ role: 'user', content: 'Hello' }]
            });
            console.log('✅ AI Insights Service initialized with Ollama');
            console.log(`   Model: ${this.model}`);
        } catch (error) {
            console.error('❌ Failed to connect to Ollama:', error.message);
            console.log('   Insights will use fallback answers');
            this.isEnabled = false;
        }
    }

    // RAG: Initialize vector store with event data
    async initializeVectorStore() {
        try {
            console.log('🔧 Initializing RAG vector store for events...');
            
            // Fetch all events from database
            const query = `
                SELECT id, title, description, category, event_type, affected_capacity
                FROM energy_events
                ORDER BY event_time DESC
                LIMIT 1000
            `;
            
            const result = await this.db.pool.query(query);
            const events = result.rows;

            if (events.length === 0) {
                console.log('⚠️  No events found in database. Vector store will be empty.');
                return;
            }

            // Prepare documents for vector store
            const documents = events.map(event => {
                const capacityInfo = event.affected_capacity 
                    ? ` Affected capacity: ${event.affected_capacity}MW.` 
                    : '';
                
                return {
                    pageContent: `[${event.category}] ${event.title}. ${event.description}${capacityInfo}`,
                    metadata: {
                        id: event.id,
                        category: event.category,
                        eventType: event.event_type,
                        affectedCapacity: event.affected_capacity
                    }
                };
            });

            // Create vector store from documents
            this.vectorStore = await MemoryVectorStore.fromDocuments(
                documents,
                this.embeddings
            );

            this.vectorStoreInitialized = true;
            console.log(`✅ RAG vector store initialized with ${events.length} events`);
            
        } catch (error) {
            console.error('❌ Error initializing vector store:', error.message);
            this.vectorStoreInitialized = false;
        }
    }

    // RAG: Search for relevant events based on user question
    async findRelevantEvents(question, topK = 4) {
        if (!this.vectorStoreInitialized || !this.vectorStore) {
            console.log('⚠️  Vector store not initialized, returning empty results');
            return [];
        }

        try {
            // Perform semantic similarity search
            const results = await this.vectorStore.similaritySearch(question, topK);
            
            console.log(`🔍 Found ${results.length} relevant events for question`);
            
            // Format results for context
            return results.map((result, index) => ({
                content: result.pageContent,
                category: result.metadata.category,
                relevanceRank: index + 1
            }));
            
        } catch (error) {
            console.error('❌ Error searching vector store:', error.message);
            return [];
        }
    }

    // Build context from recent market data
    async buildMarketContext() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7); // Last 7 days

            const query = `
                SELECT 
                    timestamp,
                    pl_load_actual, pl_price_day_ahead, pl_solar_generation, 
                    pl_wind_onshore_generation, pl_wind_offshore_generation,
                    hu_load_actual, hu_price_day_ahead, hu_solar_generation, 
                    hu_wind_onshore_generation, hu_wind_offshore_generation,
                    fi_load_actual, fi_price_day_ahead, fi_solar_generation, 
                    fi_wind_onshore_generation, fi_wind_offshore_generation
                FROM energy_data
                WHERE timestamp >= $1
                ORDER BY timestamp DESC
                LIMIT 500
            `;

            const result = await this.db.pool.query(query, [cutoffDate]);
            const data = result.rows;

            if (data.length === 0) {
                return 'No recent data available.';
            }

            // Calculate statistics for each country
            const stats = this.calculateStatistics(data);
            
            // Format context string
            const context = this.formatMarketContext(stats, data);
            
            this.marketContext = context;
            this.lastContextUpdate = new Date();
            
            return context;
        } catch (error) {
            console.error('Error building market context:', error);
            return 'Unable to retrieve market data.';
        }
    }

    calculateStatistics(data) {
        const countries = ['PL', 'HU', 'FI'];
        const stats = {};

        countries.forEach(country => {
            const prefix = country.toLowerCase();
            
            // Extract values
            const loads = data.map(d => d[`${prefix}_load_actual`]).filter(v => v !== null);
            const prices = data.map(d => d[`${prefix}_price_day_ahead`]).filter(v => v !== null);
            const solar = data.map(d => d[`${prefix}_solar_generation`]).filter(v => v !== null);
            
            // Combine onshore and offshore wind
            const wind = data.map(d => {
                const onshore = d[`${prefix}_wind_onshore_generation`] || 0;
                const offshore = d[`${prefix}_wind_offshore_generation`] || 0;
                return onshore + offshore;
            }).filter(v => v !== null && v > 0);

            // Calculate stats
            stats[country] = {
                load: this.getStats(loads),
                price: this.getStats(prices),
                solar: this.getStats(solar),
                wind: this.getStats(wind),
                renewable_share: this.calculateRenewableShare(solar, wind, loads)
            };
        });

        return stats;
    }

    getStats(values) {
        if (values.length === 0) return { avg: 0, min: 0, max: 0, current: 0, trend: 'stable' };
        
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const current = values[0]; // Most recent
        
        // Simple trend calculation
        const recent = values.slice(0, Math.min(20, values.length));
        const older = values.slice(Math.max(0, values.length - 20), values.length);
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        
        let trend = 'stable';
        if (recentAvg > olderAvg * 1.05) trend = 'rising';
        else if (recentAvg < olderAvg * 0.95) trend = 'falling';

        return {
            avg: Math.round(avg * 100) / 100,
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            current: Math.round(current * 100) / 100,
            trend
        };
    }

    calculateRenewableShare(solar, wind, loads) {
        if (solar.length === 0 || wind.length === 0 || loads.length === 0) return 0;
        
        const avgSolar = solar.reduce((a, b) => a + b, 0) / solar.length;
        const avgWind = wind.reduce((a, b) => a + b, 0) / wind.length;
        const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
        
        return Math.round((avgSolar + avgWind) / avgLoad * 1000) / 10; // Percentage
    }

    formatMarketContext(stats, recentData) {
        const latest = recentData[0];
        const timestamp = new Date(latest.timestamp).toISOString();

        let context = `MARKET DATA SUMMARY (Last 7 days, as of ${timestamp}):\n\n`;

        ['PL', 'HU', 'FI'].forEach(country => {
            const s = stats[country];
            context += `${country} (${this.getCountryName(country)}):\n`;
            context += `  Load: Current ${s.load.current} MW (${s.load.trend}), Avg ${s.load.avg} MW, Range ${s.load.min}-${s.load.max} MW\n`;
            context += `  Price: Current €${s.price.current}/MWh (${s.price.trend}), Avg €${s.price.avg}/MWh, Range €${s.price.min}-${s.price.max}/MWh\n`;
            context += `  Solar: ${s.solar.current} MW (${s.solar.trend}), Avg ${s.solar.avg} MW\n`;
            context += `  Wind: ${s.wind.current} MW (${s.wind.trend}), Avg ${s.wind.avg} MW\n`;
            context += `  Renewable Share: ${s.renewable_share}%\n\n`;
        });

        return context;
    }

    getCountryName(code) {
        const names = { PL: 'Poland', HU: 'Hungary', FI: 'Finland' };
        return names[code] || code;
    }

    /**
     * Detect if question requires online information and fetch it
     */
    async fetchOnlineContext(question) {
        if (!this.webToolsEnabled) {
            return '';
        }

        const questionLower = question.toLowerCase();
        let onlineContext = '';

        try {
            // Weather-related queries
            if (questionLower.includes('weather') || questionLower.includes('temperature') || 
                questionLower.includes('forecast') || questionLower.includes('wind speed')) {
                
                this.logger.log(`   🌤️  Fetching weather forecast...`);
                
                // Extract country if mentioned
                let country = 'PL';
                if (questionLower.includes('poland') || questionLower.includes('polish')) country = 'PL';
                else if (questionLower.includes('hungary') || questionLower.includes('hungarian')) country = 'HU';
                else if (questionLower.includes('finland') || questionLower.includes('finnish')) country = 'FI';
                else if (questionLower.includes('france') || questionLower.includes('french')) country = 'FR';
                else if (questionLower.includes('netherlands') || questionLower.includes('dutch')) country = 'NL';

                const weather = await this.webTools.getWeatherForecast(country, 3);
                const weatherText = this.webTools.formatForAI('weather', weather);
                onlineContext += `\n\n${weatherText}`;
                this.logger.log(`   ✅ Weather data retrieved`);
            }

            // News-related queries
            if (questionLower.includes('news') || questionLower.includes('latest') || 
                questionLower.includes('recent') || questionLower.includes('today')) {
                
                this.logger.log(`   📰 Fetching recent energy news...`);
                
                // Customize search query based on question context
                let searchQuery = 'energy market europe';
                if (questionLower.includes('poland')) searchQuery = 'poland energy market';
                else if (questionLower.includes('hungary')) searchQuery = 'hungary energy market';
                else if (questionLower.includes('finland')) searchQuery = 'finland energy market';
                else if (questionLower.includes('price')) searchQuery = 'electricity prices europe';
                else if (questionLower.includes('renewable')) searchQuery = 'renewable energy europe';

                const news = await this.webTools.searchNews(searchQuery, 3);
                const newsText = this.webTools.formatForAI('news', news);
                onlineContext += `\n\n${newsText}`;
                this.logger.log(`   ✅ News data retrieved (${news.length} articles)`);
            }

            // General web search for specific topics
            if (questionLower.includes('what is') || questionLower.includes('who is') || 
                questionLower.includes('define') || questionLower.includes('explain')) {
                
                // Extract the search term
                const searchMatch = questionLower.match(/(?:what is|who is|define|explain)\s+(.+?)(?:\?|$)/);
                if (searchMatch && searchMatch[1]) {
                    const searchTerm = searchMatch[1].trim();
                    this.logger.log(`   🔍 Web search for: "${searchTerm}"`);
                    
                    const searchResults = await this.webTools.webSearch(searchTerm);
                    const searchText = this.webTools.formatForAI('search', searchResults);
                    onlineContext += `\n\n${searchText}`;
                    this.logger.log(`   ✅ Web search completed`);
                }
            }

        } catch (error) {
            this.logger.error(`   ❌ Error fetching online context: ${error.message}`, error);
        }

        return onlineContext;
    }

    // Generate AI-powered insight with conversation history for multi-turn discussions
    async generateInsightWithHistory(question, conversationHistory = []) {
        if (!this.isEnabled) {
            return this.getFallbackAnswer(question);
        }

        const startTime = Date.now();

        try {
            // Skip cache for conversation context - each exchange should be unique
            this.logger.log(`   💭 Generating response with conversation context (${conversationHistory.length} previous exchanges)`);

            // Update context if stale (older than 5 minutes)
            if (!this.marketContext || !this.lastContextUpdate || 
                (Date.now() - this.lastContextUpdate) > 300000) {
                this.logger.log('   🔄 Updating market context...');
                await this.buildMarketContext();
            }

            // RAG: Find relevant events based on the question
            this.logger.log(`   🔍 Searching vector store for relevant events...`);
            const relevantEvents = await this.findRelevantEvents(question, 4);
            this.logger.log(`   📊 Found ${relevantEvents.length} relevant events from vector store`);
            if (relevantEvents.length > 0) {
                relevantEvents.forEach((event, i) => {
                    this.logger.log(`      ${i+1}. ${event.content.substring(0, 80)}...`);
                });
            }
            
            // Fetch online context (weather, news, web search)
            this.logger.log(`   🌐 Checking for online information needs...`);
            const onlineContext = await this.fetchOnlineContext(question);
            if (onlineContext) {
                this.logger.log(`   ✅ Online context added to prompt`);
            }
            
            // Build enhanced context with relevant events
            let eventsContext = '';
            if (relevantEvents.length > 0) {
                eventsContext = '\n\nRELEVANT RECENT EVENTS:\n';
                relevantEvents.forEach((event, index) => {
                    eventsContext += `${index + 1}. ${event.content}\n`;
                });
            }

            // Build conversation history context
            let conversationContext = '';
            if (conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION:\n';
                conversationHistory.slice(-5).forEach((exchange, index) => {
                    conversationContext += `Q${index + 1}: ${exchange.question}\n`;
                    conversationContext += `A${index + 1}: ${exchange.answer}\n\n`;
                });
            }

            // Build messages array for chat API (proper conversation format)
            const systemPrompt = `You are an expert energy trading analyst with access to real-time market data, historical events, and online information sources (weather forecasts, news, web search). Provide concise, data-driven answers that reference specific numbers and events when relevant. When answering follow-up questions, maintain context from the previous conversation and build upon earlier answers. Be conversational but professional.`;
            
            const messages = [
                {
                    role: 'system',
                    content: systemPrompt
                }
            ];

            // Add conversation history as messages
            conversationHistory.slice(-5).forEach(exchange => {
                messages.push({ role: 'user', content: exchange.question });
                messages.push({ role: 'assistant', content: exchange.answer });
            });

            // Add current context and question
            const currentPrompt = `CURRENT MARKET DATA:
${this.marketContext || 'Market data unavailable.'}${eventsContext}${onlineContext}

Current Question: ${question}

Provide a clear, actionable answer (2-4 sentences). Reference previous discussion if relevant. Use specific data points.`;

            messages.push({ role: 'user', content: currentPrompt });

            // Call Ollama using chat API with conversation history
            this.logger.log(`   🤖 Calling Ollama model: ${this.model}`);
            this.logger.log(`   📝 Message count: ${messages.length} (including ${conversationHistory.length} history exchanges)`);
            this.logger.log(`   ⏳ Waiting for AI response...`);
            
            const aiStartTime = Date.now();
            const response = await this.ollama.chat({
                model: this.model,
                messages: messages,
                options: {
                    temperature: 0.7,  // Slightly more creative for conversational flow
                    num_predict: 200   // Allow longer responses for follow-ups
                }
            });
            const aiDuration = Date.now() - aiStartTime;
            const answer = response.message.content.trim();
            const duration = Date.now() - startTime;

            this.logger.log(`   ✅ AI model responded in ${aiDuration}ms`);
            this.logger.log(`   📊 Total processing time: ${duration}ms`);
            
            const contextSources = [];
            contextSources.push(`${relevantEvents.length} events`);
            contextSources.push('market data');
            if (conversationHistory.length > 0) contextSources.push(`${conversationHistory.length} history`);
            if (onlineContext) contextSources.push('online sources');
            
            this.logger.log(`   🎯 Context used: ${contextSources.join(' + ')}`);
            this.logger.log(`   💬 Response: "${answer.substring(0, 150)}${answer.length > 150 ? '...' : ''}"`);

            return answer;

        } catch (error) {
            console.error('❌ Error generating AI insight:', error.message);
            return this.getFallbackAnswer(question);
        }
    }

    // Generate AI-powered insight with RAG (single question, no history)
    async generateInsight(question) {
        // Delegate to the history-aware version with empty history
        return this.generateInsightWithHistory(question, []);
    }

    // Fallback to mock answers if AI fails
    getFallbackAnswer(question) {
        const mockAnswers = {
            'price': 'Current market conditions suggest moderate price levels. Monitor supply-demand balance closely.',
            'wind': 'Wind generation is variable. Check latest forecasts for trading decisions.',
            'solar': 'Solar output depends on weather conditions. Review day-ahead forecasts.',
            'load': 'Load patterns are within normal ranges. Watch for demand spikes during peak hours.',
            'arbitrage': 'Cross-border price differentials exist. Evaluate interconnector capacity utilization.',
            'forecast': 'Forecast accuracy varies. Use historical performance metrics for risk assessment.',
            'risk': 'Key risks include supply disruptions and demand volatility. Maintain hedged positions.',
            'renewable': 'Renewable generation impacts pricing. Monitor wind and solar output trends.',
            'default': 'Market conditions are dynamic. Analyze recent data trends for informed decisions.'
        };

        // Simple keyword matching
        const qLower = question.toLowerCase();
        for (const [keyword, answer] of Object.entries(mockAnswers)) {
            if (qLower.includes(keyword)) {
                return answer;
            }
        }

        return mockAnswers.default;
    }

    cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                this.cache.delete(key);
            }
        }
    }

    // Get service status
    getStatus() {
        return {
            enabled: this.isEnabled,
            model: process.env.OLLAMA_MODEL || 'llama3:8b',
            embeddingModel: 'nomic-embed-text',
            cacheSize: this.cache.size,
            lastContextUpdate: this.lastContextUpdate,
            contextAge: this.lastContextUpdate ? 
                Math.round((Date.now() - this.lastContextUpdate) / 1000) : null,
            ragEnabled: this.vectorStoreInitialized,
            vectorStoreReady: this.vectorStore !== null
        };
    }
}

module.exports = AIInsightsService;
