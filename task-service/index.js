const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const axios = require('axios');
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

// Create task
app.post('/api/tasks', authenticate, async (req, res) => {
  const { title, boardId, assigneeEmail } = req.body;
  try {
    // Verify board belongs to user
    const [boards] = await pool.query('SELECT * FROM boards WHERE id = ? AND userId = ?', [boardId, req.userId]);
    if (boards.length === 0) return res.status(403).json({ error: 'Unauthorized board' });
    
    // Get assignee ID if email provided
    let assigneeId = null;
    if (assigneeEmail) {
      const response = await axios.get('http://user-service:80/api/users/by-email', {
        params: { email: assigneeEmail },
        headers: { Authorization: `Bearer ${token}` },
      });
      assigneeId = response.data.id;
    }
    
    const [result] = await pool.query(
      'INSERT INTO tasks (title, boardId, assigneeId) VALUES (?, ?, ?)',
      [title, boardId, assigneeId]
    );
    res.json({ id: result.insertId, title, boardId, assigneeEmail });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// List tasks
app.get('/api/tasks', authenticate, async (req, res) => {
  const { boardId } = req.query;
  try {
    const [rows] = await pool.query(
      'SELECT t.*, u.email AS assigneeEmail FROM tasks t LEFT JOIN users u ON t.assigneeId = u.id WHERE t.boardId = ?',
      [boardId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3000, () => console.log('Task Service running on port 3000'));