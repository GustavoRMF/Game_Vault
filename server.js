const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Conexão com o PostgreSQL do Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Cria a tabela automaticamente no Neon se ainda não existir
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id VARCHAR(64) PRIMARY KEY,
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
  console.log('Banco de dados Neon conectado e tabela verificada.');
}

// Listar todos os jogos
app.get('/api/games', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM games ORDER BY added_at DESC');
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
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar jogos' });
  }
});

// Adicionar novo jogo
app.post('/api/games', async (req, res) => {
  const { id, title, platform, genre, status, rating, hours, cover, notes, addedAt } = req.body;
  if (!id || !title || !platform || !status) {
    return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
  }
  try {
    await pool.query(
      `INSERT INTO games (id, title, platform, genre, status, rating, hours, cover, notes, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, title, platform, genre || '', status, rating ?? null, hours || 0, cover || '', notes || '', addedAt || Date.now()]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar jogo' });
  }
});

// Importação em lote (Backup JSON)
app.post('/api/games/bulk', async (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Formato inválido' });

  let importedCount = 0;
  try {
    for (const g of list) {
      if (!g.id || !g.title || !g.platform) continue;
      const result = await pool.query(
        `INSERT INTO games (id, title, platform, genre, status, rating, hours, cover, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [g.id, g.title, g.platform, g.genre || '', g.status || 'Não iniciado', g.rating ?? null, g.hours || 0, g.cover || '', g.notes || '', g.addedAt || Date.now()]
      );
      importedCount += result.rowCount;
    }
    res.json({ imported: importedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro na importação' });
  }
});

// Atualizar jogo
app.put('/api/games/:id', async (req, res) => {
  const { title, platform, genre, status, rating, hours, cover, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE games
       SET title = $1, platform = $2, genre = $3, status = $4, rating = $5, hours = $6, cover = $7, notes = $8
       WHERE id = $9`,
      [title, platform, genre || '', status, rating ?? null, hours || 0, cover || '', notes || '', req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Jogo não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar jogo' });
  }
});

// Excluir jogo
app.delete('/api/games/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM games WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir jogo' });
  }
});

// Cache simples do token da Twitch em memória
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

// Proxy seguro para buscar capa na API IGDB
app.get('/api/cover', async (req, res) => {
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

    // Monta a URL da capa em alta qualidade (t_cover_big ou t_720p)
    const cover = imageId ? `https://images.igdb.com/igdb/image/upload/t_720p/${imageId}.jpg` : null;
    res.json({ cover });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erro ao consultar IGDB' });
  }
});

// Inicializa o banco de dados e sobe o servidor
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`GameVault rodando na porta ${PORT}`));
  })
  .catch((err) => {
    console.error('Falha ao iniciar banco de dados:', err);
    process.exit(1);
  });