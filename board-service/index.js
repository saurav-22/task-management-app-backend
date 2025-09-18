const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const promClient = require('prom-client');
const app = express();

app.use(express.json());

// Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });
const httpRequestCounter = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route'],
  registers: [register],
});
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Database connection
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Middleware to track requests
app.use((req, res, next) => {
  httpRequestCounter.inc({ method: req.method, route: req.path });
  next();
});

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, 'your_jwt_secret');
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Create board
app.post('/api/boards', authenticate, async (req, res) => {
  const { title } = req.body;
  try {
    const [result] = await pool.query('INSERT INTO boards (title, userId) VALUES (?, ?)', [title, req.userId]);
    res.json({ id: result.insertId, title, userId: req.userId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create board' });
  }
});

// List boards
app.get('/api/boards', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM boards WHERE userId = ?', [req.userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch boards' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3000, () => console.log('Board Service running on port 3000'));