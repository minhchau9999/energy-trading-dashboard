const { Pool } = require('pg');

class DatabaseManager {
    constructor() {
        this.pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: process.env.DB_PORT || 5433,
            database: process.env.DB_NAME || 'energytrading',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || '' // Empty password when using trust auth
        });
    }

    async testConnection() {
        try {
            const client = await this.pool.connect();
            console.log('✅ Connected to TimescaleDB');
            client.release();
            return true;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            return false;
        }
    }

    async initializeSchema() {
        const client = await this.pool.connect();
        try {
            console.log('🔧 Initializing database schema...');

            // Create table with dynamic country columns
            await client.query(`
                CREATE TABLE IF NOT EXISTS energy_data (
                    timestamp TIMESTAMPTZ NOT NULL,
                    
                    -- Poland (PL) data
                    pl_load_actual DOUBLE PRECISION,
                    pl_load_forecast DOUBLE PRECISION,
                    pl_price_day_ahead DOUBLE PRECISION,
                    pl_wind_onshore_generation DOUBLE PRECISION,
                    pl_wind_offshore_generation DOUBLE PRECISION,
                    pl_solar_generation DOUBLE PRECISION,
                    
                    -- Hungary (HU) data
                    hu_load_actual DOUBLE PRECISION,
                    hu_load_forecast DOUBLE PRECISION,
                    hu_price_day_ahead DOUBLE PRECISION,
                    hu_wind_onshore_generation DOUBLE PRECISION,
                    hu_wind_offshore_generation DOUBLE PRECISION,
                    hu_solar_generation DOUBLE PRECISION,
                    
                    -- Finland (FI) data
                    fi_load_actual DOUBLE PRECISION,
                    fi_load_forecast DOUBLE PRECISION,
                    fi_price_day_ahead DOUBLE PRECISION,
                    fi_wind_onshore_generation DOUBLE PRECISION,
                    fi_wind_offshore_generation DOUBLE PRECISION,
                    fi_solar_generation DOUBLE PRECISION,
                    
                    PRIMARY KEY (timestamp)
                );
            `);

            // Create hypertable if not exists
            await client.query(`
                SELECT create_hypertable('energy_data', 'timestamp', 
                    if_not_exists => TRUE, 
                    chunk_time_interval => INTERVAL '7 days'
                );
            `);

            // Create indexes for better query performance
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_timestamp ON energy_data (timestamp DESC);
            `);

            // Create events table for outages and important events
            await client.query(`
                CREATE TABLE IF NOT EXISTS energy_events (
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
            `);

            // Create indexes for events
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_events_time ON energy_events (event_time DESC);
                CREATE INDEX IF NOT EXISTS idx_events_country ON energy_events (country);
                CREATE INDEX IF NOT EXISTS idx_events_type ON energy_events (event_type);
            `);

            console.log('✅ Database schema initialized (including events table)');
            client.release();
            return true;
        } catch (error) {
            client.release();
            console.error('❌ Schema initialization failed:', error.message);
            throw error;
        }
    }

    async insertData(dataPoints) {
        if (!dataPoints || dataPoints.length === 0) return 0;

        const client = await this.pool.connect();
        try {
            let insertedCount = 0;

            // Use ON CONFLICT to handle duplicates
            const insertQuery = `
                INSERT INTO energy_data (
                    timestamp,
                    pl_load_actual, pl_load_forecast, pl_price_day_ahead,
                    pl_wind_onshore_generation, pl_wind_offshore_generation, pl_solar_generation,
                    hu_load_actual, hu_load_forecast, hu_price_day_ahead,
                    hu_wind_onshore_generation, hu_wind_offshore_generation, hu_solar_generation,
                    fi_load_actual, fi_load_forecast, fi_price_day_ahead,
                    fi_wind_onshore_generation, fi_wind_offshore_generation, fi_solar_generation
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                ON CONFLICT (timestamp) DO UPDATE SET
                    pl_load_actual = EXCLUDED.pl_load_actual,
                    pl_load_forecast = EXCLUDED.pl_load_forecast,
                    pl_price_day_ahead = EXCLUDED.pl_price_day_ahead,
                    pl_wind_onshore_generation = EXCLUDED.pl_wind_onshore_generation,
                    pl_wind_offshore_generation = EXCLUDED.pl_wind_offshore_generation,
                    pl_solar_generation = EXCLUDED.pl_solar_generation,
                    hu_load_actual = EXCLUDED.hu_load_actual,
                    hu_load_forecast = EXCLUDED.hu_load_forecast,
                    hu_price_day_ahead = EXCLUDED.hu_price_day_ahead,
                    hu_wind_onshore_generation = EXCLUDED.hu_wind_onshore_generation,
                    hu_wind_offshore_generation = EXCLUDED.hu_wind_offshore_generation,
                    hu_solar_generation = EXCLUDED.hu_solar_generation,
                    fi_load_actual = EXCLUDED.fi_load_actual,
                    fi_load_forecast = EXCLUDED.fi_load_forecast,
                    fi_price_day_ahead = EXCLUDED.fi_price_day_ahead,
                    fi_wind_onshore_generation = EXCLUDED.fi_wind_onshore_generation,
                    fi_wind_offshore_generation = EXCLUDED.fi_wind_offshore_generation,
                    fi_solar_generation = EXCLUDED.fi_solar_generation;
            `;

            // Insert in batches to avoid memory issues
            const batchSize = 500;
            for (let i = 0; i < dataPoints.length; i += batchSize) {
                const batch = dataPoints.slice(i, i + batchSize);
                
                for (const point of batch) {
                    await client.query(insertQuery, [
                        point.timestamp,
                        point.pl_load_actual || null,
                        point.pl_load_forecast || null,
                        point.pl_price_day_ahead || null,
                        point.pl_wind_onshore_generation || null,
                        point.pl_wind_offshore_generation || null,
                        point.pl_solar_generation || null,
                        point.hu_load_actual || null,
                        point.hu_load_forecast || null,
                        point.hu_price_day_ahead || null,
                        point.hu_wind_onshore_generation || null,
                        point.hu_wind_offshore_generation || null,
                        point.hu_solar_generation || null,
                        point.fi_load_actual || null,
                        point.fi_load_forecast || null,
                        point.fi_price_day_ahead || null,
                        point.fi_wind_onshore_generation || null,
                        point.fi_wind_offshore_generation || null,
                        point.fi_solar_generation || null
                    ]);
                    insertedCount++;
                }

                if ((i + batchSize) % 2000 === 0) {
                    console.log(`   Inserted ${i + batch.length}/${dataPoints.length} records...`);
                }
            }

            client.release();
            return insertedCount;
        } catch (error) {
            client.release();
            console.error('❌ Insert failed:', error.message);
            throw error;
        }
    }

    async getDataRange(startDate, endDate) {
        try {
            const query = `
                SELECT * FROM energy_data
                WHERE timestamp >= $1 AND timestamp <= $2
                ORDER BY timestamp ASC
            `;
            
            const result = await this.pool.query(query, [startDate, endDate]);
            return result.rows;
        } catch (error) {
            console.error('❌ Query failed:', error.message);
            throw error;
        }
    }

    async getLatestTimestamp() {
        try {
            const result = await this.pool.query(
                'SELECT MAX(timestamp) as latest FROM energy_data'
            );
            return result.rows[0]?.latest || null;
        } catch (error) {
            console.error('❌ Failed to get latest timestamp:', error.message);
            return null;
        }
    }

    async getDataCount() {
        try {
            const result = await this.pool.query('SELECT COUNT(*) as count FROM energy_data');
            return parseInt(result.rows[0]?.count || 0);
        } catch (error) {
            console.error('❌ Failed to get data count:', error.message);
            return 0;
        }
    }

    async getAllData() {
        try {
            const result = await this.pool.query(`
                SELECT * FROM energy_data
                ORDER BY timestamp ASC
            `);
            return result.rows;
        } catch (error) {
            console.error('❌ Failed to get all data:', error.message);
            throw error;
        }
    }

    async close() {
        await this.pool.end();
        console.log('🔌 Database connection closed');
    }

    // Event management methods
    async insertEvents(events) {
        if (!events || events.length === 0) return 0;

        const client = await this.pool.connect();
        try {
            let insertedCount = 0;

            const insertQuery = `
                INSERT INTO energy_events (
                    country, event_time, event_end_time, event_type, event_category,
                    title, description, affected_cap, unit_name, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `;

            for (const event of events) {
                try {
                    await client.query(insertQuery, [
                        event.country,
                        event.event_time,
                        event.event_end_time || null,
                        event.event_type,
                        event.event_category || null,
                        event.title,
                        event.description || null,
                        event.affected_capacity || null,
                        event.unit_name || null,
                        event.source || 'ENTSOE'
                    ]);
                    insertedCount++;
                } catch (err) {
                    // Skip duplicates
                    if (!err.message.includes('duplicate')) {
                        console.error('Error inserting event:', err.message);
                    }
                }
            }

            client.release();
            return insertedCount;
        } catch (error) {
            client.release();
            console.error('❌ Event insertion failed:', error.message);
            throw error;
        }
    }

    async getEventsInRange(startDate, endDate, countries = null) {
        try {
            let query = `
                SELECT * FROM energy_events
                WHERE event_time >= $1 AND event_time <= $2
            `;
            
            const params = [startDate, endDate];
            
            if (countries && countries.length > 0) {
                query += ` AND country = ANY($3)`;
                params.push(countries);
            }
            
            query += ` ORDER BY event_time ASC`;
            
            const result = await this.pool.query(query, params);
            return result.rows;
        } catch (error) {
            console.error('❌ Event query failed:', error.message);
            throw error;
        }
    }

    async getLatestEventTimestamp() {
        try {
            const result = await this.pool.query(
                'SELECT MAX(event_time) as latest FROM energy_events'
            );
            return result.rows[0]?.latest || null;
        } catch (error) {
            console.error('❌ Failed to get latest event timestamp:', error.message);
            return null;
        }
    }

    async getEventCount() {
        try {
            const result = await this.pool.query('SELECT COUNT(*) FROM energy_events');
            return parseInt(result.rows[0].count);
        } catch (error) {
            console.error('❌ Failed to get event count:', error.message);
            return 0;
        }
    }
}

module.exports = DatabaseManager;
