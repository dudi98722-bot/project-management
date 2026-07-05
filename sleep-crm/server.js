require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/submissions', require('./routes/submissions'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Static frontend: form.html (public) + index.html (consultant CRM)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`🌙 Sleep-CRM running on port ${PORT}  (${process.env.NODE_ENV || 'development'})`);
});
