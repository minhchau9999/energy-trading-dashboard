/**
 * RTE (Réseau de Transport d'Électricité) API Client
 * For fetching French generation unavailability and market events
 * API Documentation: https://data.rte-france.com/
 */

const axios = require('axios');
const https = require('https');
const { format, subDays, startOfDay, endOfDay } = require('date-fns');

// RTE API Base URLs
const RTE_API_BASE = 'https://digital.iservices.rte-france.com';
const RTE_OAUTH_URL = `${RTE_API_BASE}/token/oauth/`;
const RTE_UNAVAILABILITY_URL = `${RTE_API_BASE}/open_api/unavailability_additional_information/v4/generation_unavailabilities`;

// Create axios instance with timeout
const axiosInstance = axios.create({
    timeout: 30000,
    httpsAgent: new https.Agent({
        rejectUnauthorized: true
    })
});

class RTEClient {
    constructor() {
        this.clientId = process.env.RTE_CLIENT_ID || '';
        this.clientSecret = process.env.RTE_CLIENT_SECRET || '';
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Authenticate with RTE API and get access token
     */
    async authenticate() {
        if (!this.clientId || !this.clientSecret) {
            console.log('RTE API credentials not configured. Skipping RTE data fetch.');
            return false;
        }

        // Check if token is still valid
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return true;
        }

        try {
            const response = await axiosInstance.post(
                RTE_OAUTH_URL,
                new URLSearchParams({
                    grant_type: 'client_credentials'
                }).toString(),
                {
                    auth: {
                        username: this.clientId,
                        password: this.clientSecret
                    },
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            this.accessToken = response.data.access_token;
            // Token expires in seconds, set expiry to 5 minutes before actual expiry
            this.tokenExpiry = Date.now() + ((response.data.expires_in - 300) * 1000);
            console.log('RTE API authentication successful');
            return true;
        } catch (error) {
            console.error('RTE API authentication failed:', error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Fetch generation unavailabilities from RTE
     * @param {Date} startDate - Start date for data fetch
     * @param {Date} endDate - End date for data fetch
     * @returns {Promise<Array>} Array of unavailability events
     */
    async getUnavailabilities(startDate, endDate) {
        if (!await this.authenticate()) {
            return [];
        }

        try {
            const startStr = format(startDate, "yyyy-MM-dd'T'HH:mm:ssXXX");
            const endStr = format(endDate, "yyyy-MM-dd'T'HH:mm:ssXXX");

            console.log(`Fetching RTE unavailabilities from ${startStr} to ${endStr}`);

            const response = await axiosInstance.get(RTE_UNAVAILABILITY_URL, {
                params: {
                    start_date: startStr,
                    end_date: endStr
                },
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/json'
                }
            });

            if (!response.data || !response.data.generation_unavailabilities) {
                console.log('No RTE unavailability data returned');
                return [];
            }

            const events = this.parseUnavailabilities(response.data.generation_unavailabilities);
            console.log(`Parsed ${events.length} RTE unavailability events`);
            return events;

        } catch (error) {
            if (error.response?.status === 401) {
                console.error('RTE API authentication expired, retrying...');
                this.accessToken = null;
                return this.getUnavailabilities(startDate, endDate);
            } else if (error.response?.status === 429) {
                console.error('RTE API rate limit exceeded, waiting...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                return [];
            } else {
                console.error('Error fetching RTE data:', error.response?.data || error.message);
                return [];
            }
        }
    }

    /**
     * Parse RTE unavailability data into standardized event format
     * @param {Array} unavailabilities - Raw unavailability data from RTE API
     * @returns {Array} Parsed events
     */
    parseUnavailabilities(unavailabilities) {
        const events = [];

        for (const item of unavailabilities) {
            try {
                // Extract relevant fields
                const startTime = new Date(item.start_date);
                const endTime = item.end_date ? new Date(item.end_date) : null;
                const unitName = item.unit?.name || item.unit?.eic_code || 'Unknown Unit';
                const capacity = item.available_capacity !== undefined ? 
                    Math.abs(item.installed_capacity - item.available_capacity) : 
                    item.unavailable_capacity || 0;
                
                // Filter out small events
                if (capacity < 50) continue;

                // Determine event type
                let eventType = 'PLANNED_OUTAGE';
                const unavailType = item.type?.toLowerCase() || '';
                if (unavailType.includes('fortuit') || unavailType.includes('forced') || 
                    unavailType.includes('unplanned')) {
                    eventType = 'UNPLANNED_OUTAGE';
                }

                // Determine category based on production type
                let category = 'GENERATION';
                const productionType = item.production_type?.toLowerCase() || '';
                if (productionType.includes('nuclear')) {
                    category = 'NUCLEAR';
                } else if (productionType.includes('hydro')) {
                    category = 'HYDRO';
                } else if (productionType.includes('thermal') || productionType.includes('fossil')) {
                    category = 'THERMAL';
                } else if (productionType.includes('wind') || productionType.includes('solar')) {
                    category = 'RENEWABLE';
                }

                // Build description
                let description = `${unitName} unavailable`;
                if (item.reason) {
                    description += ` - Reason: ${item.reason}`;
                }
                if (item.production_type) {
                    description += ` (${item.production_type})`;
                }

                events.push({
                    event_time: startTime,
                    event_end_time: endTime,
                    country: 'FR',
                    event_type: eventType,
                    event_category: category,
                    title: `${unitName} - ${capacity.toFixed(0)} MW Unavailable`,
                    description: description,
                    affected_cap: capacity,
                    unit_name: unitName,
                    source: 'RTE'
                });

            } catch (error) {
                console.error('Error parsing RTE unavailability item:', error.message);
                continue;
            }
        }

        return events;
    }

    /**
     * Fetch unavailabilities in chunks to avoid API limits
     * @param {number} days - Number of days to fetch (default 30)
     * @returns {Promise<Array>} All events
     */
    async fetchUnavailabilitiesChunked(days = 30) {
        const allEvents = [];
        const chunkSize = 7; // Fetch 7 days at a time
        const totalChunks = Math.ceil(days / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const chunkEnd = subDays(new Date(), i * chunkSize);
            const chunkStart = subDays(chunkEnd, chunkSize);

            const events = await this.getUnavailabilities(
                startOfDay(chunkStart),
                endOfDay(chunkEnd)
            );

            allEvents.push(...events);

            // Rate limiting: wait between requests
            if (i < totalChunks - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return allEvents;
    }
}

module.exports = new RTEClient();
