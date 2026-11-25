const express = require('express');
const { pool } = require('../db');
const { authMiddleware, genId } = require('../middleware/auth');

const router = express.Router();

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[™®©:–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildProfileGamesUrl(input) {
  let clean = String(input || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('Informe o link do seu perfil Steam ou SteamID64.');

  if (/^7656\d{13}$/.test(clean)) {
    return `https://steamcommunity.com/profiles/${clean}/games?tab=all`;
  }

  const profileMatch = clean.match(/steamcommunity\.com\/profiles\/(7656\d{13})/i);
  if (profileMatch) {
    return `https://steamcommunity.com/profiles/${profileMatch[1]}/games?tab=all`;
  }

  const idMatch = clean.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (idMatch) {
    return `https://steamcommunity.com/id/${encodeURIComponent(idMatch[1])}/games?tab=all`;
  }

  if (!clean.includes('/') && !clean.includes('.')) {
    return `https://steamcommunity.com/id/${encodeURIComponent(clean)}/games?tab=all`;
  }

  throw new Error('Link da Steam inválido. Use https://steamcommunity.com/id/seu_usuario ou /profiles/seu_id.');
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractGamesFromSteamHtml(html) {
  // 1) Formato moderno da Steam (data-profile-gameslist com JSON embutido)
  const attrMatch = html.match(/data-profile-gameslist="([^"]+)"/);
  if (attrMatch) {
    const parsed = JSON.parse(decodeHtmlEntities(attrMatch[1]));
    if (Array.isArray(parsed?.rgGames)) return parsed.rgGames;
  }

  // 2) Fallback para variável JS rgGames = [...]
  const varMatch = html.match(/var\s+rgGames\s*=\s*(\[[\s\S]*?\]);/);
  if (varMatch) {
    return JSON.parse(varMatch[1]);
  }

  return null;
}

router.post('/import/steam', authMiddleware, async (req, res) => {
  try {
    const targetUrl = buildProfileGamesUrl(req.body.steamInput);

    const pageRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
      }
    });

    if (!pageRes.ok) {
      throw new Error('Perfil Steam não encontrado. Verifique se o link está correto.');
    }

    const html = await pageRes.text();
    const gamesList = extractGamesFromSteamHtml(html);

    if (!Array.isArray(gamesList)) {
      return res.status(400).json({
        error: 'Não foi possível ler os jogos. Verifique se "Meu perfil" e "Detalhes dos jogos" estão definidos como PÚBLICO na privacidade da Steam.'
      });
    }

    if (gamesList.length === 0) {
      return res.status(400).json({
        error: 'Nenhum jogo encontrado neste perfil Steam (ou a lista de jogos está privada).'
      });
    }

    // Ordena do último jogado para o mais antigo
    const sortedGames = [...gamesList].sort((a, b) => {
      const ta = Number(a.last_played || 0);
      const tb = Number(b.last_played || 0);
      if (tb !== ta) return tb - ta;
      const ha = parseFloat(String(a.hours_forever || '0').replace(',', '.')) || 0;
      const hb = parseFloat(String(b.hours_forever || '0').replace(',', '.')) || 0;
      return hb - ha;
    });

    const existingRes = await pool.query(
      'SELECT id, title, platform, hours FROM games WHERE user_id::text = $1',
      [String(req.user.id)]
    );
    const existingMap = new Map();
    for (const row of existingRes.rows) {
      existingMap.set(`${normalizeTitleKey(row.title)}|${row.platform}`, row);
    }

    let imported = 0;
    let updatedHours = 0;
    let skipped = 0;
    const baseTimestamp = Date.now();

    for (let i = 0; i < sortedGames.length; i++) {
      const item = sortedGames[i];
      const rawTitle = String(item.name || '').trim();
      if (!rawTitle) continue;

      const platform = 'PC';
      const key = `${normalizeTitleKey(rawTitle)}|${platform}`;
      const rawHoursStr = String(item.hours_forever || '0').replace(/,/g, '');
      const hours = Math.round((parseFloat(rawHoursStr) || 0) * 10) / 10;

      const lastPlayedSec = Number(item.last_played || 0);
      const itemTimestamp = lastPlayedSec > 0
        ? lastPlayedSec * 1000
        : (baseTimestamp - (sortedGames.length + i) * 1000);

      if (existingMap.has(key)) {
        const existing = existingMap.get(key);
        const oldHours = Number(existing.hours || 0);
        const newHours = Math.max(hours, oldHours);

        await pool.query(
          'UPDATE games SET hours = $1, added_at = $2 WHERE id = $3',
          [newHours, itemTimestamp, existing.id]
        );

        if (hours > oldHours) {
          updatedHours++;
        } else {
          skipped++;
        }
        continue;
      }

      const status = hours > 0 ? 'Jogando' : 'Não iniciado';
      const cover = item.appid
        ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/header.jpg`
        : '';
      const id = genId();

      await pool.query(
        `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, String(req.user.id), rawTitle, platform, '', status, null, hours, cover, 'Importado da Steam', itemTimestamp]
      );

      existingMap.set(key, { id, title: rawTitle, platform, hours });
      imported++;
    }

    res.json({ imported, updatedHours, skipped, totalFound: sortedGames.length });
  } catch (err) {
    console.error('Erro ao importar Steam (público):', err);
    res.status(500).json({
      error: err?.message || 'Falha ao importar da Steam. Verifique se o perfil está público.'
    });
  }
});

module.exports = router;