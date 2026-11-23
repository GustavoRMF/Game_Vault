require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== Conexão PostgreSQL (Neon) =====
const connectionString = process.env.DATABASE_URL;
const isLocal = connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'));

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update(connectionString || 'gamevault-secret').digest('hex');

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(40) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      prefix_hash TEXT,
      prefix_salt TEXT,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS prefix_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS prefix_salt TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      genre TEXT DEFAULT '',
      status TEXT NOT NULL,
      rating NUMERIC(3,1),
      hours NUMERIC(8,1) DEFAULT 0,
      cover TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      added_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      genre TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'Média',
      target_price NUMERIC(10,2),
      cover TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      added_at BIGINT NOT NULL
    );
  `);

  // ===== Novas Tabelas Sociais (Mural, Comentários & Chat) =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(40) DEFAULT 'Geral',
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  console.log('Banco de dados Neon conectado e tabelas verificadas.');
}

// ===== Helpers de Senha & Token =====
function hashSecret(value, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  return { salt, hash };
}

function verifySecret(value, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = hashSecret(value, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  req.user = user;
  next();
}

function mapGameRow(row) {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    genre: row.genre || '',
    status: row.status,
    rating: row.rating !== null ? parseFloat(row.rating) : null,
    hours: row.hours !== null ? parseFloat(row.hours) : 0,
    cover: row.cover || '',
    notes: row.notes || '',
    addedAt: Number(row.added_at)
  };
}

function mapWishRow(row) {
  return {
    id: row.id,
    title: row.title,
    platform: row.platform,
    genre: row.genre || '',
    priority: row.priority || 'Média',
    targetPrice: row.target_price !== null ? parseFloat(row.target_price) : null,
    cover: row.cover || '',
    notes: row.notes || '',
    addedAt: Number(row.added_at)
  };
}

function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// ===== Rotas de Autenticação =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'O usuário deve ter entre 3 e 30 caracteres.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 8 dígitos.' });
    }

    const { salt, hash } = hashSecret(password);
    const { salt: prefixSalt, hash: prefixHash } = hashSecret(password.slice(0, 3));

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, salt, prefix_hash, prefix_salt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username`,
      [username, hash, salt, prefixHash, prefixSalt, Date.now()]
    );

    const user = result.rows[0];
    const token = createToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
    }
    console.error('Erro no cadastro:', err);
    res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const result = await pool.query(
      'SELECT id, username, password_hash, salt, prefix_hash FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];

    if (!user || !verifySecret(password, user.salt, user.password_hash)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    if (!user.prefix_hash && password.length >= 3) {
      const { salt: prefixSalt, hash: prefixHash } = hashSecret(password.slice(0, 3));
      await pool.query('UPDATE users SET prefix_hash = $1, prefix_salt = $2 WHERE id = $3', [prefixHash, prefixSalt, user.id]);
    }

    const token = createToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno ao fazer login.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const firstThree = String(req.body.firstThree || '');
    const newPassword = String(req.body.newPassword || '');

    if (!username || firstThree.length !== 3) {
      return res.status(400).json({ error: 'Informe o usuário e os 3 primeiros dígitos da senha cadastrada.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 dígitos.' });
    }

    const result = await pool.query(
      'SELECT id, username, prefix_hash, prefix_salt FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (!user.prefix_hash || !user.prefix_salt) {
      return res.status(400).json({ error: 'Esta conta ainda não possui verificação de dígitos ativada.' });
    }
    if (!verifySecret(firstThree, user.prefix_salt, user.prefix_hash)) {
      return res.status(401).json({ error: 'Os 3 primeiros dígitos não conferem com a senha cadastrada.' });
    }

    const { salt, hash } = hashSecret(newPassword);
    const { salt: newPrefixSalt, hash: newPrefixHash } = hashSecret(newPassword.slice(0, 3));

    await pool.query(
      'UPDATE users SET password_hash = $1, salt = $2, prefix_hash = $3, prefix_salt = $4 WHERE id = $5',
      [hash, salt, newPrefixHash, newPrefixSalt, user.id]
    );

    const token = createToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    res.status(500).json({ error: 'Erro interno ao redefinir senha.' });
  }
});

// ===== Rota de Ranking & Perfil Público =====
app.get('/api/ranking', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
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
      ORDER BY total_hours DESC, platinums DESC, completed DESC, total_games DESC, u.username ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar ranking:', err);
    res.status(500).json({ error: 'Erro ao carregar ranking.' });
  }
});

app.get('/api/users/:id/profile', authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'ID inválido' });

    const userRes = await pool.query('SELECT id, username, created_at FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'Jogador não encontrado.' });

    const gamesRes = await pool.query(
      'SELECT * FROM games WHERE user_id = $1 ORDER BY hours DESC, rating DESC NULLS LAST, added_at DESC',
      [userId]
    );
    const playerGames = gamesRes.rows.map(mapGameRow);

    const stats = {
      totalGames: playerGames.length,
      totalHours: playerGames.reduce((acc, g) => acc + (g.hours || 0), 0),
      platinums: playerGames.filter(g => g.status === '100%').length,
      completed: playerGames.filter(g => g.status === 'Zerado' || g.status === '100%').length,
      playing: playerGames.filter(g => g.status === 'Jogando').length
    };

    res.json({
      user: { id: user.id, username: user.username, createdAt: Number(user.created_at) },
      stats,
      games: playerGames
    });
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    res.status(500).json({ error: 'Erro ao carregar perfil do jogador.' });
  }
});

// ===== Mural de Informações & Comentários =====
app.get('/api/posts', authMiddleware, async (req, res) => {
  try {
    const postsRes = await pool.query(`
      SELECT p.id, p.user_id, u.username, p.title, p.content, p.category, p.created_at
      FROM community_posts p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      LIMIT 60
    `);

    const commentsRes = await pool.query(`
      SELECT c.id, c.post_id, c.user_id, u.username, c.content, c.created_at
      FROM post_comments c
      JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at ASC
    `);

    const commentsByPost = {};
    for (const c of commentsRes.rows) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
      commentsByPost[c.post_id].push({
        id: c.id,
        postId: c.post_id,
        userId: c.user_id,
        username: c.username,
        content: c.content,
        createdAt: Number(c.created_at)
      });
    }

    const posts = postsRes.rows.map(p => ({
      id: p.id,
      userId: p.user_id,
      username: p.username,
      title: p.title,
      content: p.content,
      category: p.category || 'Geral',
      createdAt: Number(p.created_at),
      comments: commentsByPost[p.id] || []
    }));

    res.json(posts);
  } catch (err) {
    console.error('Erro ao carregar mural:', err);
    res.status(500).json({ error: 'Erro ao carregar publicações.' });
  }
});

app.post('/api/posts', authMiddleware, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    const category = String(req.body.category || 'Geral').trim().slice(0, 40);

    if (!title || !content) {
      return res.status(400).json({ error: 'Preencha o título e a mensagem da publicação.' });
    }

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      `INSERT INTO community_posts (id, user_id, title, content, category, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, req.user.id, title.slice(0, 120), content.slice(0, 2000), category, createdAt]
    );

    res.status(201).json({
      id,
      userId: req.user.id,
      username: req.user.username,
      title: title.slice(0, 120),
      content: content.slice(0, 2000),
      category,
      createdAt,
      comments: []
    });
  } catch (err) {
    console.error('Erro ao criar post:', err);
    res.status(500).json({ error: 'Erro ao publicar no mural.' });
  }
});

app.delete('/api/posts/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM community_posts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Publicação não encontrada.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir post:', err);
    res.status(500).json({ error: 'Erro ao excluir publicação.' });
  }
});

app.post('/api/posts/:id/comments', authMiddleware, async (req, res) => {
  try {
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Escreva um comentário.' });

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      `INSERT INTO post_comments (id, post_id, user_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.params.id, req.user.id, content.slice(0, 600), createdAt]
    );

    res.status(201).json({
      id,
      postId: req.params.id,
      userId: req.user.id,
      username: req.user.username,
      content: content.slice(0, 600),
      createdAt
    });
  } catch (err) {
    console.error('Erro ao comentar:', err);
    res.status(500).json({ error: 'Erro ao enviar comentário.' });
  }
});

app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM post_comments WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Comentário não encontrado.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir comentário:', err);
    res.status(500).json({ error: 'Erro ao excluir comentário.' });
  }
});

// ===== Chat Global da Comunidade =====
app.get('/api/chat', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM (
        SELECT m.id, m.user_id, u.username, m.message, m.created_at
        FROM chat_messages m
        JOIN users u ON u.id = m.user_id
        ORDER BY m.created_at DESC
        LIMIT 80
      ) sub
      ORDER BY created_at ASC
    `);

    res.json(result.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      message: r.message,
      createdAt: Number(r.created_at)
    })));
  } catch (err) {
    console.error('Erro ao carregar chat:', err);
    res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
});

app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Digite uma mensagem.' });

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      'INSERT INTO chat_messages (id, user_id, message, created_at) VALUES ($1, $2, $3, $4)',
      [id, req.user.id, message.slice(0, 500), createdAt]
    );

    res.status(201).json({
      id,
      userId: req.user.id,
      username: req.user.username,
      message: message.slice(0, 500),
      createdAt
    });
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err);
    res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
});

app.delete('/api/chat/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM chat_messages WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir mensagem:', err);
    res.status(500).json({ error: 'Erro ao excluir mensagem.' });
  }
});

// ===== Rotas CRUD da Biblioteca (por usuário) =====
app.get('/api/games', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM games WHERE user_id = $1 ORDER BY added_at DESC',
      [req.user.id]
    );
    res.json(result.rows.map(mapGameRow));
  } catch (err) {
    console.error('Erro ao listar jogos:', err);
    res.status(500).json({ error: 'Erro ao buscar jogos no banco.' });
  }
});

app.post('/api/games', authMiddleware, async (req, res) => {
  try {
    const g = req.body;
    if (!g.title || !g.platform || !g.status) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }
    const id = g.id || genId();
    const addedAt = g.addedAt || Date.now();

    const result = await pool.query(
      `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [id, req.user.id, g.title, g.platform, g.genre || '', g.status, g.rating ?? null, g.hours ?? 0, g.cover || '', g.notes || '', addedAt]
    );
    res.status(201).json(mapGameRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao adicionar jogo:', err);
    res.status(500).json({ error: 'Erro ao salvar jogo no banco.' });
  }
});

app.post('/api/games/bulk', authMiddleware, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  if (list.length === 0) return res.status(400).json({ error: 'Lista vazia.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query(
      'SELECT LOWER(title) AS t, platform FROM games WHERE user_id = $1',
      [req.user.id]
    );
    const existingKeys = new Set(existingRes.rows.map(r => `${r.t}|${r.platform}`));

    let importedCount = 0;
    for (const g of list) {
      if (!g || !g.title || !g.platform) continue;
      const key = `${String(g.title).toLowerCase()}|${g.platform}`;
      if (existingKeys.has(key)) continue;

      const id = genId();
      await client.query(
        `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, req.user.id, g.title, g.platform, g.genre || '', g.status || 'Não iniciado', g.rating ?? null, g.hours ?? 0, g.cover || '', g.notes || '', g.addedAt || Date.now()]
      );
      existingKeys.add(key);
      importedCount++;
    }
    await client.query('COMMIT');
    res.json({ imported: importedCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro no bulk import:', err);
    res.status(500).json({ error: 'Erro ao importar backup.' });
  } finally {
    client.release();
  }
});

app.put('/api/games/:id', authMiddleware, async (req, res) => {
  try {
    const g = req.body;
    const result = await pool.query(
      `UPDATE games
       SET title = $1, platform = $2, genre = $3, status = $4, rating = $5, hours = $6, cover = $7, notes = $8
       WHERE id = $9 AND user_id = $10
       RETURNING *`,
      [g.title, g.platform, g.genre || '', g.status, g.rating ?? null, g.hours ?? 0, g.cover || '', g.notes || '', req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Jogo não encontrado.' });
    res.json(mapGameRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar jogo:', err);
    res.status(500).json({ error: 'Erro ao atualizar jogo.' });
  }
});

app.delete('/api/games/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM games WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Jogo não encontrado.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir jogo:', err);
    res.status(500).json({ error: 'Erro ao excluir jogo.' });
  }
});

// ===== Rotas CRUD da Lista de Desejos (Wishlist) =====
app.get('/api/wishlist', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM wishlist WHERE user_id = $1 ORDER BY added_at DESC',
      [req.user.id]
    );
    res.json(result.rows.map(mapWishRow));
  } catch (err) {
    console.error('Erro ao listar wishlist:', err);
    res.status(500).json({ error: 'Erro ao carregar lista de desejos.' });
  }
});

app.post('/api/wishlist', authMiddleware, async (req, res) => {
  try {
    const w = req.body;
    if (!w.title || !w.platform) {
      return res.status(400).json({ error: 'Título e plataforma são obrigatórios.' });
    }
    const id = w.id || genId();
    const addedAt = w.addedAt || Date.now();

    const result = await pool.query(
      `INSERT INTO wishlist (id, user_id, title, platform, genre, priority, target_price, cover, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [id, req.user.id, w.title, w.platform, w.genre || '', w.priority || 'Média', w.targetPrice ?? null, w.cover || '', w.notes || '', addedAt]
    );
    res.status(201).json(mapWishRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao adicionar na wishlist:', err);
    res.status(500).json({ error: 'Erro ao salvar na lista de desejos.' });
  }
});

app.put('/api/wishlist/:id', authMiddleware, async (req, res) => {
  try {
    const w = req.body;
    const result = await pool.query(
      `UPDATE wishlist
       SET title = $1, platform = $2, genre = $3, priority = $4, target_price = $5, cover = $6, notes = $7
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [w.title, w.platform, w.genre || '', w.priority || 'Média', w.targetPrice ?? null, w.cover || '', w.notes || '', req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json(mapWishRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar wishlist:', err);
    res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
});

app.delete('/api/wishlist/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM wishlist WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir wishlist:', err);
    res.status(500).json({ error: 'Erro ao remover item.' });
  }
});

app.post('/api/wishlist/:id/move-to-library', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wishRes = await client.query(
      'SELECT * FROM wishlist WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (wishRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item não encontrado na lista de desejos.' });
    }

    const w = wishRes.rows[0];
    const newGameId = genId();
    const now = Date.now();

    const gameRes = await client.query(
      `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [newGameId, req.user.id, w.title, w.platform, w.genre || '', 'Não iniciado', null, 0, w.cover || '', w.notes || '', now]
    );

    await client.query('DELETE FROM wishlist WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    await client.query('COMMIT');

    res.json({ game: mapGameRow(gameRes.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao mover para biblioteca:', err);
    res.status(500).json({ error: 'Erro ao mover jogo para a biblioteca.' });
  } finally {
    client.release();
  }
});

// ===== Integração IGDB (Twitch OAuth) =====
let igdbToken = null;
let tokenExpiresAt = 0;

async function getIgdbToken() {
  if (igdbToken && Date.now() < tokenExpiresAt - 60000) return igdbToken;

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Configure TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nas variáveis de ambiente.');
  }

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error('Falha ao autenticar na Twitch/IGDB');

  const data = await res.json();
  igdbToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return igdbToken;
}

app.get('/api/games/search', authMiddleware, async (req, res) => {
  const query = (req.query.q || '').trim();
  if (query.length < 2) return res.json([]);

  try {
    const token = await getIgdbToken();
    const safeQuery = query.replace(/"/g, '');
    const igdbRes = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: `search "${safeQuery}"; fields name, cover.url, genres.name, first_release_date; limit 8;`
    });

    if (!igdbRes.ok) throw new Error(`IGDB retornou ${igdbRes.status}`);
    const gamesData = await igdbRes.json();

    const suggestions = gamesData.map(g => {
      const rawUrl = g.cover?.url ? `https:${g.cover.url}` : '';
      return {
        id: g.id,
        name: g.name,
        thumb: rawUrl ? rawUrl.replace('t_thumb', 't_cover_small') : '',
        cover: rawUrl ? rawUrl.replace('t_thumb', 't_cover_big') : '',
        genre: Array.isArray(g.genres) && g.genres.length > 0 ? g.genres[0].name : '',
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null
      };
    });

    res.json(suggestions);
  } catch (err) {
    console.error('Erro autocomplete IGDB:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cover', authMiddleware, async (req, res) => {
  const title = (req.query.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Título obrigatório' });

  try {
    const token = await getIgdbToken();
    const safeTitle = title.replace(/"/g, '');
    const igdbRes = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: `search "${safeTitle}"; fields name, cover.url; limit 1;`
    });

    if (!igdbRes.ok) throw new Error(`IGDB retornou ${igdbRes.status}`);
    const gamesData = await igdbRes.json();
    const rawUrl = gamesData[0]?.cover?.url;
    const cover = rawUrl ? `https:${rawUrl.replace('t_thumb', 't_cover_big')}` : null;

    res.json({ cover, matchedName: gamesData[0]?.name || null });
  } catch (err) {
    console.error('Erro IGDB:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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