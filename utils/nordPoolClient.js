/**
 * Nord Pool API Client
 * For fetching Nordic market events and system messages
 * API Documentation: https://www.nordpoolgroup.com/
 */

const axios = require('axios');
const https = require('https');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

// Nord Pool API endpoints
const NORD_POOL_API_BASE = 'https://dataportal-api.nordpoolgroup.com/api';
const NORD_POOL_MESSAGES_URL = `${NORD_POOL_API_BASE}/SystemMessage`;
const NORD_POOL_CAPACITY_URL = `${NORD_POOL_API_BASE}/TransmissionCapacity`;

// Create axios instance with timeout
const axiosInstance = axios.create({
    timeout: 30000,
    httpsAgent: new https.Agent({
        rejectUnauthorized: true
    })
});

class NordPoolClient {
    constructor() {
        // Nord Pool API might not require authentication for basic data
        this.apiKey = process.env.NORD_POOL_API_KEY || '';
    }

    /**
     * Fetch system messages from Nord Pool
     * These often contain information about outages, maintenance, etc.
     * @param {Date} startDate - Start date for data fetch
     * @param {Date} endDate - End date for data fetch
     * @returns {Promise<Array>} Array of event objects
     */
    async getSystemMessages(startDate, endDate) {
        try {
            const startStr = format(startDate, 'yyyy-MM-dd');
            const endStr = format(endDate, 'yyyy-MM-dd');

            console.log(`Fetching Nord Pool system messages from ${startStr} to ${endStr}`);

            const response = await axiosInstance.get(NORD_POOL_MESSAGES_URL, {
                params: {
                    startDate: startStr,
                    endDate: endStr
                },
                headers: this.apiKey ? {
                    'X-API-Key': this.apiKey
                } : {}
            });

            if (!response.data) {
                console.log('No Nord Pool system messages returned');
                return [];
            }

            const events = this.parseSystemMessages(response.data);
            console.log(`Parsed ${events.length} Nord Pool system message events`);
            return events;

        } catch (error) {
            if (error.response?.status === 404) {
                console.log('Nord Pool system messages endpoint not available');
                return [];
            } else if (error.response?.status === 429) {
                console.error('Nord Pool API rate limit exceeded, waiting...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                return [];
            } else {
                console.error('Error fetching Nord Pool system messages:', error.response?.data || error.message);
                return [];
            }
        }
    }

    /**
     * Parse Nord Pool system messages into standardized event format
     * @param {Array|Object} data - Raw data from Nord Pool API
     * @returns {Array} Parsed events
     */
    parseSystemMessages(data) {
        const events = [];
        const messages = Array.isArray(data) ? data : (data.data || []);

        for (const msg of messages) {
            try {
                const text = `${msg.title || ''} ${msg.message || ''}`.toLowerCase();
                
                // Skip if not relevant
                if (!this.isRelevantMessage(text)) continue;

                // Extract capacity if mentioned
                const capacity = this.extractCapacity(text);
                
                // Determine country
                const country = this.extractCountry(text);
                if (!country) continue; // Skip if no country found

                // Determine event type and category
                const { eventType, category } = this.categorizeMessage(text);

                // Parse dates
                const eventTime = msg.validFrom ? new Date(msg.validFrom) : new Date();
                const eventEndTime = msg.validTo ? new Date(msg.validTo) : null;

                events.push({
                    event_time: eventTime,
                    event_end_time: eventEndTime,
                    country: country,
                    event_type: eventType,
                    event_category: category,
                    title: (msg.title || 'Nord Pool System Message').substring(0, 200),
                    description: (msg.message || text).substring(0, 500),
                    affected_cap: capacity,
                    unit_name: 'Nord Pool Market',
                    source: 'NORDPOOL'
                });

            } catch (error) {
                console.error('Error parsing Nord Pool message:', error.message);
                continue;
            }
        }

        return events;
    }

    /**
     * Check if message is relevant for event tracking
     * @param {string} text - Message text
     * @returns {boolean}
     */
    isRelevantMessage(text) {
        const keywords = [
            'outage', 'offline', 'unavailable', 'maintenance', 'shutdown',
            'capacity', 'transmission', 'interconnector', 'cable',
            'congestion', 'constraint', 'limited', 'reduced',
            'price', 'spike', 'high', 'volatility',
            'fault', 'failure', 'trip', 'emergency'
        ];

        return keywords.some(keyword => text.includes(keyword));
    }

    /**
     * Extract capacity from message text
     * @param {string} text - Message text
     * @returns {number|null} Capacity in MW or null
     */
    extractCapacity(text) {
        const mwMatch = text.match(/(\d+(?:,\d+)?(?:\.\d+)?)\s*mw/i);
        const gwMatch = text.match(/(\d+(?:,\d+)?(?:\.\d+)?)\s*gw/i);
        
        if (gwMatch) {
            return parseFloat(gwMatch[1].replace(',', '')) * 1000;
        } else if (mwMatch) {
            return parseFloat(mwMatch[1].replace(',', ''));
        }
        
        return null;
    }

    /**
     * Extract country from message text
     * @param {string} text - Message text
     * @returns {string|null} Country code or null
     */
    extractCountry(text) {
        const countryMap = {
            'finland': 'FI', 'finnish': 'FI',
            'sweden': 'SE', 'swedish': 'SE',
            'norway': 'NO', 'norwegian': 'NO',
            'denmark': 'DK', 'danish': 'DK',
            'estonia': 'EE', 'estonian': 'EE',
            'latvia': 'LV', 'latvian': 'LV',
            'lithuania': 'LT', 'lithuanian': 'LT'
        };

        for (const [name, code] of Object.entries(countryMap)) {
            if (text.includes(name)) {
                return code;
            }
        }

        // Default to Finland if Nordic area mentioned
        if (text.includes('nordic') || text.includes('nord pool')) {
            return 'FI';
        }

        return null;
    }

    /**
     * Categorize message to determine event type and category
     * @param {string} text - Message text
     * @returns {Object} {eventType, category}
     */
    categorizeMessage(text) {
        let eventType = 'SYSTEM_MESSAGE';
        let category = 'MARKET';

        // Check for outages
        if (text.includes('outage') || text.includes('offline') || text.includes('unavailable')) {
            eventType = text.includes('planned') || text.includes('scheduled') ? 
                'PLANNED_OUTAGE' : 'UNPLANNED_OUTAGE';
            
            if (text.includes('transmission') || text.includes('interconnector') || text.includes('cable')) {
                category = 'TRANSMISSION';
            } else {
                category = 'GENERATION';
            }
        }
        // Check for capacity issues
        else if (text.includes('capacity') || text.includes('constraint') || text.includes('congestion')) {
            eventType = 'CAPACITY_CONSTRAINT';
            category = 'TRANSMISSION';
        }
        // Check for price events
        else if (text.includes('price') && (text.includes('spike') || text.includes('high') || text.includes('surge'))) {
            eventType = 'PRICE_SPIKE';
            category = 'MARKET';
        }

        return { eventType, category };
    }

    /**
     * Fetch transmission capacity data
     * Can help identify interconnector issues
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Array>} Array of events
     */
    async getTransmissionCapacity(startDate, endDate) {
        try {
            const startStr = format(startDate, 'yyyy-MM-dd');
            const endStr = format(endDate, 'yyyy-MM-dd');

            console.log(`Fetching Nord Pool transmission capacity from ${startStr} to ${endStr}`);

            const response = await axiosInstance.get(NORD_POOL_CAPACITY_URL, {
                params: {
                    startDate: startStr,
                    endDate: endStr
                },
                headers: this.apiKey ? {
                    'X-API-Key': this.apiKey
                } : {}
            });

            if (!response.data) {
                console.log('No Nord Pool transmission capacity data returned');
                return [];
            }

            // Parse capacity data for significant reductions
            const events = this.parseCapacityData(response.data);
            console.log(`Parsed ${events.length} transmission capacity events`);
            return events;

        } catch (error) {
            if (error.response?.status === 404) {
                console.log('Nord Pool transmission capacity endpoint not available');
                return [];
            }
            console.error('Error fetching Nord Pool capacity:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Parse capacity data to identify significant reductions
     * @param {Object} data - Raw capacity data
     * @returns {Array} Events
     */
    parseCapacityData(data) {
        // This would need to be implemented based on actual API response structure
        // For now, return empty array
        return [];
    }

    /**
     * Fetch all Nord Pool events in chunks
     * @param {number} days - Number of days to fetch
     * @returns {Promise<Array>} All events
     */
    async fetchEventsChunked(days = 30) {
        const allEvents = [];
        const chunkSize = 7;
        const totalChunks = Math.ceil(days / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const chunkEnd = subDays(new Date(), i * chunkSize);
            const chunkStart = subDays(chunkEnd, chunkSize);

            // Fetch system messages
            const messageEvents = await this.getSystemMessages(
                startOfDay(chunkStart),
                endOfDay(chunkEnd)
            );
            allEvents.push(...messageEvents);

            // Rate limiting
            if (i < totalChunks - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return allEvents;
    }
}

module.exports = new NordPoolClient();
