# TimescaleDB - Technical Specification

## Overview

TimescaleDB is a PostgreSQL extension optimized for time-series data. The dashboard uses it to store historical energy market data and events with efficient querying and aggregation.

---

## Database Configuration

### Container Setup

#### Docker/Podman
```bash
podman run -d \
  --name timescaledb \
  -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -v timescaledb-data:/var/lib/postgresql/data \
  timescale/timescaledb:latest-pg15
```

#### Environment Variables
```env
DB_HOST=localhost
DB_PORT=5433
DB_NAME=energytrading
DB_USER=postgres
DB_PASSWORD=postgres
```

### Connection Pool
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'energytrading',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,                    // Maximum connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 2000
});
```

---

## Schema

### Table: energy_data

#### Purpose
Stores time-series energy market data (load, prices, generation) for multiple countries.

#### Structure
```sql
CREATE TABLE IF NOT EXISTS energy_data (
  timestamp TIMESTAMPTZ NOT NULL,
  
  -- Poland
  pl_load_actual DOUBLE PRECISION,
  pl_load_forecast DOUBLE PRECISION,
  pl_price_day_ahead DOUBLE PRECISION,
  pl_solar_generation DOUBLE PRECISION,
  pl_wind_onshore_generation DOUBLE PRECISION,
  pl_wind_offshore_generation DOUBLE PRECISION,
  
  -- Hungary
  hu_load_actual DOUBLE PRECISION,
  hu_load_forecast DOUBLE PRECISION,
  hu_price_day_ahead DOUBLE PRECISION,
  hu_solar_generation DOUBLE PRECISION,
  hu_wind_generation DOUBLE PRECISION,
  
  -- Finland
  fi_load_actual DOUBLE PRECISION,
  fi_load_forecast DOUBLE PRECISION,
  fi_price_day_ahead DOUBLE PRECISION,
  fi_solar_generation DOUBLE PRECISION,
  fi_wind_generation DOUBLE PRECISION,
  
  PRIMARY KEY (timestamp)
);
```

#### Hypertable Conversion
```sql
SELECT create_hypertable(
  'energy_data',
  'timestamp',
  if_not_exists => TRUE,
  chunk_time_interval => INTERVAL '7 days'
);
```

**Benefits:**
- Automatic partitioning by time chunks (7-day intervals)
- Faster queries on time ranges
- Efficient compression of old data
- Better insert performance

#### Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_energy_data_timestamp 
  ON energy_data (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_energy_data_pl_metrics 
  ON energy_data (timestamp DESC, pl_load_actual, pl_price_day_ahead);

CREATE INDEX IF NOT EXISTS idx_energy_data_hu_metrics 
  ON energy_data (timestamp DESC, hu_load_actual, hu_price_day_ahead);

CREATE INDEX IF NOT EXISTS idx_energy_data_fi_metrics 
  ON energy_data (timestamp DESC, fi_load_actual, fi_price_day_ahead);
```

---

### Table: energy_events

#### Purpose
Stores market events (outages, price spikes, incidents) for annotation on charts.

#### Structure
```sql
CREATE TABLE IF NOT EXISTS energy_events (
  id SERIAL PRIMARY KEY,
  country VARCHAR(2) NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_category VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  description TEXT,
  source VARCHAR(100),
  affected_cap INTEGER,
  
  CONSTRAINT valid_country CHECK (country IN ('PL', 'HU', 'FI', 'SE', 'DE')),
  CONSTRAINT valid_category CHECK (event_category IN (
    'MARKET', 'NUCLEAR', 'TRANSMISSION', 'THERMAL', 
    'HYDRO', 'RENEWABLE', 'OFFSHORE', 'ENVIRONMENTAL', 'GENERATION'
  ))
);
```

#### Hypertable Conversion
```sql
SELECT create_hypertable(
  'energy_events',
  'event_time',
  if_not_exists => TRUE,
  chunk_time_interval => INTERVAL '30 days'
);
```

#### Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_events_time_country 
  ON energy_events (event_time DESC, country);

CREATE INDEX IF NOT EXISTS idx_events_category 
  ON energy_events (event_category, country);

CREATE INDEX IF NOT EXISTS idx_events_source 
  ON energy_events (source);
```

---

## Data Operations

### Insert Energy Data

#### Single Row Insert
```sql
INSERT INTO energy_data (
  timestamp,
  pl_load_actual,
  pl_load_forecast,
  pl_price_day_ahead,
  pl_solar_generation,
  pl_wind_onshore_generation,
  pl_wind_offshore_generation,
  hu_load_actual,
  hu_load_forecast,
  hu_price_day_ahead,
  fi_load_actual,
  fi_load_forecast,
  fi_price_day_ahead
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
ON CONFLICT (timestamp) DO UPDATE SET
  pl_load_actual = EXCLUDED.pl_load_actual,
  pl_load_forecast = EXCLUDED.pl_load_forecast,
  pl_price_day_ahead = EXCLUDED.pl_price_day_ahead,
  pl_solar_generation = EXCLUDED.pl_solar_generation,
  pl_wind_onshore_generation = EXCLUDED.pl_wind_onshore_generation,
  pl_wind_offshore_generation = EXCLUDED.pl_wind_offshore_generation,
  hu_load_actual = EXCLUDED.hu_load_actual,
  hu_load_forecast = EXCLUDED.hu_load_forecast,
  hu_price_day_ahead = EXCLUDED.hu_price_day_ahead,
  fi_load_actual = EXCLUDED.fi_load_actual,
  fi_load_forecast = EXCLUDED.fi_load_forecast,
  fi_price_day_ahead = EXCLUDED.fi_price_day_ahead;
```

#### Batch Insert (Transaction)
```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  for (const dataPoint of dataPoints) {
    await client.query(insertQuery, [
      dataPoint.timestamp,
      dataPoint.pl_load_actual,
      // ... all other fields
    ]);
  }
  
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### Insert Event
```sql
INSERT INTO energy_events (
  country,
  event_time,
  event_type,
  event_category,
  title,
  description,
  source,
  affected_cap
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
```

---

## Query Patterns

### Get Data for Period (No Aggregation)

#### Last 24-48 Hours
```sql
SELECT 
  timestamp,
  pl_load_actual,
  pl_load_forecast,
  pl_price_day_ahead,
  pl_solar_generation,
  pl_wind_onshore_generation,
  pl_wind_offshore_generation,
  hu_load_actual,
  hu_load_forecast,
  hu_price_day_ahead,
  fi_load_actual,
  fi_load_forecast,
  fi_price_day_ahead
FROM energy_data
WHERE timestamp >= NOW() - INTERVAL '48 hours'
ORDER BY timestamp ASC;
```

**Expected**: ~192 rows (15-minute resolution)

---

### Get Data with Hourly Aggregation

#### Last 7 Days
```sql
SELECT 
  time_bucket('1 hour', timestamp) AS timestamp,
  AVG(pl_load_actual) AS pl_load_actual,
  AVG(pl_load_forecast) AS pl_load_forecast,
  AVG(pl_price_day_ahead) AS pl_price_day_ahead,
  AVG(pl_solar_generation) AS pl_solar_generation,
  AVG(pl_wind_onshore_generation) AS pl_wind_onshore_generation,
  AVG(pl_wind_offshore_generation) AS pl_wind_offshore_generation,
  AVG(hu_load_actual) AS hu_load_actual,
  AVG(hu_load_forecast) AS hu_load_forecast,
  AVG(hu_price_day_ahead) AS hu_price_day_ahead,
  AVG(fi_load_actual) AS fi_load_actual,
  AVG(fi_load_forecast) AS fi_load_forecast,
  AVG(fi_price_day_ahead) AS fi_price_day_ahead
FROM energy_data
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY time_bucket('1 hour', timestamp)
ORDER BY timestamp ASC;
```

**Expected**: ~168 rows (hourly averages)

---

### Get Data with 4-Hour Aggregation

#### Last 30 Days
```sql
SELECT 
  time_bucket('4 hours', timestamp) AS timestamp,
  AVG(pl_load_actual) AS pl_load_actual,
  AVG(pl_load_forecast) AS pl_load_forecast,
  AVG(pl_price_day_ahead) AS pl_price_day_ahead,
  AVG(pl_solar_generation) AS pl_solar_generation,
  AVG(pl_wind_onshore_generation) AS pl_wind_onshore_generation,
  AVG(pl_wind_offshore_generation) AS pl_wind_offshore_generation,
  AVG(hu_load_actual) AS hu_load_actual,
  AVG(hu_load_forecast) AS hu_load_forecast,
  AVG(hu_price_day_ahead) AS hu_price_day_ahead,
  AVG(fi_load_actual) AS fi_load_actual,
  AVG(fi_load_forecast) AS fi_load_forecast,
  AVG(fi_price_day_ahead) AS fi_price_day_ahead
FROM energy_data
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY time_bucket('4 hours', timestamp)
ORDER BY timestamp ASC;
```

**Expected**: ~180 rows

---

### Get Data with Daily Aggregation

#### Last 90 Days, 6 Months, 1 Year
```sql
SELECT 
  time_bucket('1 day', timestamp) AS timestamp,
  AVG(pl_load_actual) AS pl_load_actual,
  AVG(pl_load_forecast) AS pl_load_forecast,
  AVG(pl_price_day_ahead) AS pl_price_day_ahead,
  AVG(pl_solar_generation) AS pl_solar_generation,
  AVG(pl_wind_onshore_generation) AS pl_wind_onshore_generation,
  AVG(pl_wind_offshore_generation) AS pl_wind_offshore_generation,
  AVG(hu_load_actual) AS hu_load_actual,
  AVG(hu_load_forecast) AS hu_load_forecast,
  AVG(hu_price_day_ahead) AS hu_price_day_ahead,
  AVG(fi_load_actual) AS fi_load_actual,
  AVG(fi_load_forecast) AS fi_load_forecast,
  AVG(fi_price_day_ahead) AS fi_price_day_ahead
FROM energy_data
WHERE timestamp >= NOW() - INTERVAL '1 year'
GROUP BY time_bucket('1 day', timestamp)
ORDER BY timestamp ASC;
```

**Expected**: ~365 rows (daily averages)

---

### Get Events for Period

```sql
SELECT 
  country,
  event_time,
  event_type,
  event_category,
  title,
  description,
  affected_cap
FROM energy_events
WHERE event_time >= $1 
  AND event_time <= $2
  AND country = ANY($3)
ORDER BY event_time DESC;
```

**Parameters:**
- `$1`: Start timestamp
- `$2`: End timestamp
- `$3`: Array of country codes `['PL', 'HU', 'FI']`

---

### Get Latest Data Point

```sql
SELECT timestamp
FROM energy_data
ORDER BY timestamp DESC
LIMIT 1;
```

---

### Count Total Records

```sql
SELECT COUNT(*) AS total_records
FROM energy_data;
```

---

### Get Database Statistics

```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE tablename IN ('energy_data', 'energy_events')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Data Aggregation Strategy

### Aggregation Function: `time_bucket()`

TimescaleDB's `time_bucket()` function groups time-series data into uniform intervals.

**Syntax:**
```sql
time_bucket(bucket_width INTERVAL, timestamp TIMESTAMPTZ)
```

**Examples:**
```sql
-- 15-minute buckets
time_bucket('15 minutes', timestamp)

-- 1-hour buckets
time_bucket('1 hour', timestamp)

-- 1-day buckets (aligns to midnight)
time_bucket('1 day', timestamp)
```

### Aggregation Selection Logic

```javascript
function getAggregationForPeriod(period) {
  switch(period) {
    case 'last-24-hours':
    case 'last-48-hours':
    case 'yesterday':
      return { interval: 'none', sqlFragment: '' };
    
    case 'last-7-days':
      return { 
        interval: '1 hour',
        sqlFragment: "time_bucket('1 hour', timestamp) AS timestamp"
      };
    
    case 'last-30-days':
      return { 
        interval: '4 hours',
        sqlFragment: "time_bucket('4 hours', timestamp) AS timestamp"
      };
    
    case 'last-90-days':
    case 'last-6-months':
    case 'last-year':
      return { 
        interval: '1 day',
        sqlFragment: "time_bucket('1 day', timestamp) AS timestamp"
      };
    
    default:
      return { interval: 'none', sqlFragment: '' };
  }
}
```

---

## Performance Optimization

### Compression

Enable automatic compression for old data:

```sql
ALTER TABLE energy_data SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'timestamp',
  timescaledb.compress_orderby = 'timestamp DESC'
);

-- Compress chunks older than 30 days
SELECT add_compression_policy(
  'energy_data',
  INTERVAL '30 days'
);
```

**Benefits:**
- Reduces storage by 90%+
- Maintains query performance
- Automatic background compression

### Retention Policy

Automatically delete old data:

```sql
SELECT add_retention_policy(
  'energy_data',
  INTERVAL '2 years'
);
```

### Continuous Aggregates (Optional)

Pre-compute common aggregations:

```sql
CREATE MATERIALIZED VIEW energy_data_hourly
WITH (timescaledb.continuous) AS
SELECT 
  time_bucket('1 hour', timestamp) AS timestamp,
  AVG(pl_load_actual) AS pl_load_actual,
  AVG(pl_price_day_ahead) AS pl_price_day_ahead
  -- ... other metrics
FROM energy_data
GROUP BY time_bucket('1 hour', timestamp);

-- Refresh policy
SELECT add_continuous_aggregate_policy(
  'energy_data_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);
```

---

## Backup and Restore

### Backup
```bash
# Full database backup
pg_dump -h localhost -p 5433 -U postgres energytrading > backup.sql

# Compressed backup
pg_dump -h localhost -p 5433 -U postgres energytrading | gzip > backup.sql.gz

# Backup specific table
pg_dump -h localhost -p 5433 -U postgres -t energy_data energytrading > energy_data_backup.sql
```

### Restore
```bash
# Restore from backup
psql -h localhost -p 5433 -U postgres energytrading < backup.sql

# Restore from compressed backup
gunzip -c backup.sql.gz | psql -h localhost -p 5433 -U postgres energytrading
```

---

## Monitoring

### Connection Count
```sql
SELECT count(*) 
FROM pg_stat_activity 
WHERE datname = 'energytrading';
```

### Active Queries
```sql
SELECT pid, usename, query, state, query_start
FROM pg_stat_activity
WHERE datname = 'energytrading'
  AND state = 'active'
ORDER BY query_start DESC;
```

### Table Sizes
```sql
SELECT 
  hypertable_name,
  pg_size_pretty(total_bytes) AS total_size,
  pg_size_pretty(index_bytes) AS index_size
FROM timescaledb_information.hypertables
WHERE hypertable_schema = 'public';
```

### Chunk Information
```sql
SELECT 
  chunk_name,
  range_start,
  range_end,
  pg_size_pretty(total_bytes) AS size
FROM timescaledb_information.chunks
WHERE hypertable_name = 'energy_data'
ORDER BY range_start DESC
LIMIT 10;
```

---

## Error Handling

### Connection Errors
```javascript
pool.on('error', (err, client) => {
  console.error('Unexpected database error:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
```

### Query Errors
```javascript
try {
  const result = await pool.query(query, params);
  return result.rows;
} catch (error) {
  if (error.code === '23505') {
    // Duplicate key - ignore (ON CONFLICT handles this)
  } else if (error.code === '42P01') {
    // Table doesn't exist - create schema
    await initializeDatabase();
  } else {
    console.error('Database query error:', error.message);
    throw error;
  }
}
```

---

## Migration Strategy

### Version Control
Create migration scripts for schema changes:

```javascript
// migrations/001_initial_schema.js
module.exports = {
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS energy_data (...);
      SELECT create_hypertable(...);
    `);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS energy_data CASCADE;`);
  }
};
```

### Applying Migrations
```javascript
const migrations = [
  require('./migrations/001_initial_schema'),
  require('./migrations/002_add_events_table')
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    for (const migration of migrations) {
      await migration.up(client);
    }
  } finally {
    client.release();
  }
}
```
