require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
// We authenticate via Bearer tokens (Authorization header), not cookies,
// so credentials:true is not needed and a wildcard origin is safe.
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/vows',     require('./routes/vows'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/email',    require('./routes/email'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/calendar', require('./routes/calendar'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend (if built into public/)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ CRM Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});
