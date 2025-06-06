const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { check, validationResult } = require('express-validator');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// Database setup
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
});

// Models
const Event = require('./models/Event')(sequelize);
const User = sequelize.define('User', {
    username: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.STRING, defaultValue: 'user' },
});

// JWT middleware
const authenticateJWT = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Sync database
sequelize.sync({ alter: true }).then(() => logger.info('Database synced'));

// Login route
app.post('/api/login', [
    check('username').notEmpty().withMessage('Username is required'),
    check('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    try {
        const user = await User.findOne({ where: { username, password } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, role: user.role });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET events
app.get('/api/events', async (req, res) => {
    try {
        const events = await Event.findAll();
        const geojson = {
            type: 'FeatureCollection',
            features: events.map(event => ({
                type: 'Feature',
                properties: { id: event.id, category: event.category, title: event.title, description: event.description, link: event.link, date: event.date },
                geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
            })),
        };
        res.json(geojson);
    } catch (error) {
        logger.error('Error fetching events:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST event (admin only)
app.post('/api/events', authenticateJWT, [
    check('category').notEmpty().withMessage('Category is required'),
    check('title').notEmpty().withMessage('Title is required'),
    check('latitude').isFloat().withMessage('Valid latitude is required'),
    check('longitude').isFloat().withMessage('Valid longitude is required'),
], async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { category, title, description, link, date, latitude, longitude } = req.body;
    try {
        const event = await Event.create({ category, title, description, link, date, latitude, longitude });
        io.emit('newEvent', event);
        res.status(201).json(event);
    } catch (error) {
        logger.error('Error creating event:', error);
        res.status(400).json({ error: 'Invalid data' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => logger.info(`Server running on port ${PORT}`));