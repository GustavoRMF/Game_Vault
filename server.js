require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb } = require('./db');
const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const psnRoutes = require('./routes/psn');
const steamRoutes = require('./routes/steam');
const communityRoutes = require('./routes/community');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api', gamesRoutes);
app.use('/api', psnRoutes);
app.use('/api', steamRoutes);
app.use('/api', communityRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GameVault rodando em http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao conectar no PostgreSQL (Neon):', err);
    process.exit(1);
  });