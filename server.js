require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse');
const Parser = require('rss-parser');
const { subDays, format } = require('date-fns');
const EnergyDataProcessor = require('./utils/dataProcessor');
const TradingMetrics = require('./utils/tradingMetrics');
const DatabaseManager = require('./utils/databaseManager');
const EntsoeClient = require('./utils/entsoeClient');
const EntsoeDataManager = require('./utils/entsoeDataManager');
const AIInsightsService = require('./utils/aiInsightsService');
const RTEClient = require('./utils/rteClient');
const NordPoolClient = require('./utils/nordPoolClient');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Create RSS parser with custom HTTPS agent to handle SSL certificates
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const rssParser = new Parser({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    customFields: {
        item: ['description', 'content:encoded']
    }
});

const PORT = process.env.PORT || 3000;
const ENTSOE_API_KEY = process.env.ENTSOE_API_KEY;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Data streaming state
let dbData = [];
let currentIndex = 0;
let isStreaming = false;
let streamingInterval = null;
let selectedDataset = 'time_series_30min_singleindex.csv';

// Initialize data processors and database
const dataProcessor = new EnergyDataProcessor();
const tradingMetrics = new TradingMetrics();
const dbManager = new DatabaseManager();
const entsoeClient = ENTSOE_API_KEY && ENTSOE_API_KEY !== 'YOUR_API_KEY_HERE' 
    ? new EntsoeClient(ENTSOE_API_KEY) 
    : null;

// Initialize AI Insights Service
let aiInsightsService = null;

// Initialize ENTSO-E live data manager
const entsoeDataManager = ENTSOE_API_KEY && ENTSOE_API_KEY !== 'YOUR_API_KEY_HERE'
    ? new EntsoeDataManager(ENTSOE_API_KEY)
    : null;

let historicalDataBuffer = [];
let isDbInitialized = false;
let dataSource = 'unknown'; // 'entsoe-live', 'database', or 'csv'

// News cache
let newsCache = [];
let lastReutersFetch = null;

// Mock data for insights - Energy Trading Q&A
const traderInsights = [
    { question: "What's driving price volatility in the Polish market today?", answer: "Coal generation outages combined with low wind output are pushing prices higher. Consider hedging exposure during evening peak hours." },
    { question: "Is there an arbitrage opportunity between Poland and Finland?", answer: "Yes, significant spread detected. Finnish prices are 15-20% lower due to abundant hydro. Monitor interconnector capacity utilization." },
    { question: "How accurate are the wind forecasts for Finland this week?", answer: "High confidence - weather models show consistent patterns. Expect strong wind generation to suppress day-ahead prices through Friday." },
    { question: "Should we adjust our position based on Hungarian load forecast deviation?", answer: "Load is tracking 8% above forecast due to cold snap. Consider reducing short positions and watch for grid stress warnings." },
    { question: "What's the renewable energy outlook for Poland?", answer: "Solar generation ramping up with clear skies expected. Wind farms at 60% capacity. Net renewable share could hit 25% by afternoon." },
    { question: "How is the Polish coal fleet responding to demand spikes?", answer: "Slow ramp rates creating intraday volatility. Consider trading the morning/evening transitions when flexibility is most valuable." },
    { question: "What's the biggest risk in the Nordic market right now?", answer: "Hydro reservoir levels are below seasonal average. Any prolonged dry spell could trigger sharp price increases across Finland and neighbors." },
    { question: "Are Hungarian day-ahead prices following the regional trend?", answer: "Partially decoupled - domestic nuclear output is stable, providing price floor. Watch for convergence during high-demand periods." },
    { question: "What's the cross-border flow pattern between PL and neighboring markets?", answer: "Net importer position today. German excess renewables flowing eastward, keeping Polish prices in check. This could reverse tonight." },
    { question: "How should we position for the weekend load drop?", answer: "Industrial demand falls 30-40% on weekends. Renewable oversupply likely - consider shorting day-ahead or buying low for Monday delivery." },
    { question: "Is the Finnish market pricing in the forecasted temperature drop?", answer: "Not fully. Current forward curve looks flat, but 5°C drop expected next week could add 500-700 MW load. Opportunity for long positions." },
    { question: "What's the impact of EU carbon prices on Central European markets?", answer: "EUA trading at multi-year highs - increasing coal generation costs in PL and HU. Clean spark spreads favor gas, watch for fuel switching." },
    { question: "Should we be concerned about grid congestion in Hungary?", answer: "Southern interconnector is near thermal limits. Any additional flows could trigger market splitting and locational price divergence." },
    { question: "What's the solar capacity factor looking like for Poland this month?", answer: "Below average at 12-14% due to persistent cloud cover. Don't expect significant solar contribution until weather pattern shifts." },
    { question: "How reliable is the load forecast during holiday periods?", answer: "Historical accuracy drops 15-20% during holidays. Use wider confidence intervals and consider scenario-based hedging strategies." }
];

// Fetch Energy News RSS feed
async function fetchEnergyNews() {
    try {
        console.log('Fetching Energy news from multiple sources...');
        
        // Temporarily disable SSL verification for RSS feeds
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        
        // Try Energy Live News first
        try {
            const feed = await rssParser.parseURL('https://www.energylivenews.com/feed/');
            const news = feed.items.slice(0, 30).map(item => ({
                headline: `Energy Live News - ${item.title}`,
                link: item.link || 'https://www.energylivenews.com',
                pubDate: item.pubDate,
                source: 'Energy Live News'
            }));
            console.log(`Fetched ${news.length} Energy Live News headlines`);
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'; // Re-enable
            return news;
        } catch (err) {
            console.error('Energy Live News failed:', err.message);
        }
        
        // Fallback to Power Technology
        try {
            const feed = await rssParser.parseURL('https://www.power-technology.com/feed/');
            const news = feed.items.slice(0, 30).map(item => ({
                headline: `Power Technology - ${item.title}`,
                link: item.link || 'https://www.power-technology.com',
                pubDate: item.pubDate,
                source: 'Power Technology'
            }));
            console.log(`Fetched ${news.length} Power Technology headlines`);
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'; // Re-enable
            return news;
        } catch (err) {
            console.error('Power Technology failed:', err.message);
        }
        
        return [];
    } catch (error) {
        console.error('Error fetching energy news:', error.message);
        return [];
    }
}

// Fetch ENTSO-E outage news
async function fetchEntsoeNews() {
    if (!entsoeClient) return [];

    try {
        console.log('Fetching ENTSO-E outage data...');
        const countries = ['GB', 'IE', 'CY'];
        let allNews = [];

        for (const country of countries) {
            const outages = await entsoeClient.getUnplannedOutages(country);
            if (outages.length > 0) {
                // Format with source prefix
                const formattedOutages = outages.map(outage => ({
                    headline: `ENTSO-E - ${outage.headline}`,
                    link: 'https://transparency.entsoe.eu',
                    source: 'ENTSO-E'
                }));
                allNews = [...allNews, ...formattedOutages];
            }
        }

        console.log(`Fetched ${allNews.length} ENTSO-E outage alerts`);
        return allNews;
    } catch (error) {
        console.error('Error fetching ENTSO-E news:', error.message);
        return [];
    }
}

// Parse news headlines for trading-relevant events
async function parseNewsForEvents(newsItems) {
    const events = [];
    
    // Expanded keywords for trading-relevant events
    const outageKeywords = /outage|offline|shutdown|maintenance|unavailable|down|failure|trip|forced\s+stop|fault|breakdown|disconnected/i;
    const plannedKeywords = /planned|scheduled|maintenance|upcoming/i;
    const unplannedKeywords = /unplanned|emergency|forced|unexpected|sudden|trip|alarm|fault|failure/i;
    
    // Additional trading-relevant event types
    const priceSpike = /price\s+spike|price\s+surge|record\s+high|skyrocket|soar/i;
    const demandSurge = /demand\s+surge|demand\s+spike|high\s+demand|peak\s+demand|strain|shortage/i;
    const weatherImpact = /storm|hurricane|heatwave|cold\s+snap|freeze|extreme\s+weather|wind\s+speed|low\s+wind/i;
    const supplyIssue = /supply\s+shortage|supply\s+disruption|capacity\s+constraint|grid\s+stress|blackout|brownout/i;
    const interconnector = /interconnector|cable\s+fault|import|export|cross-border|transmission\s+capacity/i;
    
    // Country mapping
    const countryMap = {
        'Poland': 'PL', 'Polish': 'PL',
        'Hungary': 'HU', 'Hungarian': 'HU',
        'Finland': 'FI', 'Finnish': 'FI', 'Nordic': 'FI',
        'France': 'FR', 'French': 'FR',
        'Netherlands': 'NL', 'Dutch': 'NL',
        'Germany': 'DE', 'German': 'DE',
        'Sweden': 'SE', 'Swedish': 'SE'
    };
    
    for (const item of newsItems) {
        const text = `${item.headline} ${item.description || ''}`;
        
        // Determine event type and category based on keywords
        let eventType = null;
        let category = null;
        let isRelevant = false;
        
        // Check for outages (primary events)
        if (outageKeywords.test(text)) {
            isRelevant = true;
            eventType = unplannedKeywords.test(text) ? 'UNPLANNED_OUTAGE' : 'PLANNED_OUTAGE';
            
            if (/transmission|grid|line|interconnector/i.test(text)) {
                category = 'TRANSMISSION';
            } else if (/offshore|wind\s+farm|subsea/i.test(text)) {
                category = 'OFFSHORE';
            } else {
                category = 'GENERATION';
            }
        }
        // Check for price spikes
        else if (priceSpike.test(text)) {
            isRelevant = true;
            eventType = 'PRICE_SPIKE';
            category = 'MARKET';
        }
        // Check for demand surges
        else if (demandSurge.test(text)) {
            isRelevant = true;
            eventType = 'DEMAND_SURGE';
            category = 'MARKET';
        }
        // Check for weather impacts
        else if (weatherImpact.test(text)) {
            isRelevant = true;
            eventType = 'WEATHER_EVENT';
            category = 'ENVIRONMENTAL';
        }
        // Check for supply issues
        else if (supplyIssue.test(text)) {
            isRelevant = true;
            eventType = 'SUPPLY_ISSUE';
            category = 'MARKET';
        }
        // Check for interconnector events
        else if (interconnector.test(text)) {
            isRelevant = true;
            eventType = 'INTERCONNECTOR';
            category = 'TRANSMISSION';
        }
        
        if (!isRelevant) continue;
        
        // Extract capacity (MW, GW) - optional for non-outage events
        const mwMatch = text.match(/(\d+(?:,\d+)?(?:\.\d+)?)\s*MW/i);
        const gwMatch = text.match(/(\d+(?:,\d+)?(?:\.\d+)?)\s*GW/i);
        let capacity = null;
        if (gwMatch) {
            capacity = parseFloat(gwMatch[1].replace(',', '')) * 1000; // Convert GW to MW
        } else if (mwMatch) {
            capacity = parseFloat(mwMatch[1].replace(',', ''));
        }
        
        // For outages, require capacity; for other events, it's optional
        if ((eventType.includes('OUTAGE') && (!capacity || capacity < 50))) continue;
        
        // Extract country
        let country = null;
        for (const [name, code] of Object.entries(countryMap)) {
            if (new RegExp(name, 'i').test(text)) {
                country = code;
                break;
            }
        }
        
        // Create event - for non-outage events, capacity is optional
        // For outage events, we already filtered by capacity above
        if (country) {
            events.push({
                event_time: item.pubDate ? new Date(item.pubDate) : new Date(),
                event_end_time: null,
                country: country,
                event_type: eventType,
                event_category: category,
                title: item.headline.substring(0, 200),
                description: text.substring(0, 500),
                affected_cap: capacity, // May be null for non-outage events
                unit_name: 'News Source',
                source: item.source || 'NEWS'
            });
        }
    }
    
    return events;
}

// Fetch all news sources and extract events
async function fetchAllNews() {
    try {
        const [energyNews, entsoeNews] = await Promise.all([
            fetchEnergyNews(),
            fetchEntsoeNews()
        ]);

        // Combine and shuffle news
        newsCache = [...entsoeNews, ...energyNews];
        lastReutersFetch = Date.now();

        console.log(`Total news items in cache: ${newsCache.length}`);
        
        // Parse news for events and store them
        const newsEvents = await parseNewsForEvents(newsCache);
        if (newsEvents.length > 0) {
            const insertedCount = await dbManager.insertEvents(newsEvents);
            console.log(`📰 Extracted ${insertedCount} events from news headlines`);
        }
        
        return newsCache;
    } catch (error) {
        console.error('Error fetching news:', error);
        return [];
    }
}

// Load data from database
async function loadDatabaseData() {
    try {
        console.log('Loading data from TimescaleDB...');
        
        if (!isDbInitialized) {
            const connected = await dbManager.testConnection();
            if (!connected) {
                throw new Error('Cannot connect to database');
            }
            isDbInitialized = true;
        }

        // Get all data ordered by timestamp
        const query = `
            SELECT 
                timestamp,
                cet_timestamp,
                cy_load_actual,
                cy_load_forecast,
                cy_wind_onshore_generation,
                gb_gbn_load_actual,
                gb_gbn_load_forecast,
                gb_gbn_solar_generation,
                gb_gbn_wind_generation,
                gb_gbn_wind_offshore_generation,
                gb_gbn_wind_onshore_generation,
                gb_nir_load_actual,
                gb_nir_load_forecast,
                gb_nir_wind_onshore_generation,
                gb_ukm_load_actual,
                gb_ukm_load_forecast,
                gb_ukm_solar_generation,
                gb_ukm_wind_generation,
                gb_ukm_wind_offshore_generation,
                gb_ukm_wind_onshore_generation,
                ie_load_actual,
                ie_load_forecast,
                ie_wind_onshore_generation,
                ie_sem_load_actual,
                ie_sem_load_forecast,
                ie_sem_price_day_ahead,
                ie_sem_wind_onshore_generation,
                data_quality_score
            FROM energy_trading_30min 
            ORDER BY timestamp ASC
        `;
        
        const result = await dbManager.pool.query(query);
        console.log(`Loaded ${result.rows.length} records from database`);
        
        return result.rows;
        
    } catch (error) {
        console.error('Error loading database data:', error);
        throw error;
    }
}

// Load CSV data into memory (fallback)
async function loadCSVData(filename) {
    return new Promise((resolve, reject) => {
        const results = [];
        const filePath = path.join(__dirname, 'data', filename);
        
        console.log(`Loading data from: ${filePath}`);
        
        fs.createReadStream(filePath)
            .pipe(parse({ 
                columns: true, 
                skip_empty_lines: true,
                trim: true
            }))
            .on('data', (data) => {
                results.push(data);
            })
            .on('end', () => {
                console.log(`Loaded ${results.length} records from ${filename}`);
                resolve(results);
            })
            .on('error', (error) => {
                console.error('Error loading CSV:', error);
                reject(error);
            });
    });
}

// Initialize data on server start
async function initializeData() {
    try {
        // Require ENTSO-E API key - no CSV fallback
        if (!entsoeDataManager) {
            throw new Error('ENTSO-E API key is required. Please set ENTSOE_API_KEY in .env file.');
        }

        try {
            // Check if cached data exists and is recent (less than 1 day old)
            const cacheFile = path.join(__dirname, 'data-cache.json');
            let loadedFromCache = false;
            
            if (fs.existsSync(cacheFile)) {
                try {
                    console.log('📦 Found cached data, loading...');
                    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    const cacheAge = Date.now() - cacheData.timestamp;
                    const oneDayMs = 24 * 60 * 60 * 1000;
                    
                    if (cacheAge < oneDayMs && cacheData.data && cacheData.data.length > 0) {
                        dbData = cacheData.data;
                        currentIndex = 0;
                        dataSource = 'entsoe-cached';
                        loadedFromCache = true;
                        console.log(`✅ Loaded ${dbData.length} data points from cache`);
                        console.log(`� Cache age: ${Math.round(cacheAge / (60 * 60 * 1000))} hours\n`);
                        
                        // Start background refresh for real-time updates
                        startRealtimeDataRefresh();
                        return;
                    } else {
                        console.log('⚠️  Cache is too old or empty, fetching fresh data...\n');
                    }
                } catch (cacheError) {
                    console.log('⚠️  Cache corrupted, fetching fresh data...\n');
                }
            }
            
            // Fetch fresh data if no valid cache
            console.log('�📡 Fetching historical + live data from ENTSO-E...');
            console.log('⏳ This will take several minutes for 1 year of data...\n');
            
            // Use TimescaleDB for persistent storage
            console.log('Connecting to TimescaleDB...');
            const dbConnected = await dbManager.testConnection();
            
            if (!dbConnected) {
                throw new Error('Cannot connect to TimescaleDB');
            }

            await dbManager.initializeSchema();

            const dbCount = await dbManager.getDataCount();
            const latestTimestamp = await dbManager.getLatestTimestamp();
            
            console.log(`Database contains ${dbCount} records`);
            if (latestTimestamp) {
                console.log(`Latest data: ${latestTimestamp}`);
            }

            const needsFetch = dbCount === 0;
            const isStale = latestTimestamp && (new Date() - new Date(latestTimestamp)) > (24 * 60 * 60 * 1000);

            if (needsFetch) {
                console.log('\n========================================');
                console.log('📡 INITIAL DATA FETCH - 1 YEAR');
                console.log('========================================');
                console.log('⏳ This will take 5-10 minutes...');
                console.log('   Progress will be shown below:\n');
                
                const startTime = Date.now();
                const fetchedData = await entsoeDataManager.fetchHistoricalData(365);
                const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
                
                if (fetchedData.length > 0) {
                    console.log(`\n========================================`);
                    console.log(`✅ FETCH COMPLETE in ${elapsed} minutes`);
                    console.log(`📊 Fetched ${fetchedData.length} data points`);
                    console.log(`========================================\n`);
                    
                    console.log(`💾 Saving to TimescaleDB...`);
                    const saveStartTime = Date.now();
                    await dbManager.insertData(fetchedData);
                    const saveElapsed = ((Date.now() - saveStartTime) / 1000).toFixed(1);
                    console.log(`✅ Saved ${fetchedData.length} records in ${saveElapsed}s\n`);
                }
            } else if (isStale) {
                console.log('Fetching latest updates...');
                const daysSince = Math.ceil((new Date() - new Date(latestTimestamp)) / (24 * 60 * 60 * 1000));
                const freshData = await entsoeDataManager.fetchHistoricalData(daysSince + 1);
                
                if (freshData.length > 0) {
                    await dbManager.insertData(freshData);
                    console.log('Database updated');
                }
            }

            console.log('Loading data from database...');
            dbData = await dbManager.getAllData();
            currentIndex = 0;
            dataSource = 'timescaledb';
            
            console.log(`Loaded ${dbData.length} records`);
            
            // Initialize AI Insights Service
            if (!aiInsightsService) {
                console.log('🤖 Initializing AI Insights Service...');
                aiInsightsService = new AIInsightsService(dbManager);
                await aiInsightsService.buildMarketContext();
                const status = aiInsightsService.getStatus();
                console.log(`✅ AI Insights Service ready (Model: ${status.model}, Enabled: ${status.enabled})`);
            }
            
            // Fetch events from ENTSO-E
            await fetchAndStoreEvents();
            
            startRealtimeDataRefresh();
            return;
        } catch (entsoeError) {
            console.error('❌ ENTSO-E data fetch failed:', entsoeError.message);
            throw entsoeError;
        }
    } catch (error) {
        console.error('❌ Failed to initialize data:', error.message);
        console.error('💡 Make sure your ENTSO-E API key is correctly set in .env file');
        console.error('   Get your API key from: https://transparency.entsoe.eu/');
        process.exit(1);
    }
}

// Fetch and store events from ENTSO-E
async function fetchAndStoreEvents(days = 365) {
    try {
        const eventCount = await dbManager.getEventCount();
        console.log(`\n📅 Event database contains ${eventCount} events`);
        
        let allEvents = [];
        
        // 1. Fetch from ENTSO-E (all countries)
        if (entsoeClient) {
            console.log(`📡 Fetching events from ENTSO-E (last ${days} days)...`);
            const chunkSize = 90;
            const countries = ['PL', 'HU', 'FI', 'FR', 'NL'];
            const endDate = new Date();
            
            for (let i = 0; i < days; i += chunkSize) {
                const chunkStart = subDays(endDate, Math.min(i + chunkSize, days));
                const chunkEnd = subDays(endDate, i);
                
                console.log(`  Chunk: ${format(chunkStart, 'yyyy-MM-dd')} to ${format(chunkEnd, 'yyyy-MM-dd')}`);
                
                for (const country of countries) {
                    const events = await entsoeClient.getOutageEvents(country, chunkStart, chunkEnd);
                    allEvents = allEvents.concat(events);
                    console.log(`    ${country}: ${events.length} events`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } else {
            console.log('⚠️  ENTSO-E client not available');
        }
        
        // 2. Fetch from RTE (France only)
        console.log(`\n📡 Fetching events from RTE (France)...`);
        try {
            const rteEvents = await RTEClient.fetchUnavailabilitiesChunked(Math.min(days, 30));
            allEvents = allEvents.concat(rteEvents);
            console.log(`  FR (RTE): ${rteEvents.length} events`);
        } catch (error) {
            console.log(`  RTE fetch error: ${error.message}`);
        }
        
        // 3. Fetch from Nord Pool (Nordic countries)
        console.log(`\n📡 Fetching events from Nord Pool (Nordic)...`);
        try {
            const nordPoolEvents = await NordPoolClient.fetchEventsChunked(Math.min(days, 30));
            allEvents = allEvents.concat(nordPoolEvents);
            console.log(`  Nord Pool: ${nordPoolEvents.length} events`);
        } catch (error) {
            console.log(`  Nord Pool fetch error: ${error.message}`);
        }
        
        // 4. Insert all events into database
        if (allEvents.length > 0) {
            const insertedCount = await dbManager.insertEvents(allEvents);
            console.log(`\n✅ Total: ${allEvents.length} events fetched, ${insertedCount} new inserted\n`);
        } else {
            console.log('\nℹ️  No new events found from any source\n');
        }
    } catch (error) {
        console.error('❌ Error fetching events:', error.message);
    }
}

// Background refresh for real-time data updates
let realtimeRefreshInterval = null;

function startRealtimeDataRefresh() {
    console.log('🔄 Starting real-time data refresh (every 15 minutes)...\n');
    
    // Refresh every 15 minutes
    realtimeRefreshInterval = setInterval(async () => {
        try {
            console.log(`\n🔄 [${new Date().toISOString()}] Refreshing real-time data...`);
            
            // Fetch last 2 days of fresh data
            const freshData = await entsoeDataManager.fetchLiveData(2);
            
            if (freshData.length > 0) {
                // Save new data to database
                await dbManager.insertData(freshData);
                console.log(`Saved ${freshData.length} new records to database`);
                
                // Reload all data from database
                dbData = await dbManager.getAllData();
                
                console.log(`Real-time data refreshed`);
                console.log(`Total data points: ${dbData.length}`);
            }
            
            // Fetch new events for the last 2 days from all sources
            console.log('🔄 Checking for new events from all sources...');
            let newEvents = [];
            
            // ENTSO-E events
            if (entsoeClient) {
                const countries = ['PL', 'HU', 'FI', 'FR', 'NL'];
                for (const country of countries) {
                    const events = await entsoeClient.getOutageEvents(country, subDays(new Date(), 2), new Date());
                    newEvents = newEvents.concat(events);
                }
                console.log(`  ENTSO-E: ${newEvents.length} events`);
            }
            
            // RTE events (France)
            try {
                const rteEvents = await RTEClient.getUnavailabilities(subDays(new Date(), 2), new Date());
                newEvents = newEvents.concat(rteEvents);
                console.log(`  RTE: ${rteEvents.length} events`);
            } catch (error) {
                console.log(`  RTE error: ${error.message}`);
            }
            
            // Nord Pool events
            try {
                const nordPoolEvents = await NordPoolClient.getSystemMessages(subDays(new Date(), 2), new Date());
                newEvents = newEvents.concat(nordPoolEvents);
                console.log(`  Nord Pool: ${nordPoolEvents.length} events`);
            } catch (error) {
                console.log(`  Nord Pool error: ${error.message}`);
            }
            
            if (newEvents.length > 0) {
                const insertedCount = await dbManager.insertEvents(newEvents);
                console.log(`✅ Added ${insertedCount} new events to database (total: ${newEvents.length})`);
                
                // Broadcast new events to connected clients
                io.emit('newEvents', newEvents);
            } else {
                console.log('ℹ️  No new events found from any source');
            }
            
        } catch (error) {
            console.error('⚠️  Real-time refresh failed:', error.message);
        }
    }, 15 * 60 * 1000); // 15 minutes
}

// Cleanup on server shutdown
process.on('SIGINT', () => {
    console.log('\n\nShutting down server...');
    stopStreaming();
    stopNewsFeed();
    if (realtimeRefreshInterval) {
        clearInterval(realtimeRefreshInterval);
        console.log('Stopped real-time refresh.');
    }
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Get current data point
function getCurrentDataPoint() {
    if (currentIndex >= dbData.length) {
        currentIndex = 0; // Loop back to beginning
    }
    
    // Skip records with all null values by finding the first record with actual data
    let attempts = 0;
    while (attempts < 100) { // Prevent infinite loop
        const record = dbData[currentIndex];
        
        // Check if this record has some actual data (not all null) - check both new and legacy fields
        if (record.pl_load_actual !== null || 
            record.hu_load_actual !== null || 
            record.fi_load_actual !== null ||
            record.cy_load_actual !== null || 
            record.gb_gbn_load_actual !== null || 
            record.ie_load_actual !== null ||
            record.ie_sem_price_day_ahead !== null) {
            return record;
        }
        
        // Move to next record
        currentIndex++;
        if (currentIndex >= dbData.length) {
            currentIndex = 0;
        }
        attempts++;
    }
    
    // If we can't find a record with data, return the first one anyway
    return dbData[0];
}

// Process and clean data for transmission
function processDataPoint(dataPoint) {
    const processed = {
        timestamp: dataPoint.timestamp,
        cetTimestamp: dataPoint.cet_timestamp || dataPoint.timestamp,
        countries: {},
        dataQuality: parseFloat(dataPoint.data_quality_score) || 100
    };

    // Dynamic country data processing for ENTSO-E data (PL, HU, FI, etc.)
    const countries = ['PL', 'HU', 'FI', 'CY', 'GB', 'IE']; // Support both new and legacy countries
    
    for (const country of countries) {
        const prefix = country.toLowerCase();
        const countryData = {};
        
        // Basic load and forecast
        countryData.load_actual = parseFloat(dataPoint[`${prefix}_load_actual`]) || null;
        countryData.load_forecast = parseFloat(dataPoint[`${prefix}_load_forecast`]) || null;
        countryData.price_day_ahead = parseFloat(dataPoint[`${prefix}_price_day_ahead`]) || null;
        
        // Aggregate all generation types
        let totalWindOnshore = 0;
        let totalWindOffshore = 0;
        let totalSolar = 0;
        let hasWindOnshore = false;
        let hasWindOffshore = false;
        let hasSolar = false;
        
        // Check for generation data
        for (const key in dataPoint) {
            if (key.startsWith(prefix + '_')) {
                const value = parseFloat(dataPoint[key]);
                if (value && key.includes('_generation')) {
                    countryData[key.replace(prefix + '_', '')] = value;
                    
                    // Aggregate renewables
                    if (key.includes('wind_onshore')) {
                        totalWindOnshore += value;
                        hasWindOnshore = true;
                    } else if (key.includes('wind_offshore')) {
                        totalWindOffshore += value;
                        hasWindOffshore = true;
                    } else if (key.includes('solar')) {
                        totalSolar += value;
                        hasSolar = true;
                    }
                }
            }
        }
        
        // Dashboard compatibility fields
        countryData.wind_generation = (hasWindOnshore || hasWindOffshore) ? 
            (totalWindOnshore + totalWindOffshore) : null;
        countryData.wind_onshore = hasWindOnshore ? totalWindOnshore : null;
        countryData.wind_offshore = hasWindOffshore ? totalWindOffshore : null;
        countryData.solar_generation = hasSolar ? totalSolar : null;
        
        processed.countries[country] = countryData;
    }

    // Legacy Cyprus data (for backward compatibility with CSV)
    if (dataPoint.cy_load_actual) {
        processed.countries.CY = {
            load_actual: parseFloat(dataPoint.cy_load_actual) || null,
            load_forecast: parseFloat(dataPoint.cy_load_forecast) || null,
            wind_onshore: parseFloat(dataPoint.cy_wind_onshore_generation) || null,
            wind_generation: parseFloat(dataPoint.cy_wind_onshore_generation) || null,
            solar_generation: null,
            price_day_ahead: null
        };
    }

    // Legacy Great Britain regions (for backward compatibility with CSV)
    if (dataPoint.gb_gbn_load_actual) {
        processed.countries.GB = {
            // GBN region
            gbn_load_actual: parseFloat(dataPoint.gb_gbn_load_actual) || null,
            gbn_load_forecast: parseFloat(dataPoint.gb_gbn_load_forecast) || null,
            gbn_solar: parseFloat(dataPoint.gb_gbn_solar_generation) || null,
            gbn_wind: parseFloat(dataPoint.gb_gbn_wind_generation) || null,
            gbn_wind_offshore: parseFloat(dataPoint.gb_gbn_wind_offshore_generation) || null,
            gbn_wind_onshore: parseFloat(dataPoint.gb_gbn_wind_onshore_generation) || null,
            
            // NIR region
            nir_load_actual: parseFloat(dataPoint.gb_nir_load_actual) || null,
            nir_load_forecast: parseFloat(dataPoint.gb_nir_load_forecast) || null,
            nir_wind_onshore: parseFloat(dataPoint.gb_nir_wind_onshore_generation) || null,
            
            // UKM region
            ukm_load_actual: parseFloat(dataPoint.gb_ukm_load_actual) || null,
            ukm_load_forecast: parseFloat(dataPoint.gb_ukm_load_forecast) || null,
            ukm_solar: parseFloat(dataPoint.gb_ukm_solar_generation) || null,
            ukm_wind: parseFloat(dataPoint.gb_ukm_wind_generation) || null,
            ukm_wind_offshore: parseFloat(dataPoint.gb_ukm_wind_offshore_generation) || null,
            ukm_wind_onshore: parseFloat(dataPoint.gb_ukm_wind_onshore_generation) || null
        };
        
        // Calculate GB totals
        processed.countries.GB.total_load = (processed.countries.GB.gbn_load_actual || 0) + 
                                            (processed.countries.GB.nir_load_actual || 0) + 
                                            (processed.countries.GB.ukm_load_actual || 0);
        processed.countries.GB.total_wind = (processed.countries.GB.gbn_wind_onshore || 0) + 
                                            (processed.countries.GB.gbn_wind_offshore || 0) + 
                                            (processed.countries.GB.nir_wind_onshore || 0) + 
                                            (processed.countries.GB.ukm_wind_onshore || 0) + 
                                            (processed.countries.GB.ukm_wind_offshore || 0);
        processed.countries.GB.total_solar = (processed.countries.GB.gbn_solar || 0) + 
                                             (processed.countries.GB.ukm_solar || 0);

        // Dashboard compatibility fields for GB
        processed.countries.GB.wind_generation = processed.countries.GB.total_wind;
        processed.countries.GB.solar_generation = processed.countries.GB.total_solar;
        processed.countries.GB.price_day_ahead = null;
    }

    // Legacy Ireland data (for backward compatibility with CSV)
    if (dataPoint.ie_load_actual) {
        processed.countries.IE = {
            load_actual: parseFloat(dataPoint.ie_load_actual) || null,
            load_forecast: parseFloat(dataPoint.ie_load_forecast) || null,
            wind_onshore: parseFloat(dataPoint.ie_wind_onshore_generation) || null,
            
            // SEM market data
            sem_load_actual: parseFloat(dataPoint.ie_sem_load_actual) || null,
            sem_load_forecast: parseFloat(dataPoint.ie_sem_load_forecast) || null,
            sem_price_day_ahead: parseFloat(dataPoint.ie_sem_price_day_ahead) || null,
            sem_wind_onshore: parseFloat(dataPoint.ie_sem_wind_onshore_generation) || null
        };
        
        // Calculate IE totals
        processed.countries.IE.total_load = (processed.countries.IE.load_actual || 0) + 
                                            (processed.countries.IE.sem_load_actual || 0);
        processed.countries.IE.total_wind = (processed.countries.IE.wind_onshore || 0) + 
                                            (processed.countries.IE.sem_wind_onshore || 0);

        // Dashboard compatibility fields for IE
        processed.countries.IE.wind_generation = processed.countries.IE.total_wind;
        processed.countries.IE.solar_generation = null;
        processed.countries.IE.price_day_ahead = processed.countries.IE.sem_price_day_ahead;
    }

    return processed;
}

// Start streaming data from database (progressive visualization)
function startStreaming(intervalMs = 2000) {
    if (isStreaming) return;
    
    isStreaming = true;
    currentIndex = 0; // Reset to start
    console.log(`Starting progressive database streaming with ${intervalMs}ms interval`);
    
    streamingInterval = setInterval(async () => {
        try {
            // Get current total record count
            const countResult = await dbManager.pool.query('SELECT COUNT(*) FROM energy_data');
            const totalRecords = parseInt(countResult.rows[0].count);
            
            // Query records with offset for progression
            const query = `
                SELECT * FROM energy_data 
                ORDER BY timestamp ASC 
                LIMIT 1 OFFSET $1
            `;
            
            const result = await dbManager.pool.query(query, [currentIndex]);
            if (result.rows.length === 0) {
                // If we've reached the end, loop back to start
                currentIndex = 0;
                return;
            }
            
            // Get the current record
            const currentRecord = result.rows[0];
            const processedData = processDataPoint(currentRecord);
            
            // Add to historical buffer for analytics
            historicalDataBuffer.push(processedData);
            if (historicalDataBuffer.length > 200) {
                historicalDataBuffer.shift();
            }
            
            // Enhanced data payload with progress tracking
            const enhancedData = {
                ...processedData,
                index: currentIndex,
                total: totalRecords,
                progress: totalRecords > 0 ? ((currentIndex / totalRecords) * 100).toFixed(2) : 0,
                recordCount: totalRecords,
                isProgressive: true,
                lastUpdated: new Date().toISOString()
            };
            
            // Emit to all connected clients
            io.emit('energyData', enhancedData);
            
            // Periodically send news and insights
            if (currentIndex % 15 === 0 && newsCache.length > 0) { // Every 15 data points
                const news = newsCache[Math.floor(Math.random() * newsCache.length)];
                io.emit('marketNews', news);
            }
            // Note: AI insights are now on-demand only (removed automatic generation)
            
            currentIndex++;
            
            // Debug: Log renewable and price data for troubleshooting
            if (currentIndex % 10 === 0) { // Every 10th record
                console.log(`\n🔍 DEBUG Record ${currentIndex}:`);
                console.log(`  PL data:`, {
                    load: processedData.countries.PL?.load_actual,
                    price: processedData.countries.PL?.price_day_ahead,
                    wind: processedData.countries.PL?.wind_generation,
                    solar: processedData.countries.PL?.solar_generation
                });
                console.log(`  HU data:`, {
                    load: processedData.countries.HU?.load_actual,
                    price: processedData.countries.HU?.price_day_ahead
                });
                console.log(`  FI data:`, {
                    load: processedData.countries.FI?.load_actual,
                    price: processedData.countries.FI?.price_day_ahead
                });
                console.log(`  Timestamp:`, processedData.timestamp);
            }
            
            // Debug next few records to see dashboard compatibility fields
            if (currentIndex >= 813 && currentIndex <= 820) {
                console.log(`\n🔍 RECORD ${currentIndex} DEBUG:`);
                console.log('CY wind_generation:', processedData.countries.CY?.wind_generation);
                console.log('GB wind_generation:', processedData.countries.GB?.wind_generation);
                console.log('GB solar_generation:', processedData.countries.GB?.solar_generation);
                console.log('IE wind_generation:', processedData.countries.IE?.wind_generation);
                console.log('IE price_day_ahead:', processedData.countries.IE?.price_day_ahead);
                console.log('Enhanced data being sent to dashboard...\n');
            }
            
            console.log(`Streamed record ${currentIndex}/${totalRecords} | ${processedData.timestamp} | DB size: ${totalRecords}`);
            
        } catch (error) {
            console.error('Error in progressive streaming:', error);
        }
        
    }, intervalMs);
}

// Stop streaming data
function stopStreaming() {
    if (!isStreaming) return;
    
    isStreaming = false;
    if (streamingInterval) {
        clearInterval(streamingInterval);
        streamingInterval = null;
    }
    console.log('Data streaming stopped');
}

// Socket.IO connection handling - Simplified (no streaming, data fetched via API)
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Send current status to new client
    socket.emit('status', {
        dataSource,
        totalRecords: dbData.length
    });
    
    // Handle real-time news updates
    socket.on('requestNews', () => {
        if (newsCache.length > 0) {
            socket.emit('newsUpdate', newsCache);
        }
    });
    
    // Handle AI insight requests
    socket.on('askInsight', async (data) => {
        console.log(`📝 AI Insight requested: "${data.question}"`);
        
        try {
            let answer;
            
            // Try to get AI-generated answer
            if (aiInsightsService && aiInsightsService.isEnabled) {
                answer = await aiInsightsService.generateInsight(data.question);
            } else {
                // Fallback to predefined answer if AI is not available
                answer = aiInsightsService 
                    ? aiInsightsService.getFallbackAnswer(data.question)
                    : "AI service is currently unavailable. Please try again later.";
            }
            
            const insight = {
                question: data.question,
                answer: answer
            };
            
            // Send response back to the requesting client
            socket.emit('traderInsight', insight);
            
        } catch (error) {
            console.error('Error generating insight:', error);
            socket.emit('traderInsight', {
                question: data.question,
                answer: "Sorry, I encountered an error processing your question. Please try again."
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        isStreaming,
        currentIndex,
        totalRecords: dbData.length,
        selectedDataset,
        dataSource,
        progress: dbData.length > 0 ? ((currentIndex / dbData.length) * 100).toFixed(2) : 0
    });
});

app.get('/api/datasets', (req, res) => {
    const datasets = [
        { name: '15 minute intervals', filename: 'time_series_15min_singleindex.csv' },
        { name: '30 minute intervals', filename: 'time_series_30min_singleindex.csv' },
        { name: '60 minute intervals', filename: 'time_series_60min_singleindex.csv' }
    ];
    res.json(datasets);
});

app.get('/api/analytics/volatility/:country', (req, res) => {
    const { country } = req.params;
    const windowSize = parseInt(req.query.window) || 20;
    const volatility = dataProcessor.calculatePriceVolatility(country, windowSize);
    res.json(volatility);
});

app.get('/api/analytics/forecast-accuracy/:country', (req, res) => {
    const { country } = req.params;
    const windowSize = parseInt(req.query.window) || 20;
    const accuracy = dataProcessor.calculateForecastAccuracy(country, windowSize);
    res.json(accuracy);
});

app.get('/api/analytics/renewable-penetration/:country', (req, res) => {
    const { country } = req.params;
    const windowSize = parseInt(req.query.window) || 20;
    const penetration = dataProcessor.calculateRenewablePenetration(country, windowSize);
    res.json(penetration);
});

app.get('/api/analytics/anomalies/:country/:metric', (req, res) => {
    const { country, metric } = req.params;
    const threshold = parseFloat(req.query.threshold) || 2.5;
    const anomalies = dataProcessor.detectAnomalies(country, metric, threshold);
    res.json(anomalies);
});

app.get('/api/analytics/correlation', (req, res) => {
    const { country1, metric1, country2, metric2 } = req.query;
    if (!country1 || !metric1 || !country2 || !metric2) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }
    const correlation = dataProcessor.calculateCorrelation(country1, metric1, country2, metric2);
    res.json({ correlation });
});

app.get('/api/analytics/market-summary', (req, res) => {
    const summary = dataProcessor.generateMarketSummary();
    res.json(summary);
});

app.get('/api/news/test', async (req, res) => {
    try {
        await fetchAllNews();
        res.json({
            success: true,
            newsCount: newsCache.length,
            news: newsCache
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Test ENTSO-E API specifically
app.get('/api/entsoe/test', async (req, res) => {
    try {
        const entsoeNews = await fetchEntsoeNews();
        res.json({
            success: true,
            hasApiKey: !!ENTSOE_API_KEY,
            outageCount: entsoeNews.length,
            outages: entsoeNews
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            hasApiKey: !!ENTSOE_API_KEY
        });
    }
});

// Get current data source information
app.get('/api/data/source', (req, res) => {
    const info = {
        source: dataSource,
        dataPoints: dbData.length,
        currentIndex: currentIndex
    };

    if (dataSource === 'entsoe-live' && entsoeDataManager) {
        info.cacheInfo = entsoeDataManager.getCacheInfo();
        info.needsRefresh = entsoeDataManager.needsRefresh();
    }

    res.json(info);
});

// Refresh ENTSO-E data
app.post('/api/data/refresh', async (req, res) => {
    if (!entsoeDataManager) {
        return res.json({
            success: false,
            error: 'ENTSO-E API key not configured'
        });
    }

    try {
        const daysBack = parseInt(req.query.days) || 7;
        const historical = req.query.historical === 'true';
        
        console.log(`\n🔄 Manual ${historical ? 'historical' : 'live'} data refresh requested (${daysBack} days)...`);
        
        if (historical) {
            dbData = await entsoeDataManager.fetchHistoricalData(daysBack);
            dataSource = 'entsoe-historical';
        } else {
            dbData = await entsoeDataManager.fetchLiveData(daysBack);
            dataSource = 'entsoe-live';
        }
        
        currentIndex = 0;
        
        res.json({
            success: true,
            message: `${historical ? 'Historical' : 'Live'} data refreshed successfully`,
            dataPoints: dbData.length,
            cacheInfo: entsoeDataManager.getCacheInfo()
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Get filtered data by period - Query database directly
app.get('/api/data/period', async (req, res) => {
    try {
        const period = req.query.period || 'last-week';
        
        // Calculate cutoff date based on period
        const now = new Date();
        let cutoffDate;
        
        switch(period) {
            case 'today':
            case 'last-24-hours':
                cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case 'yesterday':
                // Yesterday: from start of yesterday to start of today
                const startOfToday = new Date(now);
                startOfToday.setHours(0, 0, 0, 0);
                cutoffDate = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
                break;
            case 'last-48-hours':
                cutoffDate = new Date(now.getTime() - 48 * 60 * 60 * 1000);
                break;
            case 'last-7-days':
            case 'last-week':
                cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'last-30-days':
            case 'last-month':
                cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'last-90-days':
                cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case 'last-6-months':
                cutoffDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
                break;
            case 'last-year':
                cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            default:
                cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
        
        // Determine aggregation interval based on period
        let aggregationInterval = '15 minutes'; // default
        let shouldAggregate = false;
        
        if (period === 'last-24-hours' || period === 'yesterday' || period === 'last-48-hours') {
            // Keep raw 15-min data for short periods
            aggregationInterval = '15 minutes';
            shouldAggregate = false;
        } else if (period === 'last-7-days' || period === 'last-week') {
            // Hourly aggregation for weekly view
            aggregationInterval = '1 hour';
            shouldAggregate = true;
        } else if (period === 'last-30-days' || period === 'last-month') {
            // 4-hour aggregation for monthly view
            aggregationInterval = '4 hours';
            shouldAggregate = true;
        } else if (period === 'last-90-days') {
            // Daily aggregation for 3-month view
            aggregationInterval = '1 day';
            shouldAggregate = true;
        } else if (period === 'last-6-months' || period === 'last-year') {
            // Daily aggregation for long-term view
            aggregationInterval = '1 day';
            shouldAggregate = true;
        }
        
        let rawData, processedData;
        
        if (shouldAggregate) {
            // Use PostgreSQL time_bucket for efficient aggregation
            const query = `
                SELECT 
                    time_bucket($1::interval, timestamp) AS timestamp,
                    AVG(pl_load_actual) as pl_load_actual,
                    AVG(pl_load_forecast) as pl_load_forecast,
                    AVG(pl_price_day_ahead) as pl_price_day_ahead,
                    AVG(pl_wind_onshore_generation) as pl_wind_onshore_generation,
                    AVG(pl_wind_offshore_generation) as pl_wind_offshore_generation,
                    AVG(pl_solar_generation) as pl_solar_generation,
                    AVG(hu_load_actual) as hu_load_actual,
                    AVG(hu_load_forecast) as hu_load_forecast,
                    AVG(hu_price_day_ahead) as hu_price_day_ahead,
                    AVG(hu_wind_onshore_generation) as hu_wind_onshore_generation,
                    AVG(hu_wind_offshore_generation) as hu_wind_offshore_generation,
                    AVG(hu_solar_generation) as hu_solar_generation,
                    AVG(fi_load_actual) as fi_load_actual,
                    AVG(fi_load_forecast) as fi_load_forecast,
                    AVG(fi_price_day_ahead) as fi_price_day_ahead,
                    AVG(fi_wind_onshore_generation) as fi_wind_onshore_generation,
                    AVG(fi_wind_offshore_generation) as fi_wind_offshore_generation,
                    AVG(fi_solar_generation) as fi_solar_generation
                FROM energy_data
                WHERE timestamp >= $2
                GROUP BY time_bucket($1::interval, timestamp)
                ORDER BY timestamp ASC
            `;
            
            const result = await dbManager.pool.query(query, [aggregationInterval, cutoffDate.toISOString()]);
            rawData = result.rows;
        } else {
            // Query raw data without aggregation
            const query = `
                SELECT * FROM energy_data
                WHERE timestamp >= $1
                ORDER BY timestamp ASC
            `;
            
            const result = await dbManager.pool.query(query, [cutoffDate.toISOString()]);
            rawData = result.rows;
        }
        
        // Process each data point
        processedData = rawData.map(point => processDataPoint(point));
        
        // Fetch events for the same period
        const events = await dbManager.getEventsInRange(
            cutoffDate.toISOString(),
            now.toISOString(),
            ['PL', 'HU', 'FI']
        );
        
        res.json({
            success: true,
            period: period,
            dataPoints: processedData.length,
            eventCount: events.length,
            cutoffDate: cutoffDate.toISOString(),
            aggregation: shouldAggregate ? aggregationInterval : 'none',
            data: processedData,
            events: events
        });
    } catch (error) {
        console.error('Error querying period data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Fetch and store events from ENTSO-E
app.post('/api/events/refresh', async (req, res) => {
    if (!entsoeClient) {
        return res.json({
            success: false,
            error: 'ENTSO-E API key not configured'
        });
    }

    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = subDays(new Date(), days);
        const endDate = new Date();
        
        console.log(`\n📅 Fetching events for PL, HU, FI (last ${days} days)...`);
        
        const countries = ['PL', 'HU', 'FI'];
        let allEvents = [];
        
        for (const country of countries) {
            const events = await entsoeClient.getOutageEvents(country, startDate, endDate);
            allEvents = allEvents.concat(events);
            console.log(`  ${country}: ${events.length} events found`);
        }
        
        if (allEvents.length > 0) {
            const insertedCount = await dbManager.insertEvents(allEvents);
            console.log(`✅ Inserted ${insertedCount} new events into database\n`);
            
            res.json({
                success: true,
                message: `Fetched ${allEvents.length} events, inserted ${insertedCount} new events`,
                totalEvents: allEvents.length,
                insertedEvents: insertedCount
            });
        } else {
            res.json({
                success: true,
                message: 'No events found',
                totalEvents: 0,
                insertedEvents: 0
            });
        }
    } catch (error) {
        console.error('Error refreshing events:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get events for a specific period
app.get('/api/events', async (req, res) => {
    try {
        const period = req.query.period || 'last-30-days';
        const countries = req.query.countries ? req.query.countries.split(',') : ['PL', 'HU', 'FI'];
        
        const now = new Date();
        let cutoffDate;
        
        switch(period) {
            case 'last-24-hours':
                cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case 'last-7-days':
                cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'last-30-days':
                cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case 'last-90-days':
                cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            default:
                cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        
        const events = await dbManager.getEventsInRange(
            cutoffDate.toISOString(),
            now.toISOString(),
            countries
        );
        
        res.json({
            success: true,
            period: period,
            eventCount: events.length,
            cutoffDate: cutoffDate.toISOString(),
            events: events
        });
    } catch (error) {
        console.error('Error querying events:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper functions for analytics
function getVolatilityMetrics() {
    const countries = ['DE', 'AT', 'BE', 'NL', 'HU'];
    const volatilityData = {};
    
    countries.forEach(country => {
        volatilityData[country] = dataProcessor.calculatePriceVolatility(country, 20);
    });
    
    return volatilityData;
}

function getForecastAccuracyMetrics() {
    const countries = ['DE', 'AT', 'BE', 'NL', 'HU'];
    const accuracyData = {};
    
    countries.forEach(country => {
        accuracyData[country] = dataProcessor.calculateForecastAccuracy(country, 20);
    });
    
    return accuracyData;
}

let newsFeedInterval = null;

// Start the news feed (combined Energy News + ENTSO-E)
async function startNewsFeed() {
    console.log('Starting live news feed (Energy News + ENTSO-E)...');
    
    // Fetch initial news
    await fetchAllNews();
    
    // Send initial news if clients are connected
    if (newsCache.length > 0 && io.sockets.sockets.size > 0) {
        const randomNews = newsCache[Math.floor(Math.random() * newsCache.length)];
        io.emit('marketNews', randomNews);
    }
    
    // Set up intervals
    newsFeedInterval = setInterval(async () => {
        if (io.sockets.sockets.size > 0) {
            // Refresh news cache every 15 minutes
            const timeSinceLastFetch = Date.now() - (lastReutersFetch || 0);
            if (timeSinceLastFetch > 15 * 60 * 1000) {
                await fetchAllNews();
            }
            
            // Send a random news item from cache
            if (newsCache.length > 0) {
                const randomNews = newsCache[Math.floor(Math.random() * newsCache.length)];
                io.emit('marketNews', randomNews);
                console.log('Sent news:', randomNews.headline);
            }
            
            // Note: AI insights are now on-demand only (user-triggered)
        }
    }, 10000); // Send every 10 seconds
}

function stopNewsFeed() {
    if (newsFeedInterval) {
        clearInterval(newsFeedInterval);
        newsFeedInterval = null;
        console.log('Stopped news feed.');
    }
}

// Generate and emit AI-powered trader insights
async function generateAndEmitInsight() {
    try {
        // Select a random question
        const randomQuestion = traderInsights[Math.floor(Math.random() * traderInsights.length)];
        
        let answer;
        
        // Try to get AI-generated answer
        if (aiInsightsService && aiInsightsService.isEnabled) {
            answer = await aiInsightsService.generateInsight(randomQuestion.question);
        } else {
            // Fallback to predefined answers if AI is not available
            answer = randomQuestion.answer;
        }
        
        const insight = {
            question: randomQuestion.question,
            answer: answer
        };
        
        io.emit('traderInsight', insight);
        
    } catch (error) {
        console.error('Error generating trader insight:', error);
        // Fallback to random static insight
        const fallback = traderInsights[Math.floor(Math.random() * traderInsights.length)];
        io.emit('traderInsight', fallback);
    }
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Energy Trading Dashboard server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the dashboard`);
    console.log(`External access: http://[YOUR-IP]:${PORT}`);
    
    // Initialize data and start news feed
    initializeData();
    startNewsFeed();
});

// Graceful shutdown (already defined above with realtimeRefreshInterval cleanup)
