# Energy Trading Dashboard - Event Data Sources Configuration

## Overview
The dashboard now supports **4 data sources** for energy market events:
1. **ENTSO-E API** - European grid operator data (currently returns no public events)
2. **News Parser** - Extracts events from RSS news feeds
3. **RTE API** - French grid operator (Réseau de Transport d'Électricité)
4. **Nord Pool API** - Nordic electricity market

## Event Types Detected

### From News Parser (7 categories):
- **OUTAGES** (Planned/Unplanned) - Generation, transmission, or offshore outages
  - Keywords: outage, offline, shutdown, maintenance, unavailable, down, failure, trip, forced stop, fault, breakdown, disconnected
  
- **PRICE_SPIKE** - Market price volatility events  
  - Keywords: price spike, price surge, record high, skyrocket, soar
  - Visual: Purple 💰
  
- **DEMAND_SURGE** - High demand periods
  - Keywords: demand surge, demand spike, high demand, peak demand, strain, shortage
  - Visual: Pink 📈
  
- **WEATHER_EVENT** - Weather impacts on energy systems
  - Keywords: storm, hurricane, heatwave, cold snap, freeze, extreme weather, wind speed, low wind
  - Visual: Green 🌤️
  
- **SUPPLY_ISSUE** - Supply chain and capacity problems
  - Keywords: supply shortage, supply disruption, capacity constraint, grid stress, blackout, brownout
  
- **INTERCONNECTOR** - Cross-border transmission events
  - Keywords: interconnector, cable fault, import, export, cross-border, transmission capacity
  
- **CAPACITY** - Events must have >=50 MW capacity for outages (optional for other types)

### From RTE API (France):
- Generation unavailability events by production type:
  - **NUCLEAR** - Nuclear plant outages (☢️/⚛️)
  - **HYDRO** - Hydroelectric outages (💧/🌊)
  - **THERMAL** - Fossil fuel plant outages (🔥/♨️)
  - **RENEWABLE** - Wind/solar outages (🍃/♻️)
  - **GENERATION** - Other generation types (⚠️/🔧)

### From Nord Pool API (Nordic):
- System messages about market events
- Transmission capacity constraints  
- Market price events
- Grid congestion notices

## API Configuration

### 1. RTE API (French Data)
**To get RTE API credentials:**

1. Visit: https://data.rte-france.com/
2. Create an account (free)
3. Navigate to "My Applications" → "Create Application"
4. Subscribe to the "Unavailability Additional Information" API
5. You'll receive:
   - Client ID (Base64 encoded)
   - Client Secret (Base64 encoded)

**Configure in `.env` file:**
```env
RTE_CLIENT_ID=your_client_id_here
RTE_CLIENT_SECRET=your_client_secret_here
```

**RTE API Features:**
- Real generation unavailability data for France
- Planned and unplanned outages
- Nuclear, hydro, thermal, and renewable categorization
- Unit-level capacity information
- Historical data up to 30 days per request

**API Endpoint:**
- Base: `https://digital.iservices.rte-france.com`
- Unavailability: `/open_api/unavailability_additional_information/v4/generation_unavailabilities`
- OAuth: `/token/oauth/`

### 2. Nord Pool API (Nordic Data)
**To get Nord Pool API credentials:**

1. Visit: https://www.nordpoolgroup.com/
2. Contact their data services team for API access
3. Most public endpoints don't require authentication
4. Premium endpoints require an API key

**Configure in `.env` file:**
```env
NORD_POOL_API_KEY=your_api_key_here  # Optional for public data
```

**Nord Pool API Features:**
- System messages about grid events
- Transmission capacity data
- Market congestion notices
- Covers Finland, Sweden, Norway, Denmark, Baltics

**API Endpoint:**
- Base: `https://dataportal-api.nordpoolgroup.com/api`
- Messages: `/SystemMessage`
- Capacity: `/TransmissionCapacity`

**Note:** As of implementation, Nord Pool's public API endpoints are limited. Most event data requires direct partnership.

### 3. ENTSO-E API (Already Configured)
Your existing ENTSO-E API key in `.env`:
```env
ENTSOE_API_KEY=your_existing_key
```

**Status:** Configured but returns no public outage data for the requested document types (A80, A79, A78).

### 4. News Parser (No Configuration Needed)
Automatically fetches from:
- Energy Live News: `https://www.energylivenews.com/feed/`
- Power Technology: `https://www.power-technology.com/feed/`

## Visual Event Categories on Charts

The dashboard displays events with color-coded annotations:

| Category | Unplanned | Planned | Icon | Color |
|----------|-----------|---------|------|-------|
| **Generation** | ⚠️ | 🔧 | Warning/Wrench | Red/Yellow |
| **Transmission** | ⚡ | 🔌 | Lightning/Plug | Orange |
| **Offshore** | 🌊 | 🔵 | Wave/Circle | Blue |
| **Nuclear** | ☢️ | ⚛️ | Radioactive/Atom | Red/Orange |
| **Hydro** | 💧 | 🌊 | Drop/Wave | Blue |
| **Thermal** | 🔥 | ♨️ | Fire/Steam | Orange |
| **Renewable** | 🍃 | ♻️ | Leaf/Recycle | Green |
| **Market** | 💰/📈 | - | Money/Chart | Purple/Pink |
| **Environmental** | 🌤️ | - | Cloud | Green |

- **Solid lines** = Outages with capacity data
- **Dashed lines** = Market/environmental events
- **Labels** = Icon + Capacity (MW) or Event Title

## Testing Event Detection

### Test with Manual Database Insert
```sql
-- Insert a test event
INSERT INTO energy_events (
    country, event_time, event_end_time, event_type, 
    event_category, title, description, affected_cap, 
    unit_name, source
) VALUES (
    'FR', NOW() - INTERVAL '1 day', NOW(), 'UNPLANNED_OUTAGE',
    'NUCLEAR', 'Test Nuclear Outage', 'Testing event visualization',
    1200, 'Test Reactor', 'TEST'
);
```

Then refresh the dashboard and select France to see the event appear on charts.

### Verify Data Sources
Check server logs for initialization:
```powershell
Get-Content server.log | Select-String -Pattern "RTE|Nord Pool|news"
```

Expected output:
- ` Fetching events from RTE (France)...`
- ` Fetching events from Nord Pool (Nordic)...`
- `Fetching news from X sources`
- `Extracted X events from news`

## Troubleshooting

### No Events Appearing
1. **Check database:**
   ```sql
   SELECT COUNT(*), source FROM energy_events GROUP BY source;
   ```

2. **Check API credentials:**
   - RTE: Look for "authentication failed" or "credentials not configured"
   - Nord Pool: Look for "endpoint not available"

3. **Check news parsing:**
   ```powershell
   Get-Content server.log | Select-String "Extracted.*events from news"
   ```

### RTE API Issues
- **401 Unauthorized:** Check client ID and secret
- **429 Rate Limited:** API limits to ~100 requests/hour
- **No data:** French generation data might be delayed

### Nord Pool API Issues
- **404 Not Found:** Public endpoints limited
- **403 Forbidden:** Requires API key or partnership

### News Parser Issues
- **0 events extracted:** Current headlines don't match keywords
- **RSS timeout:** Network issues or feed down
- **Duplicate detection:** Events with same time/country/type filtered automatically

## Data Refresh Schedule

- **Real-time data:** Every 15 minutes
- **ENTSO-E events:** Every 15 minutes (last 2 days)
- **RTE events:** Every 15 minutes (last 2 days)
- **Nord Pool events:** Every 15 minutes (last 2 days)
- **News:** Every 30 minutes
- **Historical fetch:** On startup (365 days in chunks)

## Database Schema

```sql
CREATE TABLE energy_events (
    id SERIAL PRIMARY KEY,
    country VARCHAR(2) NOT NULL,
    event_time TIMESTAMPTZ NOT NULL,
    event_end_time TIMESTAMPTZ,
    event_type VARCHAR(50) NOT NULL,
    event_category VARCHAR(50),
    title TEXT NOT NULL,
    description TEXT,
    affected_cap DOUBLE PRECISION,
    unit_name TEXT,
    source VARCHAR(50) DEFAULT 'ENTSOE'
);

CREATE INDEX idx_event_time ON energy_events(event_time);
CREATE INDEX idx_country ON energy_events(country);
CREATE INDEX idx_event_type ON energy_events(event_type);
```

## Next Steps

1. **Get RTE API credentials** (recommended for French real data)
2. **Monitor news parser effectiveness** - adjust keywords if needed
3. **Consider adding more news sources** - expand RSS feed list
4. **Test with real events** - wait for actual outages/events to appear
5. **Explore alternative APIs:**
   - TenneT (Netherlands/Germany): https://www.tennet.eu/
   - National Grid ESO (UK): https://data.nationalgrideso.com/
   - EIA (US): https://www.eia.gov/opendata/

## Support

For questions about:
- **RTE API:** https://data.rte-france.com/page/support
- **Nord Pool API:** Contact via website
- **Dashboard issues:** Check server.log and database logs
