const express = require('express');
const { pool } = require('../db');
const { authMiddleware, genId } = require('../middleware/auth');

const router = express.Router();
const ONLINE_WINDOW_MS = 95 * 1000;

function isUserOnline(lastSeen) {
  return Date.now() - Number(lastSeen || 0) <= ONLINE_WINDOW_MS;
}

function parseConsoles(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

// ===== Meu Perfil (Leitura e Edição sem alterar o login) =====
router.get('/me/profile', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, display_name, avatar, birthday, consoles, created_at FROM users WHERE id::text = $1',
      [String(req.user.id)]
    );
    const u = result.rows[0];
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado.' });

    res.json({
      id: u.id,
      loginUsername: u.username,
      username: (u.display_name || '').trim() || u.username,
      avatar: u.avatar || '',
      birthday: u.birthday || '',
      consoles: parseConsoles(u.consoles),
      createdAt: Number(u.created_at || 0)
    });
  } catch (err) {
    console.error('Erro ao buscar meu perfil:', err);
    res.status(500).json({ error: 'Erro ao carregar dados do perfil.' });
  }
});

router.put('/me/profile', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const displayName = String(req.body.username || '').trim();
    const avatar = String(req.body.avatar || '').trim();
    const birthday = String(req.body.birthday || '').trim().slice(0, 20);
    const allowedConsoles = ['PS3', 'PS4', 'PS5', 'PC', 'Xbox', 'Switch'];
    const consoles = Array.isArray(req.body.consoles)
      ? req.body.consoles.filter(c => allowedConsoles.includes(c))
      : [];

    if (displayName.length < 2 || displayName.length > 30) {
      return res.status(400).json({ error: 'O nome de exibição deve ter entre 2 e 30 caracteres.' });
    }

    if (avatar.length > 450000) {
      return res.status(400).json({ error: 'A imagem escolhida é muito grande. Escolha uma menor.' });
    }

    const updateRes = await pool.query(
      `UPDATE users
       SET display_name = $1, avatar = $2, birthday = $3, consoles = $4
       WHERE id::text = $5
       RETURNING id, username, display_name, avatar, birthday, consoles`,
      [displayName, avatar, birthday, JSON.stringify(consoles), userId]
    );

    const updated = updateRes.rows[0];

    res.json({
      profile: {
        id: updated.id,
        loginUsername: updated.username,
        username: (updated.display_name || '').trim() || updated.username,
        avatar: updated.avatar || '',
        birthday: updated.birthday || '',
        consoles: parseConsoles(updated.consoles)
      }
    });
  } catch (err) {
    console.error('Erro ao salvar perfil:', err);
    res.status(500).json({ error: 'Erro ao atualizar perfil.' });
  }
});

// ===== Heartbeat de Status Online =====
router.post('/presence/ping', authMiddleware, async (req, res) => {
  try {
    const now = Date.now();
    await pool.query('UPDATE users SET last_seen = $1 WHERE id::text = $2', [now, String(req.user.id)]);
    const onlineRes = await pool.query(
      `SELECT id, COALESCE(NULLIF(display_name, ''), username) AS username
       FROM users WHERE last_seen >= $1 ORDER BY username ASC`,
      [now - ONLINE_WINDOW_MS]
    );
    res.json({
      onlineCount: onlineRes.rowCount,
      onlineUsers: onlineRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar presença.' });
  }
});

// ===== Ranking & Perfil Público =====
router.get('/ranking', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id,
        COALESCE(NULLIF(u.display_name, ''), u.username) AS username,
        u.avatar,
        u.consoles,
        u.last_seen,
        COUNT(g.id)::int AS total_games,
        COALESCE(SUM(g.hours), 0)::float AS total_hours,
        COUNT(CASE WHEN g.status = '100%' THEN 1 END)::int AS platinums,
        COUNT(CASE WHEN g.status IN ('Zerado', '100%') THEN 1 END)::int AS completed,
        (
          SELECT title FROM games
          WHERE user_id::text = u.id::text AND status = 'Jogando'
          ORDER BY added_at DESC LIMIT 1
        ) AS current_game
      FROM users u
      LEFT JOIN games g ON g.user_id::text = u.id::text
      GROUP BY u.id, u.username, u.display_name, u.avatar, u.consoles, u.last_seen
      ORDER BY total_hours DESC, platinums DESC, completed DESC, total_games DESC, username ASC
    `);
    res.json(result.rows.map(r => ({
      ...r,
      avatar: r.avatar || '',
      consoles: parseConsoles(r.consoles),
      online: isUserOnline(r.last_seen)
    })));
  } catch (err) {
    console.error('Erro ao carregar ranking:', err);
    res.status(500).json({ error: 'Erro ao carregar ranking.' });
  }
});

router.get('/users/:id/profile', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'ID inválido' });

    const userRes = await pool.query(
      `SELECT id, COALESCE(NULLIF(display_name, ''), username) AS username,
              avatar, birthday, consoles, created_at, last_seen
       FROM users WHERE id::text = $1`,
      [userId]
    );
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
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar || '',
        birthday: user.birthday || '',
        consoles: parseConsoles(user.consoles),
        createdAt: Number(user.created_at || 0),
        online: isUserOnline(user.last_seen)
      },
      stats,
      games: playerGames
    });
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    res.status(500).json({ error: 'Erro ao carregar perfil do jogador.' });
  }
});

// ===== Mural, Cores, Reações & Comentários =====
router.get('/posts', authMiddleware, async (req, res) => {
  try {
    const [postsRes, commentsRes, reactionsRes] = await Promise.all([
      pool.query(`
        SELECT p.id, p.user_id, COALESCE(NULLIF(u.display_name, ''), u.username) AS username,
               u.avatar, u.last_seen, p.title, p.content, p.category, p.color, p.created_at
        FROM community_posts p
        JOIN users u ON u.id::text = p.user_id::text
        ORDER BY p.created_at DESC
        LIMIT 60
      `),
      pool.query(`
        SELECT c.id, c.post_id, c.user_id, COALESCE(NULLIF(u.display_name, ''), u.username) AS username,
               u.last_seen, c.content, c.created_at
        FROM post_comments c
        JOIN users u ON u.id::text = c.user_id::text
        ORDER BY c.created_at ASC
      `),
      pool.query(`SELECT post_id, user_id, emoji FROM post_reactions`)
    ]);

    const commentsByPost = {};
    for (const c of commentsRes.rows) {
      if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
      commentsByPost[c.post_id].push({
        id: c.id,
        postId: c.post_id,
        userId: c.user_id,
        username: c.username,
        online: isUserOnline(c.last_seen),
        content: c.content,
        createdAt: Number(c.created_at)
      });
    }

    const reactionsByPost = {};
    const myId = String(req.user.id);
    for (const r of reactionsRes.rows) {
      if (!reactionsByPost[r.post_id]) reactionsByPost[r.post_id] = {};
      if (!reactionsByPost[r.post_id][r.emoji]) {
        reactionsByPost[r.post_id][r.emoji] = { count: 0, reacted: false };
      }
      reactionsByPost[r.post_id][r.emoji].count++;
      if (String(r.user_id) === myId) {
        reactionsByPost[r.post_id][r.emoji].reacted = true;
      }
    }

    const posts = postsRes.rows.map(p => ({
      id: p.id,
      userId: p.user_id,
      username: p.username,
      avatar: p.avatar || '',
      online: isUserOnline(p.last_seen),
      title: p.title,
      content: p.content,
      category: p.category || 'Geral',
      color: p.color || 'blue',
      createdAt: Number(p.created_at),
      reactions: reactionsByPost[p.id] || {},
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
    const allowedColors = ['blue', 'purple', 'emerald', 'gold', 'crimson', 'cyan'];
    const color = allowedColors.includes(req.body.color) ? req.body.color : 'blue';

    if (!title || !content) {
      return res.status(400).json({ error: 'Preencha o título e a mensagem da publicação.' });
    }

    const userRes = await pool.query(
      `SELECT COALESCE(NULLIF(display_name, ''), username) AS display FROM users WHERE id::text = $1`,
      [String(req.user.id)]
    );
    const authorName = userRes.rows[0]?.display || req.user.username;

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      `INSERT INTO community_posts (id, user_id, title, content, category, color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, String(req.user.id), title.slice(0, 120), content.slice(0, 2000), category, color, createdAt]
    );

    res.status(201).json({
      id,
      userId: req.user.id,
      username: authorName,
      online: true,
      title: title.slice(0, 120),
      content: content.slice(0, 2000),
      category,
      color,
      createdAt,
      reactions: {},
      comments: []
    });
  } catch (err) {
    console.error('Erro ao criar post:', err);
    res.status(500).json({ error: 'Erro ao publicar no mural.' });
  }
});

router.post('/posts/:id/react', authMiddleware, async (req, res) => {
  try {
    const allowed = ['🔥', '🏆', '❤️', '🎮', '😂'];
    const emoji = String(req.body.emoji || '').trim();
    if (!allowed.includes(emoji)) return res.status(400).json({ error: 'Emoji inválido.' });

    const postId = req.params.id;
    const userId = String(req.user.id);

    const existing = await pool.query(
      'SELECT 1 FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3',
      [postId, userId, emoji]
    );

    if (existing.rowCount > 0) {
      await pool.query(
        'DELETE FROM post_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3',
        [postId, userId, emoji]
      );
    } else {
      await pool.query(
        'INSERT INTO post_reactions (post_id, user_id, emoji) VALUES ($1, $2, $3)',
        [postId, userId, emoji]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao reagir:', err);
    res.status(500).json({ error: 'Erro ao registrar reação.' });
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

    const userRes = await pool.query(
      `SELECT COALESCE(NULLIF(display_name, ''), username) AS display FROM users WHERE id::text = $1`,
      [String(req.user.id)]
    );
    const authorName = userRes.rows[0]?.display || req.user.username;

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
      username: authorName,
      online: true,
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
        SELECT m.id, m.user_id, COALESCE(NULLIF(u.display_name, ''), u.username) AS username,
               u.avatar, u.last_seen, m.message, m.created_at
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
      avatar: r.avatar || '',
      online: isUserOnline(r.last_seen),
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

    const userRes = await pool.query(
      `SELECT COALESCE(NULLIF(display_name, ''), username) AS display FROM users WHERE id::text = $1`,
      [String(req.user.id)]
    );
    const authorName = userRes.rows[0]?.display || req.user.username;

    const id = genId();
    const createdAt = Date.now();
    await pool.query(
      'INSERT INTO chat_messages (id, user_id, message, created_at) VALUES ($1, $2, $3, $4)',
      [id, String(req.user.id), message.slice(0, 500), createdAt]
    );

    res.status(201).json({
      id,
      userId: req.user.id,
      username: authorName,
      online: true,
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

// ===== Lista de Jogadores do Chat (Online & Offline) =====
router.get('/chat/users', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        COALESCE(NULLIF(display_name, ''), username) AS username,
        avatar,
        last_seen
      FROM users
      ORDER BY
        CASE WHEN last_seen >= $1 THEN 0 ELSE 1 END ASC,
        username ASC
    `, [Date.now() - ONLINE_WINDOW_MS]);

    res.json(result.rows.map(u => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar || '',
      online: isUserOnline(u.last_seen)
    })));
  } catch (err) {
    console.error('Erro ao carregar usuários do chat:', err);
    res.status(500).json({ error: 'Erro ao carregar lista de jogadores.' });
  }
});

module.exports = router;