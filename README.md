# Energy Trading Dashboard

Real-time energy trading analytics dashboard for European electricity markets. Visualizes historical and live data from ENTSO-E, provides AI-powered trading insights, and tracks market events affecting generation and transmission.

## Features

###  **Data Visualization**

**Multi-Period Time Series Charts**
- View data across flexible time periods: 24 hours, 7 days, 30 days, 90 days, 6 months, or 1 year
- Automatic data aggregation for optimal performance (15-min to daily resolution)
- Interactive Chart.js visualizations with zoom and pan capabilities
- Click any chart to expand to full-screen modal view

**Load Analysis**
- Compare actual electricity load vs. day-ahead forecasts
- Visualize forecast accuracy over time
- Track demand patterns and peak consumption periods

**Price Tracking**
- Monitor day-ahead electricity prices (/MWh)
- Identify price spikes and volatility patterns
- Compare pricing across different markets

**Renewable Generation**
- Track solar power generation with detailed capacity data
- Monitor wind generation split by onshore and offshore capacity
- Calculate renewable energy penetration percentages

###  **Multi-Country Support**

**Available Markets**
-  **Poland (PL)** - Complete data coverage with wind (onshore/offshore), solar, and load forecasts
-  **Hungary (HU)** - Load and pricing data for Central European market insights
-  **Finland (FI)** - Nordic market data with detailed generation mix

**Country Selector**
- Switch between markets instantly without reloading
- Each country displays its relevant metrics and events
- Data synchronized across all charts for selected country

###  **Event Tracking System**

**Market Event Visualization**
- Events displayed as vertical lines with emoji icons on all charts
- Color-coded by event category and type (planned vs. unplanned)
- Hover near events to see detailed information in enhanced tooltips

**Event Categories**
-  **Market Events** - Price spikes and significant market movements
-  **Nuclear Events** - Nuclear plant outages and maintenance
-  **Transmission Events** - Grid constraints and transmission outages
-  **Thermal Events** - Coal, gas, and thermal generation issues
-  **Hydro Events** - Hydroelectric generation changes
-  **Renewable Events** - Wind and solar generation anomalies
-  **Offshore Events** - Offshore wind farm incidents
-  **Environmental Events** - Weather impacts on generation
-  **Generation Events** - General generation unit outages

**Event Filter**
- Dropdown with checkboxes to show/hide specific event categories
- Select All / Deselect All quick actions
- Live chart updates when toggling event types
- Filter label shows count of selected categories

**Smart Event Data**
- Events aligned with actual data patterns (e.g., price spikes at actual high prices)
- Detailed tooltips show: event time, category, affected capacity (MW), and description
- Integration with ENTSO-E unavailability data feed

###  **Real-Time Metrics Dashboard**

**Key Performance Indicators**
- **Average Load** - Mean electricity consumption across selected period
- **Average Price** - Mean day-ahead price in /MWh
- **Renewable Share** - Percentage of generation from wind and solar
- **Forecast Accuracy** - Load forecasting performance metric

**Expandable Metrics View**
- Click metrics card to see detailed breakdown in modal
- All metrics calculated dynamically based on selected time period
- Automatic updates when changing countries or time periods

###  **Live Market News**

**News Feed Integration**
- Real-time headlines from Energy Live News RSS feed
- Automatic updates with latest market developments
- Clickable links to full articles in new tab
- FIFO queue maintains most recent 30 headlines

**ENTSO-E Outage Alerts**
- Live feed of generation and transmission unavailabilities
- Parsed from ENTSO-E urgent market messages
- Automatically converted to event annotations on charts

**Expandable News View**
- Click news card to see full list with timestamps
- Enhanced readability in modal view
- Auto-scrolling for long lists

###  **AI Trading Advisor**

**Powered by Ollama (Local LLM)**
- Uses llama3:8b model running locally for privacy
- No data sent to external APIs
- Instant responses without internet dependency

**Multi-Turn Conversations**
- Ask follow-up questions to continue the discussion
- AI maintains conversation context (up to 10 exchanges)
- Each question builds upon previous answers
- Reset button to start fresh conversation

**Interactive Q&A**
- Type custom questions or select from 15 predefined trading queries
- Questions analyze current market conditions and data
- Responses provide actionable trading insights and risk assessment

**RAG (Retrieval-Augmented Generation)**
- Vector store searches relevant market events for each question
- Combines real-time market data with historical event context
- Semantic search using nomic-embed-text embeddings
- Accurate, data-driven responses based on actual market conditions

**Online Information Access**
- 🌤️ **Weather Forecasts**: Automatically fetches weather data when asked about temperature, wind, or forecasts
- 📰 **Energy News**: Searches recent energy market news from RSS feeds and news APIs
- 🔍 **Web Search**: Can look up definitions, concepts, and general information via DuckDuckGo
- 🌍 **Country-Specific Data**: Provides weather and news tailored to Poland, Hungary, Finland, France, and Netherlands
- ⚡ **Smart Detection**: Automatically determines when online information is needed based on question context

**Predefined Questions Include:**
- What's driving price volatility in the Polish market today?
- Is there an arbitrage opportunity between Poland and Finland?
- How accurate are the wind forecasts for Finland this week?
- Should we adjust our position based on Hungarian load forecast deviation?
- And 11 more market-specific queries

**Enhanced Response Display**
- Loading indicator while AI processes query
- Formatted question and answer sections
- Conversation counter showing number of exchanges
- Expandable modal view for longer responses
- Press Enter in input field to submit questions

**Dedicated Logging**
- All AI Advisor interactions logged to `ai-advisor.log`
- Detailed logging of questions, responses, and processing times
- RAG search results and vector store operations
- Conversation history tracking and management
- Separate from main server logs for easy analysis

###  **TimescaleDB Integration**

**High-Performance Time-Series Storage**
- PostgreSQL with TimescaleDB extension for efficient time-series queries
- Automatic data compression and retention policies
- Hypertable optimization for fast aggregation queries

**Data Management**
- Historical data stored from ENTSO-E API (up to 1 year)
- 15-minute resolution raw data with automatic aggregation
- Event storage with full-text search capabilities
- Efficient period-based queries (1-day to 1-year ranges)

**Database Features**
- Automatic schema initialization on first run
- Data deduplication based on timestamp and country
- Indexing optimized for common query patterns
- Event table with category, type, and capacity fields

###  **Modern UI/UX**

**Dark Theme Design**
- Gradient background optimized for extended viewing
- Cyan accent colors (#00d4ff) for key elements
- Glassmorphism effects with backdrop blur
- Smooth transitions and hover animations

**Responsive Layout**
- 3-column grid for charts (desktop)
- 2-column grid for bottom widgets
- Mobile-friendly responsive breakpoints
- Clickable cards with expand indicators

**Interactive Elements**
- WebSocket connection status indicator
- Real-time clock display
- Progress bar for data loading
- Period info display (resolution and data points)

**Modal System**
- Expand charts to full-screen for detailed analysis
- Expand gadgets (metrics, news, AI) for enhanced views
- Close with X button or Escape key
- Click outside modal to dismiss

###  **Real-Time Updates**

**WebSocket Communication**
- Socket.IO for bidirectional real-time communication
- Live data streaming every 15 minutes from ENTSO-E
- Instant news feed updates
- Connection status monitoring with auto-reconnect

**Data Refresh**
- Period selector triggers on-demand API requests
- Country selector updates charts without refetching
- Smart caching prevents redundant API calls
- Loading states for all async operations

###  **Data Aggregation**

**Intelligent Resolution Scaling**
- **24-48 hours**: 15-minute resolution (raw data)
- **7 days**: 1-hour averages (aggregated)
- **30 days**: 4-hour averages (aggregated)
- **90+ days**: Daily averages (aggregated)

**Performance Optimization**
- Reduced point counts for smoother rendering
- Dynamic point radius (0-3px based on data density)
- Line width adjustment (1-2px based on data volume)
- Chart update throttling with 'none' animation mode

###  **API Integration**

**ENTSO-E Transparency Platform**
- Official European electricity market data source
- Requires free API key from transparency.entsoe.eu
- Supports multiple data types: load, generation, prices, outages
- Automatic retry logic with exponential backoff

**Data Types Retrieved**
- A65: Actual total load
- A71: Day-ahead load forecast
- A44: Day-ahead prices
- A75: Actual generation per type (solar, wind onshore, wind offshore)
- A78/A79/A80: Unavailability messages (events)

**Rate Limiting**
- Built-in request throttling to respect API limits
- Chunked queries for long time periods
- Error handling with informative user messages

---

## Quick Start

1. **Install Node.js 18+** and **Podman/Docker**

2. **Clone repository**
   ```bash
   git clone <repo-url>
   cd EnergyTradingDashboard
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Configure environment**
   ```bash
   copy .env.example .env
   # Edit .env with your ENTSO-E API key
   ```

5. **Start services**
   ```bash
   .\start-services.bat start
   ```

6. **Open browser**
   ```
   http://localhost:3000
   ```
