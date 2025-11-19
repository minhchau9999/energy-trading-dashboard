/**
 * Energy Trading Data Processing Utilities
 * Provides functions for analyzing and processing energy market data
 */

class EnergyDataProcessor {
    constructor() {
        this.dataBuffer = [];
        this.maxBufferSize = 100;
    }

    /**
     * Add data point to the processing buffer
     * @param {Object} dataPoint - Energy data point
     */
    addDataPoint(dataPoint) {
        this.dataBuffer.push({
            ...dataPoint,
            processedAt: new Date()
        });

        // Maintain buffer size
        if (this.dataBuffer.length > this.maxBufferSize) {
            this.dataBuffer.shift();
        }
    }

    /**
     * Calculate price volatility for a specific country
     * @param {string} country - Country code (e.g., 'DE', 'AT')
     * @param {number} windowSize - Number of data points to analyze
     * @returns {Object} Volatility metrics
     */
    calculatePriceVolatility(country, windowSize = 20) {
        const prices = this.dataBuffer
            .slice(-windowSize)
            .map(d => d.countries[country]?.price_day_ahead)
            .filter(price => price !== null && price !== undefined);

        if (prices.length < 2) {
            return { volatility: 0, mean: 0, stdDev: 0, min: 0, max: 0 };
        }

        const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);
        const volatility = (stdDev / mean) * 100; // Coefficient of variation as percentage

        return {
            volatility: Number(volatility.toFixed(2)),
            mean: Number(mean.toFixed(2)),
            stdDev: Number(stdDev.toFixed(2)),
            min: Number(Math.min(...prices).toFixed(2)),
            max: Number(Math.max(...prices).toFixed(2)),
            dataPoints: prices.length
        };
    }

    /**
     * Calculate load forecasting accuracy
     * @param {string} country - Country code
     * @param {number} windowSize - Number of data points to analyze
     * @returns {Object} Accuracy metrics
     */
    calculateForecastAccuracy(country, windowSize = 20) {
        const dataPoints = this.dataBuffer
            .slice(-windowSize)
            .filter(d => {
                const countryData = d.countries[country];
                return countryData?.load_actual && countryData?.load_forecast;
            });

        if (dataPoints.length === 0) {
            return { mape: 0, mae: 0, rmse: 0, r2: 0, dataPoints: 0 };
        }

        let mapeSum = 0;
        let maeSum = 0;
        let rmseSum = 0;
        const actualValues = [];
        const forecastValues = [];

        dataPoints.forEach(d => {
            const actual = d.countries[country].load_actual;
            const forecast = d.countries[country].load_forecast;
            const error = Math.abs(actual - forecast);
            
            mapeSum += (error / actual) * 100;
            maeSum += error;
            rmseSum += Math.pow(error, 2);
            
            actualValues.push(actual);
            forecastValues.push(forecast);
        });

        const mape = mapeSum / dataPoints.length;
        const mae = maeSum / dataPoints.length;
        const rmse = Math.sqrt(rmseSum / dataPoints.length);
        
        // Calculate R-squared
        const actualMean = actualValues.reduce((sum, val) => sum + val, 0) / actualValues.length;
        const totalSumSquares = actualValues.reduce((sum, val) => sum + Math.pow(val - actualMean, 2), 0);
        const residualSumSquares = actualValues.reduce((sum, val, i) => sum + Math.pow(val - forecastValues[i], 2), 0);
        const r2 = totalSumSquares > 0 ? 1 - (residualSumSquares / totalSumSquares) : 0;

        return {
            mape: Number(mape.toFixed(2)), // Mean Absolute Percentage Error
            mae: Number(mae.toFixed(2)),   // Mean Absolute Error
            rmse: Number(rmse.toFixed(2)), // Root Mean Square Error
            r2: Number((r2 * 100).toFixed(2)), // R-squared as percentage
            accuracy: Number((100 - mape).toFixed(2)), // Simple accuracy percentage
            dataPoints: dataPoints.length
        };
    }

    /**
     * Calculate renewable energy penetration
     * @param {string} country - Country code
     * @param {number} windowSize - Number of data points to analyze
     * @returns {Object} Renewable penetration metrics
     */
    calculateRenewablePenetration(country, windowSize = 20) {
        const dataPoints = this.dataBuffer
            .slice(-windowSize)
            .filter(d => d.countries[country]?.load_actual);

        if (dataPoints.length === 0) {
            return { avgPenetration: 0, maxPenetration: 0, minPenetration: 0, dataPoints: 0 };
        }

        const penetrationRates = dataPoints.map(d => {
            const countryData = d.countries[country];
            const load = countryData.load_actual || 0;
            const solar = countryData.solar_generation || 0;
            const wind = countryData.wind_generation || 0;
            const renewableTotal = solar + wind;
            
            return load > 0 ? (renewableTotal / load) * 100 : 0;
        });

        const avgPenetration = penetrationRates.reduce((sum, rate) => sum + rate, 0) / penetrationRates.length;
        const maxPenetration = Math.max(...penetrationRates);
        const minPenetration = Math.min(...penetrationRates);

        return {
            avgPenetration: Number(avgPenetration.toFixed(2)),
            maxPenetration: Number(maxPenetration.toFixed(2)),
            minPenetration: Number(minPenetration.toFixed(2)),
            dataPoints: dataPoints.length,
            trend: this.calculateTrend(penetrationRates)
        };
    }

    /**
     * Detect anomalies in the data
     * @param {string} country - Country code
     * @param {string} metric - Metric to analyze ('load_actual', 'price_day_ahead', etc.)
     * @param {number} threshold - Z-score threshold for anomaly detection
     * @returns {Array} Anomalies detected
     */
    detectAnomalies(country, metric, threshold = 2.5) {
        const values = this.dataBuffer
            .map(d => d.countries[country]?.[metric])
            .filter(val => val !== null && val !== undefined);

        if (values.length < 10) return [];

        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length);

        const anomalies = [];
        this.dataBuffer.forEach((dataPoint, index) => {
            const value = dataPoint.countries[country]?.[metric];
            if (value !== null && value !== undefined) {
                const zScore = Math.abs((value - mean) / stdDev);
                if (zScore > threshold) {
                    anomalies.push({
                        timestamp: dataPoint.timestamp,
                        value: value,
                        zScore: Number(zScore.toFixed(2)),
                        deviation: Number(((value - mean) / mean * 100).toFixed(2))
                    });
                }
            }
        });

        return anomalies;
    }

    /**
     * Calculate correlation between two metrics
     * @param {string} country1 - First country code
     * @param {string} metric1 - First metric
     * @param {string} country2 - Second country code
     * @param {string} metric2 - Second metric
     * @returns {number} Correlation coefficient
     */
    calculateCorrelation(country1, metric1, country2, metric2) {
        const pairs = this.dataBuffer
            .map(d => ({
                x: d.countries[country1]?.[metric1],
                y: d.countries[country2]?.[metric2]
            }))
            .filter(pair => pair.x !== null && pair.x !== undefined && 
                          pair.y !== null && pair.y !== undefined);

        if (pairs.length < 3) return 0;

        const n = pairs.length;
        const sumX = pairs.reduce((sum, pair) => sum + pair.x, 0);
        const sumY = pairs.reduce((sum, pair) => sum + pair.y, 0);
        const sumXY = pairs.reduce((sum, pair) => sum + (pair.x * pair.y), 0);
        const sumX2 = pairs.reduce((sum, pair) => sum + (pair.x * pair.x), 0);
        const sumY2 = pairs.reduce((sum, pair) => sum + (pair.y * pair.y), 0);

        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

        return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(3));
    }

    /**
     * Calculate simple trend (increasing, decreasing, stable)
     * @param {Array} values - Array of numeric values
     * @returns {Object} Trend information
     */
    calculateTrend(values) {
        if (values.length < 3) return { direction: 'insufficient_data', slope: 0 };

        // Simple linear regression to determine trend
        const n = values.length;
        const x = Array.from({length: n}, (_, i) => i);
        const sumX = x.reduce((sum, val) => sum + val, 0);
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = x.reduce((sum, val, i) => sum + (val * values[i]), 0);
        const sumX2 = x.reduce((sum, val) => sum + (val * val), 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        
        let direction = 'stable';
        if (slope > 0.1) direction = 'increasing';
        else if (slope < -0.1) direction = 'decreasing';

        return {
            direction,
            slope: Number(slope.toFixed(4))
        };
    }

    /**
     * Generate market summary for all countries
     * @returns {Object} Market summary
     */
    generateMarketSummary() {
        if (this.dataBuffer.length === 0) return {};

        const latestData = this.dataBuffer[this.dataBuffer.length - 1];
        const countries = Object.keys(latestData.countries);
        const summary = {
            timestamp: latestData.timestamp,
            totalLoad: 0,
            totalRenewable: 0,
            avgPrice: 0,
            countries: {},
            marketMetrics: {}
        };

        let priceSum = 0;
        let priceCount = 0;

        countries.forEach(country => {
            const data = latestData.countries[country];
            const countryMetrics = {
                load: data.load_actual || 0,
                price: data.price_day_ahead || 0,
                solar: data.solar_generation || 0,
                wind: data.wind_generation || 0,
                forecast_accuracy: this.calculateForecastAccuracy(country, 10).accuracy,
                price_volatility: this.calculatePriceVolatility(country, 10).volatility,
                renewable_penetration: this.calculateRenewablePenetration(country, 10).avgPenetration
            };

            summary.countries[country] = countryMetrics;
            summary.totalLoad += countryMetrics.load;
            summary.totalRenewable += countryMetrics.solar + countryMetrics.wind;

            if (countryMetrics.price > 0) {
                priceSum += countryMetrics.price;
                priceCount++;
            }
        });

        summary.avgPrice = priceCount > 0 ? Number((priceSum / priceCount).toFixed(2)) : 0;
        summary.renewablePenetration = summary.totalLoad > 0 ? 
            Number(((summary.totalRenewable / summary.totalLoad) * 100).toFixed(2)) : 0;

        // Market-wide metrics
        summary.marketMetrics = {
            priceSpread: this.calculatePriceSpread(countries),
            loadBalance: this.calculateLoadBalance(countries),
            renewableCapacityFactor: this.calculateCapacityFactor()
        };

        return summary;
    }

    /**
     * Calculate price spread across markets
     * @param {Array} countries - List of country codes
     * @returns {Object} Price spread metrics
     */
    calculatePriceSpread(countries) {
        if (this.dataBuffer.length === 0) return { min: 0, max: 0, spread: 0 };

        const latestData = this.dataBuffer[this.dataBuffer.length - 1];
        const prices = countries
            .map(country => latestData.countries[country]?.price_day_ahead)
            .filter(price => price !== null && price !== undefined && price > 0);

        if (prices.length === 0) return { min: 0, max: 0, spread: 0 };

        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const spread = max - min;

        return {
            min: Number(min.toFixed(2)),
            max: Number(max.toFixed(2)),
            spread: Number(spread.toFixed(2)),
            spreadPercentage: min > 0 ? Number(((spread / min) * 100).toFixed(2)) : 0
        };
    }

    /**
     * Calculate load balance indicator
     * @param {Array} countries - List of country codes
     * @returns {Object} Load balance metrics
     */
    calculateLoadBalance(countries) {
        if (this.dataBuffer.length === 0) return { balance: 0, stability: 0 };

        const latestData = this.dataBuffer[this.dataBuffer.length - 1];
        const loads = countries
            .map(country => latestData.countries[country]?.load_actual)
            .filter(load => load !== null && load !== undefined && load > 0);

        if (loads.length === 0) return { balance: 0, stability: 0 };

        const totalLoad = loads.reduce((sum, load) => sum + load, 0);
        const avgLoad = totalLoad / loads.length;
        const variance = loads.reduce((sum, load) => sum + Math.pow(load - avgLoad, 2), 0) / loads.length;
        const coefficientOfVariation = Math.sqrt(variance) / avgLoad * 100;

        return {
            totalLoad: Number(totalLoad.toFixed(0)),
            avgLoad: Number(avgLoad.toFixed(0)),
            stability: Number((100 - coefficientOfVariation).toFixed(2)) // Higher = more stable
        };
    }

    /**
     * Calculate renewable capacity factor (for Germany where we have capacity data)
     * @returns {Object} Capacity factor metrics
     */
    calculateCapacityFactor() {
        if (this.dataBuffer.length === 0) return { solar: 0, wind: 0 };

        const latestData = this.dataBuffer[this.dataBuffer.length - 1];
        const deData = latestData.countries.DE;

        if (!deData) return { solar: 0, wind: 0 };

        const solarCF = deData.solar_capacity && deData.solar_generation ? 
            (deData.solar_generation / deData.solar_capacity) * 100 : 0;
        
        const windCF = deData.wind_capacity && deData.wind_generation ? 
            (deData.wind_generation / deData.wind_capacity) * 100 : 0;

        return {
            solar: Number(solarCF.toFixed(2)),
            wind: Number(windCF.toFixed(2))
        };
    }

    /**
     * Get data buffer for external analysis
     * @returns {Array} Copy of the data buffer
     */
    getDataBuffer() {
        return [...this.dataBuffer];
    }

    /**
     * Clear the data buffer
     */
    clearBuffer() {
        this.dataBuffer = [];
    }
}

module.exports = EnergyDataProcessor;