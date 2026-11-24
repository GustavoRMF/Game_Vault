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

// ===== Ranking & Perfil Público =====
router.get('/ranking', authMiddleware, async (req, res) => {
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
      LEFT JOIN games g ON g.user_id::text = u.id::text
      GROUP BY u.id, u.username
      ORDER BY total_hours DESC, platinums DESC, completed DESC, total_games DESC, u.username ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao carregar ranking:', err);
    res.status(500).json({ error: 'Erro ao carregar ranking.' });
  }
});

router.get('/users/:id/profile', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'ID inválido' });

    const userRes = await pool.query('SELECT id, username, created_at FROM users WHERE id::text = $1', [userId]);
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'Jogador não encontrado.' });

    const gamesRes = await pool.query(
      'SELECT * FROM games WHERE user_id::text = $1 ORDER BY hours DESC, rating DESC NULLS LAST, added_at DESC',
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
      user: { id: user.id, username: user.username, createdAt: Number(user.created_at || 0) },
      stats,
      games: playerGames
    });
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    res.status(500).json({ error: 'Erro ao carregar perfil do jogador.' });
  }
});

// ===== Mural & Comentários =====
router.get('/posts', authMiddleware, async (req, res) => {
  try {
    const postsRes = await pool.query(`
      SELECT p.id, p.user_id, u.username, p.title, p.content, p.category, p.created_at
      FROM community_posts p
      JOIN users u ON u.id::text = p.user_id::text
      ORDER BY p.created_at DESC
      LIMIT 60
    `);

    const commentsRes = await pool.query(`
      SELECT c.id, c.post_id, c.user_id, u.username, c.content, c.created_at
      FROM post_comments c
      JOIN users u ON u.id::text = c.user_id::text
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

router.post('/posts', authMiddleware, async (req, res) => {
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
      [id, String(req.user.id), title.slice(0, 120), content.slice(0, 2000), category, createdAt]
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

router.delete('/posts/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM community_posts WHERE id = $1 AND user_id::text = $2',
      [req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Publicação não encontrada.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir post:', err);
    res.status(500).json({ error: 'Erro ao excluir publicação.' });
  }
});

router.post('/posts/:id/comments', authMiddleware, async (req, res) => {
  try {
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Escreva um comentário.' });

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      `INSERT INTO post_comments (id, post_id, user_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.params.id, String(req.user.id), content.slice(0, 600), createdAt]
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

router.delete('/comments/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM post_comments WHERE id = $1 AND user_id::text = $2',
      [req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Comentário não encontrado.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir comentário:', err);
    res.status(500).json({ error: 'Erro ao excluir comentário.' });
  }
});

// ===== Chat Global =====
router.get('/chat', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM (
        SELECT m.id, m.user_id, u.username, m.message, m.created_at
        FROM chat_messages m
        JOIN users u ON u.id::text = m.user_id::text
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

router.post('/chat', authMiddleware, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Digite uma mensagem.' });

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      'INSERT INTO chat_messages (id, user_id, message, created_at) VALUES ($1, $2, $3, $4)',
      [id, String(req.user.id), message.slice(0, 500), createdAt]
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

router.delete('/chat/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM chat_messages WHERE id = $1 AND user_id::text = $2',
      [req.params.id, String(req.user.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Erro ao excluir mensagem:', err);
    res.status(500).json({ error: 'Erro ao excluir mensagem.' });
  }
});

module.exports = router;