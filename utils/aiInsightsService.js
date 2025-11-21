const { Ollama } = require('ollama');

class AIInsightsService {
    constructor(databaseManager) {
        this.db = databaseManager;
        this.cache = new Map();
        this.cacheTTL = parseInt(process.env.AI_INSIGHTS_CACHE_TTL) || 300000; // 5 minutes
        this.isEnabled = process.env.AI_INSIGHTS_ENABLED === 'true';
        this.lastContextUpdate = null;
        this.marketContext = null;
        this.ollamaHost = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = process.env.OLLAMA_MODEL || 'llama3:8b';
        
        // Initialize Ollama client
        this.ollama = new Ollama({ host: this.ollamaHost });
        
        if (this.isEnabled) {
            this.testOllama();
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

    // Generate AI-powered insight
    async generateInsight(question) {
        if (!this.isEnabled) {
            return this.getFallbackAnswer(question);
        }

        const startTime = Date.now();

        try {
            // Check cache
            const cacheKey = question.toLowerCase();
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                console.log(`📦 Cache hit for: "${question.substring(0, 50)}..."`);
                return cached.answer;
            }

            // Update context if stale (older than 5 minutes)
            if (!this.marketContext || !this.lastContextUpdate || 
                (Date.now() - this.lastContextUpdate) > 300000) {
                console.log('🔄 Updating market context...');
                await this.buildMarketContext();
            }

            // Build prompt
            const prompt = `You are an expert energy trading analyst. Based on the current market data, answer the following question concisely and actionably.

${this.marketContext || 'Market data unavailable.'}

Question: ${question}

Provide a brief, data-driven answer (2-3 sentences max). Include specific numbers from the data when relevant. Focus on actionable insights for traders.

Answer:`;


            // Call Ollama using chat API
            console.log(`🤖 Generating AI insight for: "${question.substring(0, 50)}..."`);
            const response = await this.ollama.chat({
                model: this.model,
                messages: [
                    { role: 'user', content: prompt }
                ]
            });
            const answer = response.message.content.trim();
            const duration = Date.now() - startTime;

            console.log(`✅ AI response generated in ${duration}ms`);

            // Cache the result
            this.cache.set(cacheKey, {
                answer: answer,
                timestamp: Date.now()
            });

            // Clean old cache entries
            this.cleanCache();

            return answer;

        } catch (error) {
            console.error('❌ Error generating AI insight:', error.message);
            return this.getFallbackAnswer(question);
        }
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
            cacheSize: this.cache.size,
            lastContextUpdate: this.lastContextUpdate,
            contextAge: this.lastContextUpdate ? 
                Math.round((Date.now() - this.lastContextUpdate) / 1000) : null
        };
    }
}

module.exports = AIInsightsService;
