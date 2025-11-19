const axios = require('axios');
const https = require('https');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

// ENTSO-E API configuration
const API_BASE_URL = 'https://web-api.tp.entsoe.eu/api';

// Create HTTPS agent that ignores SSL certificate errors
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Bidding zones for countries with best data availability (verified via testing)
const BIDDING_ZONES = {
    'PL': '10YPL-AREA-----S', // Poland - Highest data availability
    'HU': '10YHU-MAVIR----U', // Hungary - Excellent data quality
    'FI': '10YFI-1--------U', // Finland - Complete Nordic data
    'SE': '10YSE-1--------K', // Sweden - Nordic region
    'DE': '10Y1001A1001A83F'  // Germany - Major European market
};

class EntsoeClient {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('ENTSO-E API key is required.');
        }
        this.apiKey = apiKey;
    }

    /**
     * Fetches unplanned outages for generation units in a specific country.
     * These are often significant market-moving events.
     * @param {string} countryCode - The two-letter country code (e.g., 'GB', 'IE').
     * @returns {Promise<Array>} - A promise that resolves to an array of formatted news headlines.
     */
    async getUnplannedOutages(countryCode) {
        const biddingZone = BIDDING_ZONES[countryCode];
        if (!biddingZone) {
            console.warn(`No bidding zone found for country: ${countryCode}`);
            return [];
        }

        // Define the time window: from 7 days ago to tomorrow (wider window to catch more events)
        const now = new Date();
        const startDate = format(startOfDay(subDays(now, 7)), 'yyyyMMddHHmm');
        const endDate = format(endOfDay(subDays(now, -1)), 'yyyyMMddHHmm');

        const params = {
            securityToken: this.apiKey,
            documentType: 'A80', // Unavailability of generation units
            businessType: 'A53', // Unplanned outages
            biddingZone_Domain: biddingZone,
            periodStart: startDate,
            periodEnd: endDate,
        };

        try {
            console.log(`Fetching ENTSO-E outages for ${countryCode} (${startDate} to ${endDate})...`);
            const response = await axios.get(API_BASE_URL, { 
                params,
                httpsAgent // Use custom HTTPS agent to bypass SSL verification
            });
            
            console.log(`ENTSO-E ${countryCode} response received, length: ${response.data.length} bytes`);

            // The ENTSO-E API returns XML, so we need to parse it.
            // For simplicity, we'll use string matching. A robust solution would use an XML parser.
            const xmlData = response.data;
            return this.parseAndFormatOutages(xmlData, countryCode);

        } catch (error) {
            if (error.response) {
                console.error(`ENTSO-E API Error for ${countryCode}: ${error.response.status} - ${error.response.data}`);
            } else {
                console.error(`Error fetching ENTSO-E data for ${countryCode}:`, error.message);
            }
            return [];
        }
    }

    /**
     * A simple parser to extract key information from the ENTSO-E XML response.
     * @param {string} xmlData - The XML response from the API.
     * @param {string} countryCode - The country code for context.
     * @returns {Array} - An array of formatted news headlines.
     */
    parseAndFormatOutages(xmlData, countryCode) {
        const headlines = [];
        
        // Check if we got an acknowledgment (no data) or actual data
        if (xmlData.includes('Acknowledgement_MarketDocument')) {
            console.log(`ENTSO-E ${countryCode}: No unavailability data found (empty response)`);
            return headlines;
        }
        
        const outageMatches = xmlData.matchAll(/<unavailability_Time_Series>(.*?)<\/unavailability_Time_Series>/gs);
        let seriesCount = 0;

        for (const match of outageMatches) {
            seriesCount++;
            const series = match[1];
            
            const businessTypeMatch = series.match(/<businessType>(A\d+)<\/businessType>/); // Capture any business type
            const quantityMatch = series.match(/<quantity>(\d+\.\d+)<\/quantity>/);
            const unitNameMatch = series.match(/<name>(.*?)<\/name>/);

            if (quantityMatch && unitNameMatch) {
                const powerLost = Math.round(parseFloat(quantityMatch[1]));
                const unitName = unitNameMatch[1];
                const businessType = businessTypeMatch ? businessTypeMatch[1] : 'Unknown';

                if (powerLost > 100) { // Only report significant outages (>100 MW)
                    const outageType = businessType === 'A53' ? 'UNPLANNED' : 'PLANNED';
                    const headline = `${outageType} OUTAGE in ${countryCode}: ${unitName} offline, ${powerLost} MW capacity lost.`;
                    headlines.push({ headline });
                }
            }
        }
        
        console.log(`ENTSO-E ${countryCode}: Found ${seriesCount} time series, ${headlines.length} significant outages (>100 MW)`);

        return headlines;
    }

    /**
     * Fetch actual load data (consumption) for a country
     * @param {string} countryCode - The two-letter country code
     * @param {Date} startDate - Start date for data
     * @param {Date} endDate - End date for data
     * @returns {Promise<Array>} - Array of {timestamp, value} objects
     */
    async getActualLoad(countryCode, startDate, endDate) {
        const biddingZone = BIDDING_ZONES[countryCode];
        if (!biddingZone) return [];

        const params = {
            securityToken: this.apiKey,
            documentType: 'A65', // Actual load
            processType: 'A16', // Realised
            outBiddingZone_Domain: biddingZone,
            periodStart: format(startDate, 'yyyyMMddHHmm'),
            periodEnd: format(endDate, 'yyyyMMddHHmm'),
        };

        try {
            const response = await axios.get(API_BASE_URL, { params, httpsAgent });
            return this.parseTimeSeries(response.data);
        } catch (error) {
            console.error(`Error fetching actual load for ${countryCode}:`, error.message);
            return [];
        }
    }

    /**
     * Fetch day-ahead load forecast
     * @param {string} countryCode - The two-letter country code
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Array>} - Array of {timestamp, value} objects
     */
    async getLoadForecast(countryCode, startDate, endDate) {
        const biddingZone = BIDDING_ZONES[countryCode];
        if (!biddingZone) return [];

        const params = {
            securityToken: this.apiKey,
            documentType: 'A65', // Load forecast
            processType: 'A01', // Day ahead
            outBiddingZone_Domain: biddingZone,
            periodStart: format(startDate, 'yyyyMMddHHmm'),
            periodEnd: format(endDate, 'yyyyMMddHHmm'),
        };

        try {
            const response = await axios.get(API_BASE_URL, { params, httpsAgent });
            return this.parseTimeSeries(response.data);
        } catch (error) {
            console.error(`Error fetching load forecast for ${countryCode}:`, error.message);
            return [];
        }
    }

    /**
     * Fetch actual generation per type (wind, solar, etc.)
     * @param {string} countryCode - The two-letter country code
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Object>} - Object with generation by type
     */
    async getGenerationByType(countryCode, startDate, endDate) {
        const biddingZone = BIDDING_ZONES[countryCode];
        if (!biddingZone) return {};

        const params = {
            securityToken: this.apiKey,
            documentType: 'A75', // Actual generation per type
            processType: 'A16', // Realised
            in_Domain: biddingZone,
            periodStart: format(startDate, 'yyyyMMddHHmm'),
            periodEnd: format(endDate, 'yyyyMMddHHmm'),
        };

        try {
            const response = await axios.get(API_BASE_URL, { params, httpsAgent });
            return this.parseGenerationByType(response.data);
        } catch (error) {
            console.error(`Error fetching generation for ${countryCode}:`, error.message);
            return {};
        }
    }

    /**
     * Fetch day-ahead prices
     * @param {string} countryCode - The two-letter country code
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Array>} - Array of {timestamp, price} objects
     */
    async getDayAheadPrices(countryCode, startDate, endDate) {
        const biddingZone = BIDDING_ZONES[countryCode];
        if (!biddingZone) return [];

        const params = {
            securityToken: this.apiKey,
            documentType: 'A44', // Price document
            in_Domain: biddingZone,
            out_Domain: biddingZone,
            periodStart: format(startDate, 'yyyyMMddHHmm'),
            periodEnd: format(endDate, 'yyyyMMddHHmm'),
        };

        try {
            const response = await axios.get(API_BASE_URL, { params, httpsAgent });
            return this.parseTimeSeries(response.data, 'price.amount');
        } catch (error) {
            console.error(`Error fetching prices for ${countryCode}:`, error.message);
            return [];
        }
    }

    /**
     * Parse time series XML data
     * @param {string} xmlData - XML response
     * @param {string} valueTag - Tag name for the value (default: 'quantity')
     * @returns {Array} - Array of {timestamp, value} objects
     */
    parseTimeSeries(xmlData, valueTag = 'quantity') {
        const dataPoints = [];
        
        if (xmlData.includes('Acknowledgement_MarketDocument')) {
            return dataPoints;
        }

        // Extract time series - note that EN TSO-E uses both <TimeSeries> and <time_Series>
        let seriesMatches = xmlData.matchAll(/<TimeSeries>(.*?)<\/TimeSeries>/gs);
        let seriesArray = [...seriesMatches];
        
        if (seriesArray.length === 0) {
            // Try alternative casing
            seriesMatches = xmlData.matchAll(/<time_Series>(.*?)<\/time_Series>/gs);
            seriesArray = [...seriesMatches];
        }
        
        for (const seriesMatch of seriesArray) {
            const series = seriesMatch[1];
            
            // Extract resolution (PT15M = 15 min, PT30M = 30 min, PT60M = 60 min)
            const resolutionMatch = series.match(/<resolution>(PT\d+M)<\/resolution>/);
            const resolution = resolutionMatch ? resolutionMatch[1] : 'PT60M';
            
            // Extract period start time
            const startMatch = series.match(/<start>([\d-T:Z+]+)<\/start>/);
            if (!startMatch) continue;
            
            const periodStart = new Date(startMatch[1]);
            
            // Extract points - try both Point and point
            let pointRegex = new RegExp(`<Point>.*?<position>(\\d+)<\/position>.*?<${valueTag}>([\\d.]+)<\/${valueTag}>.*?<\/Point>`, 'gs');
            let pointMatches = [...series.matchAll(pointRegex)];
            
            if (pointMatches.length === 0) {
                pointRegex = new RegExp(`<point>.*?<position>(\\d+)<\/position>.*?<${valueTag}>([\\d.]+)<\/${valueTag}>.*?<\/point>`, 'gs');
                pointMatches = [...series.matchAll(pointRegex)];
            }
            
            for (const pointMatch of pointMatches) {
                const position = parseInt(pointMatch[1]);
                const value = parseFloat(pointMatch[2]);
                
                // Calculate timestamp based on position and resolution
                const minutes = this.resolutionToMinutes(resolution) * (position - 1);
                const timestamp = new Date(periodStart.getTime() + minutes * 60000);
                
                dataPoints.push({ timestamp, value });
            }
        }
        
        return dataPoints.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Parse generation by type XML data
     * @param {string} xmlData - XML response
     * @returns {Object} - Object with arrays of data per generation type
     */
    parseGenerationByType(xmlData) {
        const generation = {};
        
        if (xmlData.includes('Acknowledgement_MarketDocument')) {
            return generation;
        }

        const seriesMatches = xmlData.matchAll(/<TimeSeries>(.*?)<\/TimeSeries>/gs);
        
        for (const seriesMatch of seriesMatches) {
            const series = seriesMatch[1];
            
            // Extract production type (B01=Biomass, B02=Fossil Brown coal, B10=Wind Onshore, B11=Wind Offshore, B16=Solar, etc.)
            const psrTypeMatch = series.match(/<psrType>(B\d+)<\/psrType>/);
            if (!psrTypeMatch) continue;
            
            const psrType = this.getPsrTypeName(psrTypeMatch[1]);
            
            // Parse time series data
            const data = this.parseTimeSeries(`<TimeSeries>${series}</TimeSeries>`);
            
            if (data.length > 0) {
                if (!generation[psrType]) {
                    generation[psrType] = [];
                }
                generation[psrType].push(...data);
            }
        }
        
        return generation;
    }

    /**
     * Convert resolution string to minutes
     * @param {string} resolution - Resolution string (e.g., 'PT15M', 'PT30M', 'PT60M')
     * @returns {number} - Minutes
     */
    resolutionToMinutes(resolution) {
        const match = resolution.match(/PT(\d+)M/);
        return match ? parseInt(match[1]) : 60;
    }

    /**
     * Convert PSR type code to readable name
     * @param {string} code - PSR type code
     * @returns {string} - Readable name
     */
    getPsrTypeName(code) {
        const types = {
            'B01': 'Biomass',
            'B02': 'Fossil Brown coal',
            'B03': 'Fossil Coal-derived gas',
            'B04': 'Fossil Gas',
            'B05': 'Fossil Hard coal',
            'B06': 'Fossil Oil',
            'B09': 'Geothermal',
            'B10': 'Wind Onshore',
            'B11': 'Wind Offshore',
            'B12': 'Hydro Pumped Storage',
            'B13': 'Hydro Run-of-river',
            'B14': 'Hydro Water Reservoir',
            'B15': 'Marine',
            'B16': 'Solar',
            'B17': 'Nuclear',
            'B18': 'Other renewable',
            'B19': 'Waste'
        };
        return types[code] || code;
    }
}

module.exports = EntsoeClient;
