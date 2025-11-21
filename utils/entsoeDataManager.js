const EntsoeClient = require('./entsoeClient');
const { subDays, addMinutes, startOfDay } = require('date-fns');

class EntsoeDataManager {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('ENTSO-E API key is required for live data fetching');
        }
        this.client = new EntsoeClient(apiKey);
        this.cache = [];
        this.lastFetchTime = null;
        this.countries = ['PL', 'HU', 'FI', 'FR', 'NL']; // Top 5 countries with best data availability
        this.isStreaming = false;
        this.currentIndex = 0;
    }

    /**
     * Fetch historical data (1 year back) + recent data in batches
     * ENTSO-E API has limits, so we fetch in monthly chunks
     * @param {number} daysBack - Number of days to fetch (default: 365)
     * @returns {Promise<Array>} - Array of data points
     */
    async fetchHistoricalData(daysBack = 365) {
        console.log(`\n📊 Fetching ${daysBack} days of historical data from ENTSO-E...`);
        console.log(`   This may take a few minutes as we batch the requests...\n`);
        
        const endDate = new Date();
        const startDate = startOfDay(subDays(endDate, daysBack));
        
        // Split into monthly chunks to avoid API limits
        const chunks = this.createDateChunks(startDate, endDate, 30); // 30-day chunks
        console.log(`   Fetching ${chunks.length} time periods (30-day chunks)...\n`);
        
        const allData = {};
        
        // Initialize country data structures
        for (const country of this.countries) {
            allData[country] = {
                actualLoad: [],
                loadForecast: [],
                generation: {},
                prices: []
            };
        }
        
        // Fetch data in chunks
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const progress = Math.round(((i + 1) / chunks.length) * 100);
            console.log(`[${i + 1}/${chunks.length}] (${progress}%) Fetching ${chunk.start.toISOString().split('T')[0]} to ${chunk.end.toISOString().split('T')[0]}...`);
            
            for (const country of this.countries) {
                try {
                    const [actualLoad, loadForecast, generation, prices] = await Promise.all([
                        this.client.getActualLoad(country, chunk.start, chunk.end),
                        this.client.getLoadForecast(country, chunk.start, chunk.end),
                        this.client.getGenerationByType(country, chunk.start, chunk.end),
                        this.client.getDayAheadPrices(country, chunk.start, chunk.end)
                    ]);

                    // Append to existing data
                    allData[country].actualLoad.push(...actualLoad);
                    allData[country].loadForecast.push(...loadForecast);
                    allData[country].prices.push(...prices);
                    
                    // Merge generation data
                    for (const [type, points] of Object.entries(generation)) {
                        if (!allData[country].generation[type]) {
                            allData[country].generation[type] = [];
                        }
                        allData[country].generation[type].push(...points);
                    }

                    console.log(`  ✓ ${country}: +${actualLoad.length} load, +${prices.length} prices`);
                } catch (error) {
                    console.error(`  ✗ ${country} error:`, error.message);
                }
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        console.log(`\n📊 Historical data summary:`);
        for (const country of this.countries) {
            const data = allData[country];
            console.log(`   ${country}: ${data.actualLoad.length} load points, ${Object.keys(data.generation).length} generation types, ${data.prices.length} prices`);
        }

        // Merge data by timestamp
        this.cache = this.mergeCountryData(allData);
        this.lastFetchTime = new Date();
        this.currentIndex = 0;

        console.log(`\n✅ Historical data loaded: ${this.cache.length} total data points`);
        console.log(`   Date range: ${this.cache[0]?.timestamp} to ${this.cache[this.cache.length - 1]?.timestamp}\n`);
        
        return this.cache;
    }

    /**
     * Create date chunks for batch fetching
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @param {number} chunkDays - Days per chunk
     * @returns {Array} - Array of {start, end} date pairs
     */
    createDateChunks(startDate, endDate, chunkDays) {
        const chunks = [];
        let currentStart = new Date(startDate);
        
        while (currentStart < endDate) {
            const currentEnd = new Date(currentStart);
            currentEnd.setDate(currentEnd.getDate() + chunkDays);
            
            if (currentEnd > endDate) {
                chunks.push({ start: currentStart, end: endDate });
                break;
            } else {
                chunks.push({ start: currentStart, end: currentEnd });
            }
            
            currentStart = new Date(currentEnd);
        }
        
        return chunks;
    }

    /**
     * Fetch live data for all countries (recent data only)
     * @param {number} daysBack - Number of days to fetch (default: 7)
     * @returns {Promise<Array>} - Array of data points
     */
    async fetchLiveData(daysBack = 7) {
        console.log(`\n🔄 Fetching live data from ENTSO-E for the last ${daysBack} days...`);
        const endDate = new Date();
        const startDate = startOfDay(subDays(endDate, daysBack));
        
        const allData = {};
        
        // Fetch data for each country
        for (const country of this.countries) {
            console.log(`Fetching data for ${country}...`);
            
            try {
                const [actualLoad, loadForecast, generation, prices] = await Promise.all([
                    this.client.getActualLoad(country, startDate, endDate),
                    this.client.getLoadForecast(country, startDate, endDate),
                    this.client.getGenerationByType(country, startDate, endDate),
                    this.client.getDayAheadPrices(country, startDate, endDate)
                ]);

                allData[country] = {
                    actualLoad,
                    loadForecast,
                    generation,
                    prices
                };

                console.log(`✓ ${country}: ${actualLoad.length} load points, ${Object.keys(generation).length} generation types, ${prices.length} price points`);
            } catch (error) {
                console.error(`✗ Error fetching data for ${country}:`, error.message);
                allData[country] = {
                    actualLoad: [],
                    loadForecast: [],
                    generation: {},
                    prices: []
                };
            }
        }

        // Merge data by timestamp
        this.cache = this.mergeCountryData(allData);
        this.lastFetchTime = new Date();
        this.currentIndex = 0;

        console.log(`\n✅ Live data fetch complete: ${this.cache.length} total data points`);
        return this.cache;
    }

    /**
     * Merge data from multiple countries by timestamp
     * @param {Object} countryData - Data organized by country
     * @returns {Array} - Merged data points
     */
    mergeCountryData(countryData) {
        const timestampMap = new Map();

        // Process each country's data
        for (const [country, data] of Object.entries(countryData)) {
            const prefix = country.toLowerCase();

            // Add actual load
            data.actualLoad.forEach(point => {
                const ts = point.timestamp.toISOString();
                if (!timestampMap.has(ts)) {
                    timestampMap.set(ts, { timestamp: point.timestamp });
                }
                timestampMap.get(ts)[`${prefix}_load_actual`] = point.value;
            });

            // Add load forecast
            data.loadForecast.forEach(point => {
                const ts = point.timestamp.toISOString();
                if (!timestampMap.has(ts)) {
                    timestampMap.set(ts, { timestamp: point.timestamp });
                }
                timestampMap.get(ts)[`${prefix}_load_forecast`] = point.value;
            });

            // Add generation by type
            for (const [genType, points] of Object.entries(data.generation)) {
                const fieldName = `${prefix}_${genType.toLowerCase().replace(/\s+/g, '_')}_generation`;
                points.forEach(point => {
                    const ts = point.timestamp.toISOString();
                    if (!timestampMap.has(ts)) {
                        timestampMap.set(ts, { timestamp: point.timestamp });
                    }
                    timestampMap.get(ts)[fieldName] = point.value;
                });
            }

            // Add prices
            data.prices.forEach(point => {
                const ts = point.timestamp.toISOString();
                if (!timestampMap.has(ts)) {
                    timestampMap.set(ts, { timestamp: point.timestamp });
                }
                timestampMap.get(ts)[`${prefix}_price_day_ahead`] = point.value;
            });
        }

        // Convert map to sorted array
        return Array.from(timestampMap.values())
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Get current data point
     * @returns {Object|null} - Current data point
     */
    getCurrentDataPoint() {
        if (this.cache.length === 0) return null;
        return this.cache[this.currentIndex];
    }

    /**
     * Move to next data point
     * @returns {Object|null} - Next data point
     */
    getNextDataPoint() {
        if (this.cache.length === 0) return null;
        this.currentIndex = (this.currentIndex + 1) % this.cache.length;
        return this.cache[this.currentIndex];
    }

    /**
     * Get all cached data
     * @returns {Array} - All data points
     */
    getAllData() {
        return this.cache;
    }

    /**
     * Get cache info
     * @returns {Object} - Cache information
     */
    getCacheInfo() {
        return {
            dataPoints: this.cache.length,
            lastFetch: this.lastFetchTime,
            currentIndex: this.currentIndex,
            countries: this.countries,
            dateRange: this.cache.length > 0 ? {
                start: this.cache[0].timestamp,
                end: this.cache[this.cache.length - 1].timestamp
            } : { start: null, end: null }
        };
    }

    /**
     * Reset stream to beginning
     */
    reset() {
        this.currentIndex = 0;
    }

    /**
     * Check if data needs refresh (older than 1 hour)
     * @returns {boolean} - True if refresh needed
     */
    needsRefresh() {
        if (!this.lastFetchTime) return true;
        const hoursSinceLastFetch = (Date.now() - this.lastFetchTime.getTime()) / (1000 * 60 * 60);
        return hoursSinceLastFetch > 1;
    }
}

module.exports = EntsoeDataManager;
