/**
 * Trading Metrics Calculator
 * Specialized calculations for energy trading analysis
 */

class TradingMetrics {
    constructor() {
        this.historicalData = [];
        this.tradingSignals = [];
    }

    /**
     * Calculate trading signals based on price and load patterns
     * @param {Object} currentData - Current market data
     * @param {Array} historicalData - Historical data points
     * @returns {Object} Trading signals and recommendations
     */
    generateTradingSignals(currentData, historicalData = []) {
        const signals = {
            timestamp: currentData.timestamp,
            signals: {},
            marketCondition: this.assessMarketCondition(currentData, historicalData),
            alerts: []
        };

        Object.keys(currentData.countries).forEach(country => {
            const countryData = currentData.countries[country];
            if (!countryData.price_day_ahead) return;

            const countrySignals = this.analyzeCountrySignals(country, countryData, historicalData);
            signals.signals[country] = countrySignals;

            // Generate alerts for significant signals
            if (countrySignals.strength === 'strong') {
                signals.alerts.push({
                    country,
                    type: countrySignals.action,
                    reason: countrySignals.reason,
                    confidence: countrySignals.confidence
                });
            }
        });

        return signals;
    }

    /**
     * Analyze trading signals for a specific country
     * @param {string} country - Country code
     * @param {Object} countryData - Current country data
     * @param {Array} historicalData - Historical data
     * @returns {Object} Country-specific trading signals
     */
    analyzeCountrySignals(country, countryData, historicalData) {
        const recentPrices = this.getRecentPrices(country, historicalData, 10);
        const price = countryData.price_day_ahead;
        
        if (recentPrices.length < 5) {
            return { action: 'hold', strength: 'weak', confidence: 0, reason: 'Insufficient data' };
        }

        const avgPrice = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
        const priceDeviation = ((price - avgPrice) / avgPrice) * 100;
        
        // Price momentum analysis
        const momentum = this.calculateMomentum(recentPrices);
        
        // Load vs forecast analysis
        const forecastError = this.calculateForecastError(countryData);
        
        // Renewable generation impact
        const renewableImpact = this.assessRenewableImpact(countryData);
        
        // Generate trading signal
        let action = 'hold';
        let strength = 'weak';
        let confidence = 0;
        let reason = '';

        // Strong buy signals
        if (priceDeviation < -10 && momentum < -0.5 && renewableImpact.excess) {
            action = 'buy';
            strength = 'strong';
            confidence = 85;
            reason = 'Low prices with negative momentum and renewable excess';
        }
        // Moderate buy signals
        else if (priceDeviation < -5 && forecastError.underforecast) {
            action = 'buy';
            strength = 'moderate';
            confidence = 65;
            reason = 'Below average prices with potential demand increase';
        }
        // Strong sell signals
        else if (priceDeviation > 10 && momentum > 0.5) {
            action = 'sell';
            strength = 'strong';
            confidence = 80;
            reason = 'High prices with positive momentum';
        }
        // Moderate sell signals
        else if (priceDeviation > 5 && renewableImpact.shortage) {
            action = 'sell';
            strength = 'moderate';
            confidence = 60;
            reason = 'Above average prices with renewable shortage';
        }
        // Weak signals based on momentum only
        else if (Math.abs(momentum) > 0.3) {
            action = momentum > 0 ? 'sell' : 'buy';
            strength = 'weak';
            confidence = 40;
            reason = `Price momentum suggests ${momentum > 0 ? 'upward' : 'downward'} trend`;
        }

        return {
            action,
            strength,
            confidence,
            reason,
            metrics: {
                priceDeviation: Number(priceDeviation.toFixed(2)),
                momentum: Number(momentum.toFixed(3)),
                forecastError: forecastError.percentage,
                renewableShare: renewableImpact.share
            }
        };
    }

    /**
     * Calculate price momentum
     * @param {Array} prices - Array of recent prices
     * @returns {number} Momentum indicator
     */
    calculateMomentum(prices) {
        if (prices.length < 3) return 0;
        
        const recent = prices.slice(-3);
        const older = prices.slice(-6, -3);
        
        if (older.length === 0) return 0;
        
        const recentAvg = recent.reduce((sum, p) => sum + p, 0) / recent.length;
        const olderAvg = older.reduce((sum, p) => sum + p, 0) / older.length;
        
        return (recentAvg - olderAvg) / olderAvg;
    }

    /**
     * Calculate forecast error for load prediction
     * @param {Object} countryData - Country data
     * @returns {Object} Forecast error analysis
     */
    calculateForecastError(countryData) {
        if (!countryData.load_actual || !countryData.load_forecast) {
            return { percentage: 0, underforecast: false, overforecast: false };
        }

        const error = ((countryData.load_actual - countryData.load_forecast) / countryData.load_forecast) * 100;
        
        return {
            percentage: Number(error.toFixed(2)),
            underforecast: error > 5, // Actual > Forecast by more than 5%
            overforecast: error < -5   // Actual < Forecast by more than 5%
        };
    }

    /**
     * Assess renewable generation impact on pricing
     * @param {Object} countryData - Country data
     * @returns {Object} Renewable impact analysis
     */
    assessRenewableImpact(countryData) {
        const load = countryData.load_actual || 0;
        const solar = countryData.solar_generation || 0;
        const wind = countryData.wind_generation || 0;
        const totalRenewable = solar + wind;
        
        if (load === 0) {
            return { share: 0, excess: false, shortage: false };
        }

        const renewableShare = (totalRenewable / load) * 100;
        
        return {
            share: Number(renewableShare.toFixed(2)),
            excess: renewableShare > 60, // High renewable penetration
            shortage: renewableShare < 10 // Low renewable penetration
        };
    }

    /**
     * Get recent prices for a country
     * @param {string} country - Country code
     * @param {Array} historicalData - Historical data
     * @param {number} count - Number of recent prices to get
     * @returns {Array} Recent prices
     */
    getRecentPrices(country, historicalData, count = 10) {
        return historicalData
            .filter(d => d.countries[country]?.price_day_ahead)
            .slice(-count)
            .map(d => d.countries[country].price_day_ahead);
    }

    /**
     * Assess overall market condition
     * @param {Object} currentData - Current market data
     * @param {Array} historicalData - Historical data
     * @returns {Object} Market condition assessment
     */
    assessMarketCondition(currentData, historicalData) {
        const countries = Object.keys(currentData.countries);
        let totalLoad = 0;
        let totalRenewable = 0;
        let validPrices = [];

        countries.forEach(country => {
            const data = currentData.countries[country];
            if (data.load_actual) totalLoad += data.load_actual;
            if (data.solar_generation) totalRenewable += data.solar_generation;
            if (data.wind_generation) totalRenewable += data.wind_generation;
            if (data.price_day_ahead) validPrices.push(data.price_day_ahead);
        });

        const avgPrice = validPrices.length > 0 ? 
            validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length : 0;
        
        const renewablePenetration = totalLoad > 0 ? (totalRenewable / totalLoad) * 100 : 0;
        
        // Historical comparison
        const historicalAvgPrice = this.calculateHistoricalAvgPrice(historicalData);
        const priceChange = historicalAvgPrice > 0 ? 
            ((avgPrice - historicalAvgPrice) / historicalAvgPrice) * 100 : 0;

        // Determine market condition
        let condition = 'stable';
        if (Math.abs(priceChange) > 15) {
            condition = priceChange > 0 ? 'volatile_high' : 'volatile_low';
        } else if (Math.abs(priceChange) > 5) {
            condition = priceChange > 0 ? 'trending_up' : 'trending_down';
        }

        return {
            condition,
            avgPrice: Number(avgPrice.toFixed(2)),
            priceChange: Number(priceChange.toFixed(2)),
            renewablePenetration: Number(renewablePenetration.toFixed(2)),
            totalLoad: Number(totalLoad.toFixed(0)),
            marketStress: this.calculateMarketStress(validPrices, renewablePenetration)
        };
    }

    /**
     * Calculate market stress indicator
     * @param {Array} prices - Current prices
     * @param {number} renewablePenetration - Renewable penetration percentage
     * @returns {Object} Market stress assessment
     */
    calculateMarketStress(prices, renewablePenetration) {
        if (prices.length === 0) return { level: 'unknown', score: 0 };

        const priceVariance = this.calculateVariance(prices);
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const coefficientOfVariation = avgPrice > 0 ? Math.sqrt(priceVariance) / avgPrice : 0;

        // Stress factors
        let stressScore = 0;
        
        // Price volatility (0-40 points)
        stressScore += Math.min(coefficientOfVariation * 100, 40);
        
        // Renewable intermittency (0-30 points)
        if (renewablePenetration > 50) {
            stressScore += Math.min((renewablePenetration - 50) * 0.6, 30);
        }
        
        // Price level stress (0-30 points)
        const highPrices = prices.filter(p => p > 100).length;
        stressScore += (highPrices / prices.length) * 30;

        let level = 'low';
        if (stressScore > 70) level = 'high';
        else if (stressScore > 40) level = 'medium';

        return {
            level,
            score: Number(stressScore.toFixed(1)),
            factors: {
                volatility: Number((coefficientOfVariation * 100).toFixed(2)),
                renewableStress: renewablePenetration > 50,
                priceStress: highPrices > 0
            }
        };
    }

    /**
     * Calculate historical average price
     * @param {Array} historicalData - Historical data
     * @returns {number} Historical average price
     */
    calculateHistoricalAvgPrice(historicalData) {
        const allPrices = [];
        
        historicalData.forEach(dataPoint => {
            Object.values(dataPoint.countries).forEach(country => {
                if (country.price_day_ahead) {
                    allPrices.push(country.price_day_ahead);
                }
            });
        });

        return allPrices.length > 0 ? 
            allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length : 0;
    }

    /**
     * Calculate variance of an array
     * @param {Array} values - Array of numbers
     * @returns {number} Variance
     */
    calculateVariance(values) {
        if (values.length === 0) return 0;
        
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    }

    /**
     * Generate risk assessment for trading positions
     * @param {Object} signals - Trading signals
     * @param {Object} marketCondition - Market condition
     * @returns {Object} Risk assessment
     */
    generateRiskAssessment(signals, marketCondition) {
        const riskFactors = {
            marketVolatility: marketCondition.marketStress.level,
            priceDirection: Math.abs(marketCondition.priceChange) > 10 ? 'high' : 'low',
            renewableVariability: marketCondition.renewablePenetration > 60 ? 'high' : 'low',
            signalStrength: this.assessSignalStrength(signals)
        };

        let overallRisk = 'low';
        let riskScore = 0;

        // Calculate risk score (0-100)
        if (riskFactors.marketVolatility === 'high') riskScore += 30;
        else if (riskFactors.marketVolatility === 'medium') riskScore += 15;

        if (riskFactors.priceDirection === 'high') riskScore += 25;
        if (riskFactors.renewableVariability === 'high') riskScore += 20;
        if (riskFactors.signalStrength === 'weak') riskScore += 25;

        if (riskScore > 60) overallRisk = 'high';
        else if (riskScore > 30) overallRisk = 'medium';

        return {
            overallRisk,
            riskScore,
            factors: riskFactors,
            recommendations: this.generateRiskRecommendations(overallRisk, riskFactors)
        };
    }

    /**
     * Assess the strength of trading signals
     * @param {Object} signals - Trading signals
     * @returns {string} Signal strength assessment
     */
    assessSignalStrength(signals) {
        const countrySignals = Object.values(signals.signals || {});
        if (countrySignals.length === 0) return 'weak';

        const strongSignals = countrySignals.filter(s => s.strength === 'strong').length;
        const moderateSignals = countrySignals.filter(s => s.strength === 'moderate').length;

        if (strongSignals > countrySignals.length * 0.5) return 'strong';
        if (strongSignals + moderateSignals > countrySignals.length * 0.6) return 'moderate';
        return 'weak';
    }

    /**
     * Generate risk-based recommendations
     * @param {string} overallRisk - Overall risk level
     * @param {Object} riskFactors - Individual risk factors
     * @returns {Array} Risk recommendations
     */
    generateRiskRecommendations(overallRisk, riskFactors) {
        const recommendations = [];

        if (overallRisk === 'high') {
            recommendations.push('Consider reducing position sizes');
            recommendations.push('Implement strict stop-loss orders');
            recommendations.push('Monitor market conditions closely');
        }

        if (riskFactors.marketVolatility === 'high') {
            recommendations.push('Use wider stop-loss margins to account for volatility');
        }

        if (riskFactors.renewableVariability === 'high') {
            recommendations.push('Monitor weather forecasts for renewable generation');
            recommendations.push('Consider intraday trading opportunities');
        }

        if (riskFactors.signalStrength === 'weak') {
            recommendations.push('Wait for stronger signals before taking positions');
            recommendations.push('Consider paper trading to validate strategies');
        }

        if (recommendations.length === 0) {
            recommendations.push('Current conditions support normal trading activities');
        }

        return recommendations;
    }
}

module.exports = TradingMetrics;