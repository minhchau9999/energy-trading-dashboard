// Script to seed sample events into the database for RAG testing
require('dotenv').config();
const DatabaseManager = require('./databaseManager');

const sampleEvents = [
    {
        country: 'PL',
        title: 'Nuclear Reactor Maintenance Scheduled',
        description: 'Planned maintenance will reduce nuclear capacity for two weeks',
        category: 'Nuclear',
        event_type: 'planned',
        affected_capacity: 900
    },
    {
        country: 'PL',
        title: 'Low Wind Period Expected',
        description: 'Weather forecasts indicate below-average wind speeds across Poland',
        category: 'Renewable',
        event_type: 'forecast',
        affected_capacity: 300
    },
    {
        country: 'HU',
        title: 'Transmission Line Constraint',
        description: 'Southern interconnector operating near thermal limits',
        category: 'Transmission',
        event_type: 'unplanned',
        affected_capacity: 200
    },
    {
        country: 'FI',
        title: 'High Wind Generation Forecast',
        description: 'Strong winds expected to boost renewable output significantly',
        category: 'Renewable',
        event_type: 'forecast',
        affected_capacity: 500
    },
    {
        country: 'PL',
        title: 'Coal Plant Outage',
        description: 'Unplanned outage at major coal generation facility',
        category: 'Thermal',
        event_type: 'unplanned',
        affected_capacity: 800
    },
    {
        country: 'FI',
        title: 'Hydro Reservoir Below Average',
        description: 'Reservoir levels tracking below seasonal norms due to dry conditions',
        category: 'Hydro',
        event_type: 'operational',
        affected_capacity: 400
    },
    {
        country: 'HU',
        title: 'Price Spike Event',
        description: 'Day-ahead prices surged due to demand spike and supply constraints',
        category: 'Market',
        event_type: 'unplanned',
        affected_capacity: null
    },
    {
        country: 'PL',
        title: 'Offshore Wind Farm Online',
        description: 'New offshore wind capacity commissioned, adding to renewable generation',
        category: 'Offshore',
        event_type: 'operational',
        affected_capacity: 600
    },
    {
        country: 'FI',
        title: 'Cold Weather Impact',
        description: 'Temperature drop increasing heating demand significantly',
        category: 'Environmental',
        event_type: 'operational',
        affected_capacity: null
    },
    {
        country: 'HU',
        title: 'Gas Generator Startup',
        description: 'Additional gas generation brought online to meet demand',
        category: 'Generation',
        event_type: 'operational',
        affected_capacity: 350
    }
];

async function seedEvents() {
    const db = new DatabaseManager();
    
    try {
        console.log('🌱 Seeding sample events into database...');
        
        // Test connection
        const connected = await db.testConnection();
        if (!connected) {
            throw new Error('Could not connect to database');
        }
        
        for (const event of sampleEvents) {
            // Set event time to recent past (random time in last 7 days)
            const daysAgo = Math.floor(Math.random() * 7);
            const hoursAgo = Math.floor(Math.random() * 24);
            const eventTime = new Date();
            eventTime.setDate(eventTime.getDate() - daysAgo);
            eventTime.setHours(eventTime.getHours() - hoursAgo);
            
            const query = `
                INSERT INTO energy_events (
                    country, event_time, event_type, category, 
                    title, description, source, affected_capacity
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (country, event_time, title) DO NOTHING
            `;
            
            await db.pool.query(query, [
                event.country,
                eventTime,
                event.event_type,
                event.category,
                event.title,
                event.description,
                'Manual Seed',
                event.affected_capacity
            ]);
            
            console.log(`  ✓ Added: [${event.category}] ${event.title}`);
        }
        
        console.log('✅ Event seeding completed!');
        
        // Verify
        const result = await db.pool.query('SELECT COUNT(*) FROM energy_events');
        console.log(`📊 Total events in database: ${result.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ Error seeding events:', error);
    } finally {
        await db.pool.end();
    }
}

// Run if called directly
if (require.main === module) {
    seedEvents();
}

module.exports = seedEvents;
