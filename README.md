# Energy Trading Dashboard# Energy Trading Dashboard



A real-time energy trading dashboard that visualizes European electricity market data from the ENTSO-E Transparency Platform. Features live load forecasts, day-ahead prices, renewable generation tracking, and integrated market news feeds.A real-time Node.js dashboard for energy trading analysis that simulates continuous data ingestion from time-series energy market data.



![Dashboard Preview](https://img.shields.io/badge/Status-Live-success) ![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/License-MIT-blue)## Features



## Features### 📊 Real-time Data Visualization

- **Load vs Forecast Charts**: Compare actual energy load against forecasted values

### 📊 Real-Time Data Visualization- **Day-Ahead Pricing**: Monitor electricity prices across European markets

- **Load vs Forecast Analysis**: Compare actual electricity consumption against day-ahead forecasts- **Renewable Generation**: Track solar and wind power generation

- **Day-Ahead Price Tracking**: Monitor hourly electricity prices across European markets- **Real-time Metrics**: Display key performance indicators

- **Renewable Generation**: Track wind (onshore/offshore) and solar power generation

- **Multi-Country Support**: Poland (PL), Hungary (HU), and Finland (FI) with best data availability### 📈 Trading Analytics

- **Price Volatility Analysis**: Calculate and monitor price volatility across markets

### 📰 Market Intelligence- **Forecast Accuracy Metrics**: Measure load forecasting performance

- **Live News Feed**: Integrated RSS feed from Energy Live News with clickable headlines- **Trading Signals**: Generate buy/sell recommendations based on market conditions

- **30-Item FIFO Queue**: Maintains recent market news with automatic rotation- **Risk Assessment**: Evaluate market risk and provide trading recommendations

- **Trader Insights**: Q&A section for market analysis and trading strategies- **Anomaly Detection**: Identify unusual patterns in energy data



### 🎨 Modern UI### 🌍 Multi-Market Support

- Dark gradient theme optimized for extended viewing- Germany (DE) - Detailed renewable breakdown

- Responsive 3-column grid layout- Austria (AT)

- Real-time WebSocket updates every 15 minutes- Belgium (BE)

- Interactive Chart.js visualizations with smooth animations- Netherlands (NL)

- Hungary (HU)

## Architecture- Luxembourg (LU)



```### ⚡ Real-time Simulation

┌─────────────────────────────────────────────────────────────┐- Continuous data streaming from CSV files

│                     Browser (Client)                        │- Configurable streaming intervals (15min, 30min, 60min datasets)

│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │- Progress tracking and loop-back functionality

│  │ Load Chart   │  │ Price Chart  │  │ Renewables   │     │- WebSocket-based real-time updates

│  │  (Poland)    │  │  (Hungary)   │  │  (Finland)   │     │

│  └──────────────┘  └──────────────┘  └──────────────┘     │## Quick Start

│  ┌────────────────────────────────────────────────────┐   │

│  │         Market News (Energy Live News)             │   │### Prerequisites

│  └────────────────────────────────────────────────────┘   │- Node.js (v14 or higher)

└─────────────────────────────────────────────────────────────┘- npm or yarn

                          ↕ WebSocket

┌─────────────────────────────────────────────────────────────┐### Installation

│                  Node.js Server (Express)                   │

│  ┌─────────────────────────────────────────────────────┐   │1. Clone or download the project

│  │              Data Manager & Processor               │   │2. Install dependencies:

│  │  • 30-day historical cache                          │   │```bash

│  │  • 15-minute real-time refresh                      │   │npm install

│  │  • Dynamic country data merging                     │   │```

│  └─────────────────────────────────────────────────────┘   │

└─────────────────────────────────────────────────────────────┘3. Start the server:

           ↕ HTTPS                    ↕ HTTPS```bash

┌────────────────────────┐  ┌────────────────────────────┐npm start

│  ENTSO-E Transparency  │  │  Energy Live News RSS      │```

│  Platform API          │  │  (Market News Feed)        │

│  • Load (A65)          │  │  • Top 10 headlines        │4. Open your browser and navigate to:

│  • Generation (A75)    │  │  • Auto-refresh            │```

│  • Prices (A44)        │  └────────────────────────────┘http://localhost:3000

└────────────────────────┘```

```

## Usage

## Installation

### Dashboard Controls

### Prerequisites

- **Node.js**: v18.0.0 or higher**Dataset Selection**: Choose between 15-minute, 30-minute, or 60-minute interval datasets

- **ENTSO-E API Key**: Register at [ENTSO-E Transparency Platform](https://transparency.entsoe.eu/)

**Stream Controls**:

### Setup Steps- **Start Stream**: Begin real-time data simulation

- **Stop Stream**: Pause data streaming

1. **Clone the repository**- **Reset**: Go back to the beginning of the dataset

   ```bash

   git clone https://github.com/yourusername/energy-trading-dashboard.git**Country Selection**: Each chart allows you to select different countries for analysis

   cd energy-trading-dashboard

   ```### Real-time Features



2. **Install dependencies**The dashboard automatically updates with:

   ```bash- Live charts showing energy load, prices, and renewable generation

   npm install- Trading signals with buy/sell recommendations

   ```- Market condition indicators

- Risk assessment metrics

3. **Configure environment variables**- Forecast accuracy measurements

   ```bash

   # Create .env file### API Endpoints

   echo ENTSOE_API_KEY=your_api_key_here > .env

   ```The server provides RESTful API endpoints for detailed analytics:



4. **Start the dashboard**```

   GET /api/status                                    # Server status

   **Windows (PowerShell/CMD):**GET /api/datasets                                  # Available datasets

   ```cmdGET /api/analytics/volatility/:country             # Price volatility

   .\start-services.batGET /api/analytics/forecast-accuracy/:country      # Forecast accuracy

   ```GET /api/analytics/renewable-penetration/:country  # Renewable penetration

   GET /api/analytics/anomalies/:country/:metric      # Anomaly detection

   **Windows (PowerShell script):**GET /api/analytics/correlation                     # Correlation analysis

   ```powershellGET /api/analytics/market-summary                  # Market overview

   .\start-services.ps1```

   ```

   ## Technical Architecture

   **Linux/Mac:**

   ```bash### Backend Components

   npm start

   ```**server.js**: Main Express server with Socket.IO for real-time communication

- CSV data loading and parsing

5. **Access the dashboard**- WebSocket connection management

   ```- Real-time data streaming simulation

   http://localhost:3000- API endpoints for analytics

   ```

**utils/dataProcessor.js**: Advanced data processing utilities

## Configuration- Price volatility calculations

- Forecast accuracy analysis

### Environment Variables- Renewable penetration metrics

- Anomaly detection

Create a `.env` file in the root directory:- Correlation analysis



```env**utils/tradingMetrics.js**: Trading-specific analytics

# ENTSO-E Transparency Platform API Key (Required)- Trading signal generation

ENTSOE_API_KEY=your_32_character_api_key_here- Market condition assessment

- Risk evaluation

# Server Configuration (Optional)- Trading recommendations

PORT=3000

NODE_ENV=production### Frontend Components



# SSL Configuration (Development only)**public/index.html**: Single-page dashboard application

NODE_TLS_REJECT_UNAUTHORIZED=0- Chart.js for real-time visualizations

```- Socket.IO client for live updates

- Responsive design with modern UI

### Country Selection- Real-time metrics display



The dashboard uses Poland, Hungary, and Finland by default (best data availability). To modify:### Data Flow



**Backend** (`utils/entsoeDataManager.js`):1. **CSV Loading**: Server loads time-series data from CSV files

```javascript2. **Data Processing**: Raw data is cleaned and structured

this.countries = ['PL', 'HU', 'FI']; // Change country codes here3. **Analytics Generation**: Trading metrics and signals are calculated

```4. **Real-time Streaming**: Data is sent to clients via WebSocket

5. **Visualization**: Charts and metrics update in real-time

**Frontend** (`public/index.html`):

```html## Configuration

<select id="loadCountrySelector">

    <option value="PL">Poland (PL)</option>### Streaming Interval

    <option value="HU">Hungary (HU)</option>Default: 2 seconds between data points

    <option value="FI">Finland (FI)</option>Configurable via the dashboard interface

</select>

```### Data Buffer Size

- Historical data buffer: 200 data points

**Supported Countries:**- Chart display: Last 50 data points

- PL (Poland) - `10YPL-AREA-----S`- Analytics window: Configurable (default 20 points)

- HU (Hungary) - `10YHU-MAVIR----U`

- FI (Finland) - `10YFI-1--------U`### Risk Thresholds

- SE (Sweden) - `10YSE-1--------K`- Anomaly detection: Z-score > 2.5

- DE (Germany) - `10Y1001A1001A83F`- High volatility: Coefficient of variation > 15%

- Strong trading signals: Confidence > 80%

Use `test-countries.js` to test data availability for other European countries.

## Data Sources

## API Endpoints

The dashboard uses the Open Power System Data (OPSD) time series dataset:

### Data Endpoints- **Source**: ENTSO-E Transparency Platform

- **Coverage**: European power markets (2015-2020)

#### GET `/api/data/source`- **Resolution**: 15-minute, 30-minute, and hourly intervals

Returns current data source information and cache status.- **Variables**: Load, generation, prices, forecasts



**Response:**## Trading Logic

```json

{### Signal Generation

  "source": "entsoe-live",Signals are generated based on:

  "dataPoints": 768,- Price momentum analysis

  "currentIndex": 0,- Load forecast accuracy

  "cacheInfo": {- Renewable generation impact

    "dataPoints": 768,- Historical price comparisons

    "lastFetch": "2025-11-19T10:30:00.000Z",

    "countries": ["PL", "HU", "FI"],### Risk Assessment

    "dateRange": {Risk evaluation considers:

      "start": "2025-10-20T00:00:00.000Z",- Market volatility levels

      "end": "2025-11-19T23:45:00.000Z"- Price direction trends

    }- Renewable variability

  },- Signal strength confidence

  "needsRefresh": false

}### Market Conditions

```Classified as:

- **Stable**: Normal trading conditions

#### POST `/api/data/refresh`- **Trending Up/Down**: Moderate price movements

Manually trigger data refresh from ENTSO-E API.- **Volatile High/Low**: Extreme market conditions



**Query Parameters:**## Development

- `days` (optional): Number of days to fetch (default: 7)

- `historical` (optional): Fetch historical data (default: false)### Adding New Metrics

1. Extend `EnergyDataProcessor` class with new calculation methods

**Example:**2. Add corresponding API endpoints in `server.js`

```bash3. Update frontend to display new metrics

curl -X POST "http://localhost:3000/api/data/refresh?days=7&historical=true"

```### Custom Trading Strategies

1. Modify `TradingMetrics` class to implement new signal logic

**Response:**2. Adjust risk assessment parameters

```json3. Update signal strength thresholds

{

  "success": true,### Data Sources

  "message": "Live data refreshed successfully",To use different datasets:

  "dataPoints": 768,1. Place CSV files in the `data/` directory

  "cacheInfo": {...}2. Update dataset list in `server.js`

}3. Ensure CSV format matches expected structure

```

## Performance Notes

## Project Structure

- **Memory Usage**: ~100MB for typical datasets

```- **CPU Usage**: Low, optimized for continuous streaming

energy-trading-dashboard/- **Concurrent Users**: Tested with 10+ simultaneous connections

├── server.js                      # Main Express server- **Data Throughput**: ~1MB/minute at 2-second intervals

├── package.json                   # Node.js dependencies

├── .env                          # Environment variables (not in git)## Browser Compatibility

├── start-services.bat            # Windows service launcher

├── start-services.ps1            # PowerShell service launcher- Chrome 80+

├── public/- Firefox 75+

│   └── index.html                # Dashboard frontend- Safari 13+

└── utils/- Edge 80+

    ├── entsoeClient.js           # ENTSO-E API client

    ├── entsoeDataManager.js      # Data fetching & caching## License

    ├── dataProcessor.js          # Data transformation

    └── tradingMetrics.js         # Trading calculationsThis project is for educational and demonstration purposes.

```

## Support

## Data Flow

For issues or questions, please check the console logs for detailed error information.
1. **Initial Load** (server startup):
   - Fetches 30 days of historical data from ENTSO-E API
   - Splits into 30-day chunks to avoid rate limits
   - Merges data from PL, HU, FI into unified format
   - Caches in memory for fast streaming

2. **Real-Time Updates** (every 15 minutes):
   - Fetches last 2 days of data
   - Merges with historical cache
   - Broadcasts to connected clients via WebSocket

3. **Client Streaming**:
   - Server streams 1 data point every 100ms
   - Client updates charts in real-time
   - News feed updates independently every 30 seconds

## Development

### Running Tests

Test country data availability:
```bash
node test-countries.js
```

### Debugging

Enable verbose logging:
```javascript
// server.js
const DEBUG = true; // Set to true for detailed logs
```

Check terminal output for:
- ENTSO-E API responses
- Data point counts
- WebSocket connections
- News feed updates

### Common Issues

**No data displayed:**
- Verify `ENTSOE_API_KEY` is set correctly in `.env`
- Check API key is active at ENTSO-E portal
- Run `curl http://localhost:3000/api/data/source` to check cache

**SSL certificate errors:**
- Set `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env` (development only)
- Or update `start-services.bat` to include this variable

**News feed not loading:**
- Energy Live News RSS may be temporarily down
- Check `https://www.energylivenews.com/feed/` in browser
- Verify SSL bypass is configured

## Technology Stack

### Backend
- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **Socket.IO** - WebSocket communication
- **axios** - HTTP client for ENTSO-E API
- **rss-parser** - RSS feed parsing
- **date-fns** - Date manipulation
- **dotenv** - Environment configuration

### Frontend
- **Chart.js** - Interactive charts
- **Socket.IO Client** - Real-time updates
- **Vanilla JavaScript** - No framework dependencies
- **CSS Grid** - Responsive layout

### APIs
- **ENTSO-E Transparency Platform** - European electricity market data
- **Energy Live News RSS** - Market news headlines

## Performance

- **Data Points**: ~768 points (30 days, 15-minute resolution, 3 countries)
- **Memory Usage**: ~50-100 MB
- **API Calls**: 
  - Startup: 3 calls per country (9 total)
  - Real-time: 3 calls per country every 15 minutes
- **Streaming Rate**: 1 data point per 100ms (smooth UI updates)

## Security Notes

⚠️ **Important for Production:**

1. **Never commit `.env`** - Add to `.gitignore`
2. **Remove SSL bypass** - Only use `NODE_TLS_REJECT_UNAUTHORIZED=0` in development
3. **Rate limiting** - ENTSO-E API has limits (implement exponential backoff)
4. **API key rotation** - Regenerate keys periodically
5. **CORS configuration** - Restrict origins in production

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details

## Acknowledgments

- **ENTSO-E** - European Network of Transmission System Operators for Electricity
- **Energy Live News** - Market news provider
- **Open Power System Data** - Historical energy datasets

## Support

For issues and questions:
- Open an issue on GitHub
- Check ENTSO-E API documentation: https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html

## Roadmap

- [ ] Add more European countries (Norway, Denmark, Sweden)
- [ ] Implement user authentication
- [ ] Add historical comparison views
- [ ] Export data to CSV/Excel
- [ ] Mobile responsive improvements
- [ ] Docker containerization
- [ ] Add unit tests
- [ ] Implement data persistence (PostgreSQL/TimescaleDB)

---

**Built with ⚡ by energy trading enthusiasts**
