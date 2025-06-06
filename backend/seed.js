const { Sequelize } = require('sequelize');
const Event = require('./models/Event');
const wemaData = require('../data/wema.json');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
});

async function seed() {
    await sequelize.sync({ alter: true });
    if (process.env.USE_STATIC_DATA === 'true') {
        const existingEvents = await Event.count();
        if (existingEvents === 0) {
            const events = wemaData.features.map(feature => ({
                id: feature.properties.id,
                category: feature.properties.category,
                title: feature.properties.title,
                description: feature.properties.description,
                link: feature.properties.link,
                date: feature.properties.date,
                latitude: feature.geometry.coordinates[1],
                longitude: feature.geometry.coordinates[0],
            }));
            await Event.bulkCreate(events);
            console.log('Database seeded with wema.json');
        } else {
            console.log('Database already seeded');
        }
    }
    process.exit(0);
}

seed().catch(console.error);