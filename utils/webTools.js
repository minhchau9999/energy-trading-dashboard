const axios = require('axios');
const Parser = require('rss-parser');

class WebTools {
    constructor() {
        this.rssParser = new Parser({
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        // Weather API - using Open-Meteo (free, no API key required)
        this.weatherApiBase = 'https://api.open-meteo.com/v1';
        
        // Search/News APIs
        this.newsApiBase = 'https://newsapi.org/v2';
        this.newsApiKey = process.env.NEWS_API_KEY || null;
    }

    /**
     * Get weather forecast for a location
     * @param {string} location - City name or country code (PL, HU, FI, FR, NL)
     * @param {number} days - Number of days to forecast (1-7)
     */
    async getWeatherForecast(location, days = 3) {
        try {
            // Map country codes to major cities
            const locationMap = {
                'PL': { lat: 52.23, lon: 21.01, name: 'Warsaw, Poland' },      // Poland
                'HU': { lat: 47.50, lon: 19.04, name: 'Budapest, Hungary' },   // Hungary
                'FI': { lat: 60.17, lon: 24.94, name: 'Helsinki, Finland' },   // Finland
                'FR': { lat: 48.85, lon: 2.35, name: 'Paris, France' },        // France
                'NL': { lat: 52.37, lon: 4.90, name: 'Amsterdam, Netherlands' } // Netherlands
            };

            const coords = locationMap[location.toUpperCase()] || locationMap['PL'];
            
            const response = await axios.get(`${this.weatherApiBase}/forecast`, {
                params: {
                    latitude: coords.lat,
                    longitude: coords.lon,
                    hourly: 'temperature_2m,windspeed_10m,winddirection_10m,cloudcover,precipitation',
                    daily: 'temperature_2m_max,temperature_2m_min,windspeed_10m_max,precipitation_sum',
                    forecast_days: Math.min(days, 7),
                    timezone: 'auto'
                }
            });

            const data = response.data;
            const summary = {
                location: coords.name,
                current_time: data.current_weather?.time || new Date().toISOString(),
                daily_forecast: []
            };

            // Parse daily forecast
            if (data.daily) {
                for (let i = 0; i < data.daily.time.length; i++) {
                    summary.daily_forecast.push({
                        date: data.daily.time[i],
                        temp_max: data.daily.temperature_2m_max[i],
                        temp_min: data.daily.temperature_2m_min[i],
                        wind_speed_max: data.daily.windspeed_10m_max[i],
                        precipitation: data.daily.precipitation_sum[i]
                    });
                }
            }

            return summary;
        } catch (error) {
            console.error('Weather forecast error:', error.message);
            return { error: `Unable to fetch weather forecast: ${error.message}` };
        }
    }

    /**
     * Search for recent energy-related news
     * @param {string} query - Search query
     * @param {number} maxResults - Maximum number of results
     */
    async searchNews(query = 'energy market europe', maxResults = 5) {
        try {
            // Try NewsAPI if key is available
            if (this.newsApiKey) {
                const response = await axios.get(`${this.newsApiBase}/everything`, {
                    params: {
                        q: query,
                        language: 'en',
                        sortBy: 'publishedAt',
                        pageSize: maxResults,
                        apiKey: this.newsApiKey
                    },
                    timeout: 10000
                });

                return response.data.articles.map(article => ({
                    title: article.title,
                    description: article.description,
                    url: article.url,
                    source: article.source.name,
                    publishedAt: article.publishedAt
                }));
            }

            // Fallback to RSS feeds
            return await this.searchNewsViaRSS(query, maxResults);
            
        } catch (error) {
            console.error('News search error:', error.message);
            return await this.searchNewsViaRSS(query, maxResults);
        }
    }

    /**
     * Search news via RSS feeds (fallback method)
     */
    async searchNewsViaRSS(query, maxResults = 5) {
        try {
            const feeds = [
                'https://www.energylivenews.com/feed/',
                'https://www.reuters.com/rssFeed/businessNews',
                'https://www.power-technology.com/feed/'
            ];

            const allArticles = [];
            
            for (const feedUrl of feeds) {
                try {
                    const feed = await this.rssParser.parseURL(feedUrl);
                    const articles = feed.items.slice(0, 3).map(item => ({
                        title: item.title,
                        description: item.contentSnippet || item.content?.substring(0, 200),
                        url: item.link,
                        source: feed.title || feedUrl,
                        publishedAt: item.pubDate || item.isoDate
                    }));
                    allArticles.push(...articles);
                } catch (err) {
                    // Continue with other feeds if one fails
                    console.error(`RSS feed error (${feedUrl}):`, err.message);
                }
            }

            // Filter by query terms if possible
            const queryLower = query.toLowerCase();
            const filtered = allArticles.filter(article => 
                article.title.toLowerCase().includes(queryLower) ||
                (article.description && article.description.toLowerCase().includes(queryLower))
            );

            return (filtered.length > 0 ? filtered : allArticles).slice(0, maxResults);
            
        } catch (error) {
            console.error('RSS news search error:', error.message);
            return [];
        }
    }

    /**
     * Get current electricity generation data from ENTSO-E via web
     * @param {string} country - Country code
     */
    async getCurrentGeneration(country) {
        try {
            // This would require ENTSO-E API access
            // For now, return a placeholder
            return {
                country: country,
                message: 'Real-time generation data available in database',
                note: 'Use market context for current generation stats'
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Get general web search results (simplified)
     * @param {string} query - Search query
     */
    async webSearch(query) {
        try {
            // Try to use DuckDuckGo Instant Answer API (free, no key required)
            const response = await axios.get('https://api.duckduckgo.com/', {
                params: {
                    q: query,
                    format: 'json',
                    no_html: 1,
                    skip_disambig: 1
                },
                timeout: 10000
            });

            if (response.data.AbstractText) {
                return {
                    answer: response.data.AbstractText,
                    source: response.data.AbstractSource,
                    url: response.data.AbstractURL
                };
            }

            // If no instant answer, return related topics
            if (response.data.RelatedTopics && response.data.RelatedTopics.length > 0) {
                const topics = response.data.RelatedTopics
                    .filter(t => t.Text)
                    .slice(0, 3)
                    .map(t => ({
                        text: t.Text,
                        url: t.FirstURL
                    }));
                return { topics };
            }

            return { message: 'No specific web results found' };
            
        } catch (error) {
            console.error('Web search error:', error.message);
            return { error: `Web search unavailable: ${error.message}` };
        }
    }

    /**
     * Format tool results for AI consumption
     */
    formatForAI(toolName, results) {
        if (results.error) {
            return `[${toolName} Error]: ${results.error}`;
        }

        switch (toolName) {
            case 'weather':
                if (!results.daily_forecast) return '[Weather]: No data available';
                const forecast = results.daily_forecast.map(day => 
                    `${day.date}: ${day.temp_min}°C to ${day.temp_max}°C, Wind: ${day.wind_speed_max} km/h, Rain: ${day.precipitation}mm`
                ).join('\n');
                return `[Weather Forecast for ${results.location}]:\n${forecast}`;

            case 'news':
                if (!results || results.length === 0) return '[News]: No recent articles found';
                const articles = results.map((article, i) => 
                    `${i+1}. ${article.title} (${article.source}, ${article.publishedAt})\n   ${article.description || 'No description'}`
                ).join('\n\n');
                return `[Recent Energy News]:\n${articles}`;

            case 'search':
                if (results.answer) {
                    return `[Web Search]: ${results.answer}\nSource: ${results.source}`;
                }
                if (results.topics) {
                    const topics = results.topics.map((t, i) => `${i+1}. ${t.text}`).join('\n');
                    return `[Web Search Results]:\n${topics}`;
                }
                return `[Web Search]: ${results.message || 'No results'}`;

            default:
                return JSON.stringify(results);
        }
    }
}

module.exports = WebTools;
