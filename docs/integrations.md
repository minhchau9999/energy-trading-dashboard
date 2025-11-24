# Integrations - Technical Specification

## Overview

The Energy Trading Dashboard integrates with multiple external data sources and services to provide comprehensive market intelligence and analytics.

## ENTSO-E Transparency Platform Integration

### Purpose
Official European electricity market data provider - primary source for load, generation, prices, and outage data.

### Configuration
```javascript
// utils/entsoeClient.js
const ENTSOE_BASE_URL = 'https://web-api.transparency.entsoe.eu/api';
const API_KEY = process.env.ENTSOE_API_KEY;
```

### Authentication
- **Method**: API Key in query parameters
- **Key Location**: Environment variable `ENTSOE_API_KEY`
- **Registration**: Free at transparency.entsoe.eu
- **Format**: 32-character alphanumeric string

### Supported Document Types

#### A65 - Actual Total Load
- **Endpoint**: `/ActualTotalLoad/6.1/DocumentType/A65.1`
- **Purpose**: Real electricity consumption data
- **Resolution**: 15-minute intervals
- **Countries**: PL, HU, FI

#### A71 - Load Forecast (Day-Ahead)
- **Endpoint**: `/TotalLoadForecast/6.1/DocumentType/A71.1`
- **Purpose**: Predicted electricity demand
- **Resolution**: Hourly forecasts
- **Lead Time**: Day-ahead (24 hours)

#### A44 - Day-Ahead Prices
- **Endpoint**: `/DayAheadPrices/6.1/DocumentType/A44.1`
- **Purpose**: Hourly electricity market prices
- **Currency**: EUR/MWh
- **Market**: Day-ahead spot market

#### A75 - Actual Generation per Type
- **Endpoint**: `/ActualGenerationOutputPerGenerationType/16.1/DocumentType/A75.1`
- **Purpose**: Generation breakdown by source
- **Types**: Solar (B16), Wind Onshore (B19), Wind Offshore (B18)
- **Resolution**: 15-minute intervals

#### A78/A79/A80 - Unavailability Messages
- **Endpoints**: 
  - A78: Offshore grid unavailability
  - A79: Transmission unavailability
  - A80: Generation unavailability
- **Purpose**: Planned and unplanned outages
- **Data**: Event time, capacity affected, type, reason

### Bidding Zone Codes
```javascript
const BIDDING_ZONES = {
  'PL': '10YPL-AREA-----S',  // Poland
  'HU': '10YHU-MAVIR----U',  // Hungary
  'FI': '10YFI-1--------U',  // Finland
  'SE': '10YSE-1--------K',  // Sweden
  'DE': '10Y1001A1001A83F'   // Germany
};
```

### Request Flow
1. Construct URL with document type, bidding zones, and time range
2. Add API key and format parameters (JSON)
3. Send GET request with axios
4. Parse XML/JSON response
5. Extract time series data points
6. Handle pagination for large datasets

### Rate Limiting
- **Limit**: Not officially documented
- **Implementation**: Exponential backoff on 429 errors
- **Chunking**: Split large time ranges into 30-day chunks
- **Retry Logic**: 3 attempts with 2s, 4s, 8s delays

### Error Handling
```javascript
try {
  const response = await axios.get(url);
  return parseEntsoeData(response.data);
} catch (error) {
  if (error.response?.status === 429) {
    // Rate limited - retry with backoff
  } else if (error.response?.status === 400) {
    // Invalid parameters - log and skip
  } else {
    // Network error - throw for upper layer handling
  }
}
```

### Data Caching
- **Strategy**: In-memory cache with TTL
- **Duration**: 15 minutes for real-time data
- **Storage**: Array of data points with timestamps
- **Refresh**: Automatic refresh every 15 minutes via cron

---

## Energy Live News RSS Integration

### Purpose
Real-time market news headlines for trader awareness.

### Configuration
```javascript
// utils/newsParser.js
const NEWS_FEEDS = [
  'https://www.energylivenews.com/feed/',
  // Additional feeds can be added
];
```

### Authentication
- **Method**: None (public RSS feed)
- **Access**: Direct HTTP GET requests

### RSS Parser
- **Library**: `rss-parser` npm package
- **Parsing**: Converts XML RSS to JSON objects
- **Fields Extracted**:
  - `title`: Headline text
  - `link`: Full article URL
  - `pubDate`: Publication timestamp
  - `contentSnippet`: Article summary (if available)

### Refresh Cycle
- **Interval**: Every 30 seconds
- **Method**: `setInterval()` in server.js
- **Broadcast**: Real-time push via Socket.IO to all clients

### Data Flow
1. Fetch RSS XML from feed URL
2. Parse XML to extract items
3. Map to standardized news object format
4. Emit to all connected Socket.IO clients
5. Client stores in FIFO queue (max 30 items)

### Error Handling
```javascript
try {
  const feed = await parser.parseURL(feedUrl);
  feed.items.forEach(item => {
    io.emit('marketNews', {
      headline: item.title,
      link: item.link,
      timestamp: item.pubDate
    });
  });
} catch (error) {
  console.error('News feed error:', error.message);
  // Continue silently - non-critical feature
}
```

---

## Ollama AI Integration

### Purpose
Local LLM for AI-powered trading insights and market analysis.

### Configuration
```javascript
// utils/aiInsights.js
const OLLAMA_BASE_URL = 'http://localhost:11434';
const MODEL_NAME = 'llama3:8b';
```

### Installation Requirements
- **Ollama**: Must be installed and running locally
- **Model**: llama3:8b (8 billion parameter model)
- **Download**: `ollama pull llama3:8b`
- **Verify**: `ollama list`

### API Endpoints

#### POST /api/generate
- **Purpose**: Generate text completion
- **Request Body**:
  ```json
  {
    "model": "llama3:8b",
    "prompt": "Analyze Polish market volatility...",
    "stream": false
  }
  ```
- **Response**: JSON with `response` field containing generated text

### Prompt Engineering
```javascript
const prompt = `You are an energy trading analyst. 
Current data: ${JSON.stringify(marketData)}

Question: ${userQuestion}

Provide concise trading insights focusing on:
- Price trends and volatility
- Renewable generation impact
- Load forecast accuracy
- Risk factors
- Actionable recommendations
`;
```

### Request Flow
1. User submits question via Socket.IO
2. Server retrieves current market data from TimescaleDB
3. Constructs context-aware prompt with data
4. Sends to Ollama API
5. Receives AI-generated response
6. Emits back to specific client via Socket.IO

### Performance
- **Response Time**: 2-5 seconds (local processing)
- **Privacy**: All data stays on local machine
- **Concurrency**: Handled by Ollama's queuing system
- **Timeout**: 30 seconds max

### Error Handling
```javascript
if (!this.enabled) {
  return "AI service not available. Please install Ollama.";
}

try {
  const response = await axios.post(OLLAMA_URL, requestBody);
  return response.data.response;
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    return "Ollama is not running. Start with: ollama serve";
  }
  throw error;
}
```

---

## TimescaleDB Integration

### Purpose
High-performance time-series database for storing historical market data and events.

### Configuration
```javascript
// server.js
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'energytrading',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
};
```

### Container Setup
- **Runtime**: Podman/Docker
- **Image**: `timescale/timescaledb:latest-pg15`
- **Port Mapping**: 5433:5432 (host:container)
- **Volume**: Persistent storage for data

### Schema Details
See [timescaledb.md](./timescaledb.md) for complete schema and query specifications.

---

## WebSocket (Socket.IO) Integration

### Purpose
Real-time bidirectional communication between server and clients.

### Server Configuration
```javascript
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});
```

### Events

#### Client → Server
- `askInsight`: User asks AI a question
  - **Payload**: `{ question: string }`
  - **Response**: `traderInsight` event

#### Server → Client
- `connect`: Client successfully connected
- `disconnect`: Client disconnected
- `marketNews`: New news headline available
  - **Payload**: `{ headline, link, timestamp }`
- `traderInsight`: AI response to user question
  - **Payload**: `{ question, answer }`
- `streamStatus`: Data streaming status
  - **Payload**: `{ isStreaming: boolean }`

### Connection Management
```javascript
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  socket.on('askInsight', async (data) => {
    const answer = await aiService.generateInsight(data.question);
    socket.emit('traderInsight', { question, answer });
  });
});
```

### Reconnection Strategy
- **Client-Side**: Automatic reconnection enabled
- **Backoff**: Exponential (1s, 2s, 4s, 8s max)
- **Indicator**: UI shows connection status (top-left)

---

## Environment Variables

### Required
```env
ENTSOE_API_KEY=your_32_character_api_key_here
```

### Optional
```env
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5433
DB_NAME=energytrading
DB_USER=postgres
DB_PASSWORD=postgres

# SSL (Development only)
NODE_TLS_REJECT_UNAUTHORIZED=0
```

---

## Security Considerations

### API Key Protection
- Never commit `.env` file to version control
- Use `.gitignore` to exclude sensitive files
- Rotate API keys periodically
- Use environment-specific keys (dev/prod)

### Database Security
- Change default postgres password in production
- Use SSL connections for remote databases
- Implement connection pooling limits
- Regular security updates for TimescaleDB image

### CORS Configuration
- Restrict origins in production
- Use specific domain whitelist
- Disable wildcard `*` origins

### Rate Limiting
- Implement server-side rate limiting for API endpoints
- Prevent abuse of AI service
- Throttle WebSocket message rates
