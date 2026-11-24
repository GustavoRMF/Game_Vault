try { require('dotenv').config(); } catch {}
const express = require('express');
const path = require('path');
const { initDb } = require('./db');

const authRoutes = require('./routes/auth');
const gamesRoutes = require('./routes/games');
const psnRoutes = require('./routes/psn');
const communityRoutes = require('./routes/community');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api', gamesRoutes);
app.use('/api', psnRoutes);
app.use('/api', communityRoutes);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`GameVault rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Falha crítica ao conectar no PostgreSQL:', err);
    process.exit(1);
  });