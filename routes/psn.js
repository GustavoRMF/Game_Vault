const express = require('express');
const psn = require('psn-api');
const { pool } = require('../db');
const { authMiddleware, genId } = require('../middleware/auth');

const router = express.Router();

function parsePsnDurationHours(duration) {
  if (duration === null || duration === undefined) return 0;

  if (typeof duration === 'number' && Number.isFinite(duration)) {
    return Math.round((duration / 3600) * 10) / 10;
  }

  const str = String(duration).trim();
  if (!str) return 0;

  if (/^\d+(\.\d+)?$/.test(str)) {
    return Math.round((Number(str) / 3600) * 10) / 10;
  }

  const match = str.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?/i);
  if (!match) return 0;

  const d = Number(match[1] || 0);
  const h = Number(match[2] || 0);
  const m = Number(match[3] || 0);
  const s = Number(match[4] || 0);
  const totalHours = d * 24 + h + m / 60 + s / 3600;
  return Math.round(totalHours * 10) / 10;
}

function mapPsnPlatform(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('ps5')) return 'PS5';
  if (c.includes('ps4')) return 'PS4';
  if (c.includes('ps3')) return 'PS3';
  return 'PS4';
}

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[™®©:–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

router.post('/import/psn', authMiddleware, async (req, res) => {
  try {
    let rawInput = String(req.body.npsso || '').trim();

    if (rawInput.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawInput);
        if (parsed.npsso) rawInput = String(parsed.npsso).trim();
      } catch {
        const match = rawInput.match(/"npsso"\s*:\s*"([^"]+)"/);
        if (match) rawInput = match[1].trim();
      }
    }

    const npsso = rawInput.replace(/^["']|["']$/g, '').trim();
    if (npsso.length < 30) {
      return res.status(400).json({ error: 'Token NPSSO inválido. Cole o texto retornado pela Sony.' });
    }

    const accessCode = await psn.exchangeNpssoForAccessCode(npsso);
    const authorization = await psn.exchangeAccessCodeForAuthTokens(accessCode);

    const [playedRes, trophyRes] = await Promise.all([
      psn.getUserPlayedGames(authorization, 'me', { limit: 200 }),
      psn.getUserTitles(authorization, 'me', { limit: 200 }).catch(() => ({ trophyTitles: [] }))
    ]);

    const playedTitles = Array.isArray(playedRes?.titles) ? [...playedRes.titles] : [];
    const trophyMap = new Map();
    for (const t of trophyRes?.trophyTitles || []) {
      trophyMap.set(normalizeTitleKey(t.trophyTitleName), t);
    }

    const existingRes = await pool.query(
      'SELECT id, title, platform, hours FROM games WHERE user_id::text = $1',
      [String(req.user.id)]
    );
    const existingMap = new Map();
    for (const row of existingRes.rows) {
      existingMap.set(`${normalizeTitleKey(row.title)}|${row.platform}`, row);
    }

    playedTitles.sort((a, b) => {
      const ta = a.lastPlayedDateTime ? Date.parse(a.lastPlayedDateTime) : 0;
      const tb = b.lastPlayedDateTime ? Date.parse(b.lastPlayedDateTime) : 0;
      return tb - ta;
    });

    let imported = 0;
    let skipped = 0;
    let updatedHours = 0;
    const baseTimestamp = Date.now();

    for (let i = 0; i < playedTitles.length; i++) {
      const item = playedTitles[i];
      const rawTitle = String(item.name || '').trim();
      if (!rawTitle) continue;

      const platform = mapPsnPlatform(item.category);
      const key = `${normalizeTitleKey(rawTitle)}|${platform}`;
      const hours = parsePsnDurationHours(item.playDuration);
      const lastPlayedTs = item.lastPlayedDateTime ? Date.parse(item.lastPlayedDateTime) : 0;
      const itemTimestamp = lastPlayedTs > 0 ? lastPlayedTs : (baseTimestamp - i * 1000);

      if (existingMap.has(key)) {
        const existing = existingMap.get(key);
        const newHours = Math.max(hours, Number(existing.hours || 0));
        await pool.query(
          'UPDATE games SET hours = $1, added_at = $2 WHERE id = $3',
          [newHours, itemTimestamp, existing.id]
        );
        if (hours > Number(existing.hours || 0)) {
          updatedHours++;
        } else {
          skipped++;
        }
        continue;
      }

      const trophyInfo = trophyMap.get(normalizeTitleKey(rawTitle));
      let status = hours > 0 ? 'Jogando' : 'Não iniciado';
      if (trophyInfo) {
        if (trophyInfo.progress === 100 || (trophyInfo.earnedTrophies?.platinum || 0) > 0) {
          status = '100%';
        } else if ((trophyInfo.progress || 0) > 0 || hours > 0) {
          status = 'Jogando';
        }
      }

      const cover = item.imageUrl || trophyInfo?.trophyTitleIconUrl || '';
      const id = genId();

      await pool.query(
        `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, String(req.user.id), rawTitle, platform, '', status, null, hours, cover, 'Importado da PSN', itemTimestamp]
      );

      existingMap.set(key, { id, title: rawTitle, platform, hours });
      imported++;
    }

    res.json({ imported, skipped, updatedHours, totalFound: playedTitles.length });
  } catch (err) {
    console.error('Erro ao importar PSN:', err);
    const detail = err?.message ? ` (${err.message})` : '';
    res.status(500).json({
      error: `Falha ao conectar na PSN${detail}. Gere um novo código NPSSO na aba logada e tente novamente.`
    });
  }
});

module.exports = router;