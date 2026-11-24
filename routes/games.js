const express = require('express');
const { pool } = require('../db');
const { authMiddleware, genId } = require('../middleware/auth');

const router = express.Router();

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

router.get('/games/search', authMiddleware, async (req, res) => {
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

router.get('/cover', authMiddleware, async (req, res) => {
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

// ===== CRUD Biblioteca =====
router.get('/games', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM games WHERE user_id::text = $1 ORDER BY added_at DESC',
      [String(req.user.id)]
    );
    res.json(result.rows.map(mapGameRow));
  } catch (err) {
    console.error('Erro ao listar jogos:', err);
    res.status(500).json({ error: 'Erro ao buscar jogos no banco.' });
  }
});

router.post('/games', authMiddleware, async (req, res) => {
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
      [id, String(req.user.id), g.title, g.platform, g.genre || '', g.status, g.rating ?? null, g.hours ?? 0, g.cover || '', g.notes || '', addedAt]
    );
    res.status(201).json(mapGameRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao adicionar jogo:', err);
    res.status(500).json({ error: 'Erro ao salvar jogo no banco.' });
  }
});

router.post('/games/bulk', authMiddleware, async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  if (list.length === 0) return res.status(400).json({ error: 'Lista vazia.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query(
      'SELECT LOWER(title) AS t, platform FROM games WHERE user_id::text = $1',
      [String(req.user.id)]
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
        [id, String(req.user.id), g.title, g.platform, g.genre || '', g.status || 'Não iniciado', g.rating ?? null, g.hours ?? 0, g.cover || '', g.notes || '', g.addedAt || Date.now()]
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

router.put('/games/:id', authMiddleware, async (req, res) => {
  try {
    const g = req.body;
    const result = await pool.query(
      `UPDATE games
       SET title = $1, platform = $2, genre = $3, status = $4, rating = $5, hours = $6, cover = $7, notes = $8
       WHERE id = $9 AND user_id::text = $10
       RETURNING *`,
      [g.title, g.platform, g.genre || '', g.status, g.rating ?? null, g.hours ?? 0, g.cover || '', g.notes || '', req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Jogo não encontrado.' });
    res.json(mapGameRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar jogo:', err);
    res.status(500).json({ error: 'Erro ao atualizar jogo.' });
  }
});

router.delete('/games/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM games WHERE id = $1 AND user_id::text = $2',
      [req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Jogo não encontrado.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir jogo:', err);
    res.status(500).json({ error: 'Erro ao excluir jogo.' });
  }
});

// ===== CRUD Lista de Desejos =====
router.get('/wishlist', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM wishlist WHERE user_id::text = $1 ORDER BY added_at DESC',
      [String(req.user.id)]
    );
    res.json(result.rows.map(mapWishRow));
  } catch (err) {
    console.error('Erro ao listar wishlist:', err);
    res.status(500).json({ error: 'Erro ao carregar lista de desejos.' });
  }
});

router.post('/wishlist', authMiddleware, async (req, res) => {
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
      [id, String(req.user.id), w.title, w.platform, w.genre || '', w.priority || 'Média', w.targetPrice ?? null, w.cover || '', w.notes || '', addedAt]
    );
    res.status(201).json(mapWishRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao adicionar na wishlist:', err);
    res.status(500).json({ error: 'Erro ao salvar na lista de desejos.' });
  }
});

router.put('/wishlist/:id', authMiddleware, async (req, res) => {
  try {
    const w = req.body;
    const result = await pool.query(
      `UPDATE wishlist
       SET title = $1, platform = $2, genre = $3, priority = $4, target_price = $5, cover = $6, notes = $7
       WHERE id = $8 AND user_id::text = $9
       RETURNING *`,
      [w.title, w.platform, w.genre || '', w.priority || 'Média', w.targetPrice ?? null, w.cover || '', w.notes || '', req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json(mapWishRow(result.rows[0]));
  } catch (err) {
    console.error('Erro ao atualizar wishlist:', err);
    res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
});

router.delete('/wishlist/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM wishlist WHERE id = $1 AND user_id::text = $2',
      [req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir wishlist:', err);
    res.status(500).json({ error: 'Erro ao remover item.' });
  }
});

router.post('/wishlist/:id/move-to-library', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wishRes = await client.query(
      'SELECT * FROM wishlist WHERE id = $1 AND user_id::text = $2',
      [req.params.id, String(req.user.id)]
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
      [newGameId, String(req.user.id), w.title, w.platform, w.genre || '', 'Não iniciado', null, 0, w.cover || '', w.notes || '', now]
    );

    await client.query('DELETE FROM wishlist WHERE id = $1 AND user_id::text = $2', [req.params.id, String(req.user.id)]);
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

module.exports = router;