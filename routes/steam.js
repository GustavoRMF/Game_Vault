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

// Aceita SteamID64 direto (17 dígitos), link /profiles/7656... ou link /id/apelido ou apenas o apelido
async function resolveSteamId64(input, apiKey) {
  let clean = String(input || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('Informe o link do seu perfil Steam ou SteamID64.');

  // Caso 1: Já é SteamID64 direto (17 números começando com 7656)
  if (/^7656\d{13}$/.test(clean)) {
    return clean;
  }

  // Caso 2: URL com /profiles/76561198...
  const profileMatch = clean.match(/steamcommunity\.com\/profiles\/(7656\d{13})/i);
  if (profileMatch) {
    return profileMatch[1];
  }

  // Caso 3: URL com /id/custom_url ou apenas o nome personalizado digitado
  let vanity = clean;
  const idMatch = clean.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (idMatch) {
    vanity = idMatch[1];
  } else if (clean.includes('/')) {
    throw new Error('Link da Steam inválido. Use https://steamcommunity.com/id/seu_usuario ou /profiles/seu_id.');
  }

  const res = await fetch(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(vanity)}`
  );
  if (!res.ok) throw new Error('Erro ao consultar o perfil na API da Steam.');

  const data = await res.json();
  if (data?.response?.success === 1 && data?.response?.steamid) {
    return data.response.steamid;
  }

  throw new Error('Perfil Steam não encontrado. Verifique se o link ou ID está correto.');
}

// Verifica se o jogador conquistou 100% dos troféus/conquistas do jogo na Steam
async function checkSteam100Percent(steamId, appId, apiKey) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appId}&key=${encodeURIComponent(apiKey)}&steamid=${steamId}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    const list = data?.playerstats?.achievements;
    if (!Array.isArray(list) || list.length === 0) return false;
    return list.every(a => Number(a.achieved) === 1);
  } catch {
    return false;
  }
}

router.post('/import/steam', authMiddleware, async (req, res) => {
  try {
    const apiKey = (process.env.STEAM_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(500).json({
        error: 'Configure a variável STEAM_API_KEY no servidor (Render) para habilitar a sincronização.'
      });
    }

    const steamId = await resolveSteamId64(req.body.steamInput, apiKey);

    // Busca biblioteca completa com horas totais e última vez jogado (rtime_last_played)
    const ownedUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`;
    const ownedRes = await fetch(ownedUrl);
    if (!ownedRes.ok) {
      throw new Error(`A Steam retornou erro ${ownedRes.status}. Tente novamente.`);
    }

    const ownedData = await ownedRes.json();
    const gamesList = ownedData?.response?.games;

    if (!Array.isArray(gamesList)) {
      return res.status(400).json({
        error: 'Não foi possível ler os jogos. Verifique se "Detalhes dos jogos" está definido como PÚBLICO na privacidade da sua Steam.'
      });
    }

    if (gamesList.length === 0) {
      return res.status(400).json({
        error: 'Nenhum jogo encontrado ou a lista de jogos do perfil Steam está privada.'
      });
    }

    // Ordena do mais recentemente jogado para o mais antigo (igual à PSN)
    const sortedGames = [...gamesList].sort((a, b) => {
      const ta = Number(a.rtime_last_played || 0);
      const tb = Number(b.rtime_last_played || 0);
      if (tb !== ta) return tb - ta;
      return Number(b.playtime_forever || 0) - Number(a.playtime_forever || 0);
    });

    const existingRes = await pool.query(
      'SELECT id, title, platform, hours, status FROM games WHERE user_id::text = $1',
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
      // Converte minutos da Steam para horas com 1 casa decimal
      const hours = Math.round(((Number(item.playtime_forever || 0)) / 60) * 10) / 10;

      // rtime_last_played vem em segundos Unix; se 0 (nunca jogado), preserva ordem decrescente no fim
      const lastPlayedSec = Number(item.rtime_last_played || 0);
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

      let status = hours > 0 ? 'Jogando' : 'Não iniciado';
      // Checa 100% de conquistas apenas nos 40 jogos jogados mais recentemente para manter a resposta rápida
      if (hours > 0 && i < 40) {
        const is100 = await checkSteam100Percent(steamId, item.appid, apiKey);
        if (is100) status = '100%';
      }

      const cover = item.appid
        ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appid}/header.jpg`
        : '';
      const id = genId();

      await pool.query(
        `INSERT INTO games (id, user_id, title, platform, genre, status, rating, hours, cover, notes, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, String(req.user.id), rawTitle, platform, '', status, null, hours, cover, 'Importado da Steam', itemTimestamp]
      );

      existingMap.set(key, { id, title: rawTitle, platform, hours, status });
      imported++;
    }

    res.json({ imported, updatedHours, skipped, totalFound: sortedGames.length });
  } catch (err) {
    console.error('Erro ao importar Steam:', err);
    res.status(500).json({
      error: err?.message || 'Falha ao conectar na Steam. Verifique o link do perfil e tente novamente.'
    });
  }
});

module.exports = router;