const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Sequelize with Render PostgreSQL
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false,
        },
    },
});

// Import Event model
const Event = require('./models/Event')(sequelize);

// Sync database
sequelize.sync({ alter: true }).then(() => {
    console.log('Database synced');
});

// GET endpoint to fetch all events as GeoJSON
app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.findAll();
        const geojson = {
            type: 'FeatureCollection',
            features: events.map(event => ({
                type: 'Feature',
                properties: {
                    id: event.id,
                    category: event.category,
                    title: event.title,
                    description: event.description,
                    link: event.link,
                    date: event.date,
                },
                geometry: {
                    type: 'Point',
                    coordinates: [event.longitude, event.latitude],
                },
            })),
        };
        res.json(geojson);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST endpoint to add a new event
app.post('/api/events', async (req, res) => {
    const { category, title, description, link, date, latitude, longitude } = req.body;
    try {
        const event = await Event.create({
            category,
            title,
            description,
            link,
            date,
            latitude,
            longitude,
        });
        res.status(201).json(event);
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(400).json({ error: 'Invalid data' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});