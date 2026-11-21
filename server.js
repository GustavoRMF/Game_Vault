const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Criptografia e Tokens (Nativo do Node.js) =====
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  if (hashBuffer.length !== keyBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, keyBuffer);
}

const SECRET = process.env.JWT_SECRET || process.env.DATABASE_URL || 'gamevault-secret-key-2026';

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, username: user.username })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login.' });
  req.user = user;
  next();
}

// ===== Inicialização do Banco Neon =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      username VARCHAR(40) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64),
      title TEXT NOT NULL,
      platform VARCHAR(20) NOT NULL,
      genre TEXT,
      status VARCHAR(30) NOT NULL,
      rating NUMERIC(3, 1),
      hours NUMERIC(8, 1) DEFAULT 0,
      cover TEXT,
      notes TEXT,
      added_at BIGINT NOT NULL
    );
  `);

  await pool.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);`);
  console.log('Banco de dados Neon conectado e tabelas verificadas.');
}

// ===== Rotas de Autenticação =====
app.post('/api/auth/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (username.length < 3) return res.status(400).json({ error: 'Usuário deve ter pelo menos 3 caracteres.' });
  if (password.length < 4) return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres.' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (exists.rowCount > 0) return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });

    const userId = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const passwordHash = hashPassword(password);

    await pool.query(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)',
      [userId, username, passwordHash, Date.now()]
    );

    // Vincula jogos antigos sem dono ao primeiro usuário cadastrado
    await pool.query('UPDATE games SET user_id = $1 WHERE user_id IS NULL', [userId]);

    const user = { id: userId, username };
    res.status(201).json({ token: createToken(user), user });
  } catch (err) {
    console.error('Erro register:', err);
    res.status(500).json({ error: 'Erro ao criar conta no banco de dados.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    res.json({
      token: createToken({ id: user.id, username: user.username }),
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('Erro login:', err);
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

// ===== Rota de Ranking =====
app.get('/api/ranking', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        u.id,
        u.username,
        COUNT(g.id)::int AS total_games,
        COALESCE(SUM(g.hours), 0)::float AS total_hours,
        COUNT(CASE WHEN g.status = '100%' THEN 1 END)::int AS platinums,
        COUNT(CASE WHEN g.status IN ('Zerado', '100%') THEN 1 END)::int AS completed
      FROM users u
      LEFT JOIN games g ON g.user_id = u.id
      GROUP BY u.id, u.username
      ORDER BY total_hours DESC, platinums DESC, completed DESC, u.username ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Erro ranking:', err);
    res.status(500).json({ error: 'Erro ao carregar ranking' });
  }
});

// ===== Rotas de Jogos =====
app.get('/api/games', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM games WHERE user_id = $1 ORDER BY added_at DESC',
      [req.user.id]
    );
    const formatted = rows.map(r => ({
      id: r.id,
      title: r.title,
      platform: r.platform,
      genre: r.genre || '',
      status: r.status,
      rating: r.rating !== null ? parseFloat(r.rating) : null,
      hours: r.hours !== null ? parseFloat(r.hours) : 0,
      cover: r.cover || '',
      notes: r.notes || '',
      addedAt: Number(r.added_at)
    }));
    res.json(formatted);
  } catch (err) {
    console.error('Erro GET games:', err);
    res.status(500).json({ error: 'Erro ao buscar jogos' });
  }
});

app.post('/api/games', authMiddleware, async (req, res) => {
  const { id, title, platform, genre, status, rating, hours, cover, notes, addedAt } = req.body;
  if (!id || !title || !platform || !status) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }
  try {
    const safeId = id.startsWith(`${req.user.id}_`) ? id : `${req.user.id}_${id}`;
    await pool.query(
      `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [safeId, req.user.id, title, platform, genre || '', status, rating ?? null, hours || 0, cover || '', notes || '', addedAt || Date.now()]
    );
    res.status(201).json({ ok: true, id: safeId });
  } catch (err) {
    console.error('Erro POST games:', err);
    res.status(500).json({ error: 'Erro ao salvar jogo' });
  }
});

app.post('/api/games/bulk', authMiddleware, async (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Formato inválido' });

  let importedCount = 0;
  try {
    for (const g of list) {
      if (!g.title || !g.platform) continue;
      const baseId = g.id || (Date.now().toString(36) + crypto.randomBytes(3).toString('hex'));
      const uniqueId = baseId.startsWith(`${req.user.id}_`) ? baseId : `${req.user.id}_${baseId}`;
      const result = await pool.query(
        `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [uniqueId, req.user.id, g.title, g.platform, g.genre || '', g.status || 'Não iniciado', g.rating ?? null, g.hours || 0, g.cover || '', g.notes || '', g.addedAt || Date.now()]
      );
      importedCount += result.rowCount;
    }
    res.json({ imported: importedCount });
  } catch (err) {
    console.error('Erro bulk:', err);
    res.status(500).json({ error: 'Erro na importação' });
  }
});

app.put('/api/games/:id', authMiddleware, async (req, res) => {
  const { title, platform, genre, status, rating, hours, cover, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE games
       SET title = $1, platform = $2, genre = $3, status = $4, rating = $5, hours = $6, cover = $7, notes = $8
       WHERE id = $9 AND user_id = $10`,
      [title, platform, genre || '', status, rating ?? null, hours || 0, cover || '', notes || '', req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Jogo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro PUT games:', err);
    res.status(500).json({ error: 'Erro ao atualizar jogo' });
  }
});

app.delete('/api/games/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM games WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro DELETE games:', err);
    res.status(500).json({ error: 'Erro ao excluir jogo' });
  }
});

// ===== Proxy IGDB =====
let twitchToken = null;
let tokenExpiresAt = 0;

async function getTwitchToken() {
  if (twitchToken && Date.now() < tokenExpiresAt) return twitchToken;

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Chaves da Twitch/IGDB não configuradas no Render');

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Erro ao autenticar na Twitch');
  const data = await res.json();

  twitchToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return twitchToken;
}

app.get('/api/cover', authMiddleware, async (req, res) => {
  const title = (req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Título obrigatório' });

  try {
    const token = await getTwitchToken();
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: `search "${title.replace(/"/g, '')}"; fields name, cover.image_id; where cover != null; limit 1;`
    });

    if (!response.ok) throw new Error('Falha na API IGDB');
    const data = await response.json();
    const imageId = data[0]?.cover?.image_id;
    const cover = imageId ? `https://images.igdb.com/igdb/image/upload/t_720p/${imageId}.jpg` : null;
    res.json({ cover });
  } catch (err) {
    console.error('Erro IGDB:', err);
    res.status(500).json({ error: err.message || 'Erro ao consultar IGDB' });
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`GameVault rodando na porta ${PORT}`));
  })
  .catch((err) => {
    console.error('Falha ao iniciar banco de dados:', err);
    process.exit(1);
  });