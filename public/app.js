// ========================================
// GameVault - Biblioteca, Ranking & Core (Multi-User)
// ========================================

let games = [];
let editingId = null;
let deferredPrompt = null;
let charts = { platforms: null, status: null };
let authMode = 'login'; // 'login' | 'register' | 'forgot'
let currentUser = null;
let authToken = null;

// ===== Autenticação & Sessão =====
function loadSession() {
  try {
    authToken = localStorage.getItem('gv_token');
    const savedUser = localStorage.getItem('gv_user');
    currentUser = savedUser ? JSON.parse(savedUser) : null;
  } catch {
    authToken = null;
    currentUser = null;
  }
}

function saveSession(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem('gv_token', token);
  localStorage.setItem('gv_user', JSON.stringify(user));
}

function clearSession() {
  authToken = null;
  currentUser = null;
  games = [];
  if (typeof wishlist !== 'undefined') wishlist = [];
  if (typeof stopChatPolling === 'function') stopChatPolling();
  localStorage.removeItem('gv_token');
  localStorage.removeItem('gv_user');
  renderHeaderCovers();
}

async function apiFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    updateAuthUI();
    showToast('Sessão expirada. Faça login novamente.');
    throw new Error('Sessão expirada');
  }
  return res;
}

function updateAuthUI() {
  const authWrapper = document.getElementById('auth-wrapper');
  const appContent = document.getElementById('app-content');
  const userBar = document.getElementById('user-bar');

  if (authToken && currentUser) {
    authWrapper.classList.add('hidden');
    appContent.classList.remove('hidden');
    userBar.classList.remove('hidden');
    document.getElementById('current-username').textContent = currentUser.username;
  } else {
    authWrapper.classList.remove('hidden');
    appContent.classList.add('hidden');
    userBar.classList.add('hidden');
  }
}

function switchAuthMode(mode) {
  authMode = mode;

  document.querySelectorAll('.auth-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.auth === mode);
  });

  const titleEl = document.getElementById('auth-title');
  const subEl = document.getElementById('auth-subtitle');
  const submitBtn = document.getElementById('auth-submit-btn');
  const authForm = document.getElementById('auth-form');
  const forgotForm = document.getElementById('forgot-form');
  const ruleBadge = document.getElementById('password-rule-badge');
  const registerTip = document.getElementById('register-tip');
  const forgotLinkBox = document.getElementById('forgot-link-box');

  if (mode === 'forgot') {
    authForm.classList.add('hidden');
    forgotForm.classList.remove('hidden');
    titleEl.textContent = 'Recuperar Senha';
    subEl.textContent = 'Informe seu usuário e os 3 primeiros dígitos da senha cadastrada para criar uma nova.';
    return;
  }

  forgotForm.classList.add('hidden');
  authForm.classList.remove('hidden');

  if (mode === 'login') {
    titleEl.textContent = 'Entrar no GameVault';
    subEl.textContent = 'Acesse sua biblioteca e dispute o topo do ranking de horas jogadas.';
    submitBtn.textContent = 'Entrar na Conta';
    ruleBadge.classList.add('hidden');
    registerTip.classList.add('hidden');
    forgotLinkBox.classList.remove('hidden');
  } else {
    titleEl.textContent = 'Criar Nova Conta';
    subEl.textContent = 'Cadastre seu usuário com uma senha de no mínimo 8 dígitos.';
    submitBtn.textContent = 'Cadastrar e Entrar';
    ruleBadge.classList.remove('hidden');
    registerTip.classList.remove('hidden');
    forgotLinkBox.classList.add('hidden');
  }
}

document.querySelectorAll('.auth-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchAuthMode(btn.dataset.auth));
});

document.getElementById('open-forgot-btn').addEventListener('click', () => {
  const typedUser = document.getElementById('auth-username').value.trim();
  if (typedUser) document.getElementById('forgot-username').value = typedUser;
  switchAuthMode('forgot');
});

document.getElementById('back-to-login-btn').addEventListener('click', () => {
  switchAuthMode('login');
});

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const submitBtn = document.getElementById('auth-submit-btn');

  if (authMode === 'register' && password.length < 8) {
    showToast('A senha deve ter no mínimo 8 dígitos.');
    return;
  }

  submitBtn.disabled = true;
  try {
    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro de autenticação');

    saveSession(data.token, data.user);
    document.getElementById('auth-form').reset();
    updateAuthUI();

    await loadGames();
    render();
    if (typeof loadWishlist === 'function') {
      await loadWishlist();
      renderWishlist();
    }

    showToast(authMode === 'login' ? `Bem-vindo de volta, ${data.user.username}!` : `Conta criada! Bem-vindo, ${data.user.username}!`);
  } catch (err) {
    showToast(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('forgot-username').value.trim();
  const firstThree = document.getElementById('forgot-first-three').value;
  const newPassword = document.getElementById('forgot-new-password').value;
  const submitBtn = document.getElementById('forgot-submit-btn');

  if (firstThree.length !== 3) {
    showToast('Digite exatamente os 3 primeiros dígitos da senha cadastrada.');
    return;
  }
  if (newPassword.length < 8) {
    showToast('A nova senha deve ter no mínimo 8 dígitos.');
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, firstThree, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao redefinir senha');

    saveSession(data.token, data.user);
    document.getElementById('forgot-form').reset();
    switchAuthMode('login');
    updateAuthUI();

    await loadGames();
    render();
    if (typeof loadWishlist === 'function') {
      await loadWishlist();
      renderWishlist();
    }

    showToast(`Senha redefinida com sucesso! Bem-vindo, ${data.user.username}!`);
  } catch (err) {
    showToast(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearSession();
  resetForm();
  if (typeof resetWishForm === 'function') resetWishForm();
  switchAuthMode('login');
  updateAuthUI();
  showToast('Você saiu da conta.');
});

// ===== Carrossel de Capas no Cabeçalho =====
function renderHeaderCovers() {
  const container = document.getElementById('header-covers-bg');
  if (!container) return;

  const wishArr = typeof wishlist !== 'undefined' && Array.isArray(wishlist) ? wishlist : [];
  const allItems = [...games, ...wishArr];

  const uniqueCovers = [];
  const seen = new Set();

  for (const item of allItems) {
    const safe = sanitizeUrl(item.cover);
    if (safe && !seen.has(safe)) {
      seen.add(safe);
      uniqueCovers.push({ cover: safe, title: item.title || '' });
    }
  }

  if (uniqueCovers.length === 0) {
    container.innerHTML = '';
    return;
  }

  let baseList = [...uniqueCovers];
  while (baseList.length < 12) {
    baseList = baseList.concat(uniqueCovers);
  }

  const loopList = [...baseList, ...baseList];
  const durationSeconds = Math.max(24, baseList.length * 3.2);

  container.innerHTML = `
    <div class="header-covers-track" style="--marquee-duration: ${durationSeconds}s;">
      ${loopList.map(c => `<img class="header-cover-item" src="${escapeHtml(c.cover)}" alt="" loading="lazy" onerror="this.style.display='none'">`).join('')}
    </div>
  `;
}

// ===== Persistência Biblioteca (API + PostgreSQL Neon) =====
async function loadGames() {
  if (!authToken) return;
  try {
    const res = await apiFetch('/api/games');
    if (!res.ok) throw new Error('Falha ao carregar biblioteca');
    games = await res.json();
  } catch (e) {
    console.error(e);
    if (e.message !== 'Sessão expirada') showToast('Erro ao conectar com o servidor.');
    games = [];
  }
}

// ===== Ranking & Competição =====
async function loadRanking() {
  const podiumEl = document.getElementById('ranking-podium');
  const listEl = document.getElementById('ranking-list');
  podiumEl.innerHTML = '<p class="empty-msg">Carregando ranking...</p>';
  listEl.innerHTML = '';

  try {
    const res = await apiFetch('/api/ranking');
    if (!res.ok) throw new Error('Erro ao carregar ranking');
    const ranking = await res.json();

    if (!ranking.length) {
      podiumEl.innerHTML = '<p class="empty-msg">Nenhum jogador registrado ainda.</p>';
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    const top3 = ranking.slice(0, 3);

    podiumEl.innerHTML = top3.map((player, idx) => {
      const isMe = currentUser && String(player.id) === String(currentUser.id);
      return `
        <div class="podium-card podium-${idx + 1} clickable-player" data-user-id="${escapeHtml(String(player.id))}">
          <div class="podium-medal">${medals[idx]}</div>
          <div class="podium-name">${escapeHtml(player.username)} ${isMe ? '(Você)' : ''}</div>
          <div class="podium-hours">${Number(player.total_hours).toFixed(1)}h</div>
          <div class="podium-sub">
            🎮 ${player.total_games} jogos • 🏆 ${player.platinums} platinas • ✅ ${player.completed} zerados
          </div>
          <div class="podium-sub" style="color:#38bdf8; margin-top:8px;">👁️ Ver biblioteca</div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = ranking.map((player, idx) => {
      const isMe = currentUser && String(player.id) === String(currentUser.id);
      const posLabel = idx < 3 ? medals[idx] : `#${idx + 1}`;
      return `
        <div class="rank-row ${isMe ? 'is-me' : ''} clickable-player" data-user-id="${escapeHtml(String(player.id))}">
          <div class="rank-left">
            <span class="rank-pos">${posLabel}</span>
            <span class="rank-user">${escapeHtml(player.username)} ${isMe ? '<span class="badge status-Jogando">Você</span>' : ''}</span>
          </div>
          <div class="rank-stats">
            <span class="badge">⏱ ${Number(player.total_hours).toFixed(1)}h</span>
            <span class="badge rating">🏆 ${player.platinums} 100%</span>
            <span class="badge status-Zerado">✅ ${player.completed} zerados</span>
            <span class="badge">📚 ${player.total_games} jogos</span>
            <span class="badge" style="color:#38bdf8;">👁️ Ver jogos</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    if (err.message !== 'Sessão expirada') {
      podiumEl.innerHTML = '<p class="empty-msg">Não foi possível carregar o ranking agora.</p>';
      showToast(err.message);
    }
  }
}

document.getElementById('refresh-ranking-btn').addEventListener('click', () => {
  loadRanking();
  showToast('Ranking atualizado!');
});

document.getElementById('tab-ranking').addEventListener('click', (e) => {
  const playerEl = e.target.closest('[data-user-id]');
  if (playerEl && typeof openPlayerProfile === 'function') {
    openPlayerProfile(playerEl.dataset.userId);
  }
});

// ===== Helpers Globais =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function statusClass(status) {
  if (status === '100%') return 'status-100';
  if (status === 'Não iniciado') return 'status-Nao';
  return `status-${status}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ===== CRUD Biblioteca =====
async function addGame(data) {
  const game = { id: generateId(), ...data, addedAt: Date.now() };
  const res = await apiFetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game)
  });
  if (!res.ok) throw new Error('Erro ao salvar');
  const saved = await res.json();
  if (saved.id) game.id = saved.id;
  games.unshift(game);
  return game;
}

async function updateGame(id, data) {
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) return false;
  const res = await apiFetch(`/api/games/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Erro ao atualizar');
  games[idx] = { ...games[idx], ...data };
  return true;
}

async function deleteGame(id) {
  if (!confirm('Excluir este jogo?')) return;
  try {
    const res = await apiFetch(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erro ao excluir');
    games = games.filter(g => g.id !== id);
    if (editingId === id) resetForm();
    render();
    showToast('Jogo excluído.');
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  }
}

function getGame(id) {
  return games.find(g => g.id === id);
}

// ===== Backup / Restore =====
function exportBackup() {
  if (games.length === 0) {
    showToast('Nada para exportar.');
    return;
  }
  const blob = new Blob([JSON.stringify(games, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gamevault-${currentUser?.username || 'backup'}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup exportado!');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Formato inválido');
      const valid = imported.filter(g => g && g.title && g.platform);
      if (valid.length === 0) throw new Error('Nenhum jogo válido');

      const res = await apiFetch('/api/games/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valid)
      });
      if (!res.ok) throw new Error('Falha ao importar no servidor');
      const { imported: count } = await res.json();

      if (count === 0) {
        showToast('Todos os jogos já existem.');
        return;
      }

      await loadGames();
      render();
      document.getElementById('backup-status').textContent = `✅ ${count} jogo(s) importado(s)`;
      showToast(`${count} jogo(s) importado(s)!`);
    } catch (err) {
      if (err.message !== 'Sessão expirada') showToast('Erro ao importar: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ===== IGDB API (Capa & Autocomplete reutilizável) =====
async function fetchCoverToFields(title, btnId, coverInputId) {
  if (!title.trim()) {
    showToast('Digite um título primeiro.');
    return;
  }

  const btn = document.getElementById(btnId);
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    const res = await apiFetch(`/api/cover?title=${encodeURIComponent(title)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro na API');

    if (data.cover) {
      document.getElementById(coverInputId).value = data.cover;
      showToast('Capa encontrada!');
    } else {
      showToast('Jogo não encontrado ou sem capa.');
    }
  } catch (e) {
    if (e.message !== 'Sessão expirada') showToast('Erro ao buscar capa: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍';
  }
}

function setupGameAutocomplete({ inputId, dropdownId, coverId, genreId }) {
  const inputEl = document.getElementById(inputId);
  const boxEl = document.getElementById(dropdownId);
  if (!inputEl || !boxEl) return;

  let debounceTimer = null;
  let suggestions = [];

  inputEl.addEventListener('input', () => {
    const query = inputEl.value.trim();
    clearTimeout(debounceTimer);

    if (query.length < 2) {
      boxEl.classList.add('hidden');
      boxEl.innerHTML = '';
      return;
    }

    boxEl.classList.remove('hidden');
    boxEl.innerHTML = '<div class="suggestion-status">🔍 Buscando jogos na IGDB...</div>';

    debounceTimer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/games/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Erro na busca');
        suggestions = await res.json();

        if (!suggestions.length) {
          boxEl.innerHTML = '<div class="suggestion-status">Nenhum jogo encontrado com esse nome.</div>';
          return;
        }

        boxEl.innerHTML = suggestions.map((item, idx) => `
          <div class="suggestion-item" data-index="${idx}">
            ${item.thumb
              ? `<img class="suggestion-thumb" src="${escapeHtml(item.thumb)}" alt="">`
              : `<div class="suggestion-thumb"></div>`}
            <div class="suggestion-info">
              <span class="suggestion-name">${escapeHtml(item.name)}</span>
              <span class="suggestion-meta">
                ${item.year ? `📅 ${item.year}` : ''} ${item.genre ? `• 🎮 ${escapeHtml(item.genre)}` : ''}
              </span>
            </div>
          </div>
        `).join('');
      } catch (err) {
        if (err.message !== 'Sessão expirada') {
          boxEl.innerHTML = '<div class="suggestion-status">Erro ao buscar sugestões.</div>';
        }
      }
    }, 400);
  });

  boxEl.addEventListener('click', (e) => {
    const itemEl = e.target.closest('.suggestion-item');
    if (!itemEl) return;

    const selected = suggestions[Number(itemEl.dataset.index)];
    if (!selected) return;

    inputEl.value = selected.name;
    if (selected.cover) document.getElementById(coverId).value = selected.cover;
    const genreInput = document.getElementById(genreId);
    if (selected.genre && genreInput && !genreInput.value.trim()) {
      genreInput.value = selected.genre;
    }

    boxEl.classList.add('hidden');
    showToast(`Selecionado: ${selected.name}`);
  });
}

setupGameAutocomplete({
  inputId: 'title',
  dropdownId: 'title-suggestions',
  coverId: 'cover',
  genreId: 'genre'
});

setupGameAutocomplete({
  inputId: 'wish-title',
  dropdownId: 'wish-suggestions',
  coverId: 'wish-cover',
  genreId: 'wish-genre'
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.autocomplete-wrapper')) {
    document.querySelectorAll('.suggestions-dropdown').forEach(el => el.classList.add('hidden'));
  }
});

// ===== Gráficos =====
function renderCharts() {
  if (typeof Chart === 'undefined') return;

  const platformCount = { PS3: 0, PS4: 0, PS5: 0, PC: 0 };
  const statusCount = { 'Não iniciado': 0, 'Jogando': 0, 'Zerado': 0, '100%': 0, 'Abandonado': 0 };
  games.forEach(g => {
    if (platformCount[g.platform] !== undefined) platformCount[g.platform]++;
    if (statusCount[g.status] !== undefined) statusCount[g.status]++;
  });

  const colors = ['#003791', '#0070d1', '#0057ff', '#107c10'];
  const ctxP = document.getElementById('chart-platforms');
  if (charts.platforms) charts.platforms.destroy();
  charts.platforms = new Chart(ctxP, {
    type: 'doughnut',
    data: {
      labels: Object.keys(platformCount),
      datasets: [{ data: Object.values(platformCount), backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#eaeaea', padding: 12 } } }
    }
  });

  const statusColors = ['#9ca3af', '#4ade80', '#60a5fa', '#facc15', '#f87171'];
  const ctxS = document.getElementById('chart-status');
  if (charts.status) charts.status.destroy();
  charts.status = new Chart(ctxS, {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusCount),
      datasets: [{ data: Object.values(statusCount), backgroundColor: statusColors, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#eaeaea', padding: 12 } } }
    }
  });
}

// ===== Renderização Biblioteca =====
function getFilteredGames() {
  const search = document.getElementById('search').value.toLowerCase().trim();
  const platform = document.getElementById('filter-platform').value;
  const status = document.getElementById('filter-status').value;
  const sortBy = document.getElementById('sort-by').value;

  let filtered = games.filter(g => {
    if (search && !g.title.toLowerCase().includes(search)) return false;
    if (platform && g.platform !== platform) return false;
    if (status && g.status !== status) return false;
    return true;
  });

  const sorters = {
    'added-desc': (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    'added-asc': (a, b) => (a.addedAt || 0) - (b.addedAt || 0),
    'title-asc': (a, b) => a.title.localeCompare(b.title),
    'title-desc': (a, b) => b.title.localeCompare(a.title),
    'rating-desc': (a, b) => (b.rating || 0) - (a.rating || 0),
    'hours-desc': (a, b) => (b.hours || 0) - (a.hours || 0),
  };
  return filtered.sort(sorters[sortBy] || sorters['added-desc']);
}

function renderStats() {
  const total = games.length;
  const byPlatform = { PS3: 0, PS4: 0, PS5: 0, PC: 0 };
  const byStatus = { 'Jogando': 0, 'Zerado': 0, '100%': 0 };
  let totalHours = 0;
  games.forEach(g => {
    if (byPlatform[g.platform] !== undefined) byPlatform[g.platform]++;
    if (byStatus[g.status] !== undefined) byStatus[g.status]++;
    totalHours += parseFloat(g.hours) || 0;
  });

  document.getElementById('stats').innerHTML = `
    <div class="stat-card"><div class="value">${total}</div><div class="label">Total</div></div>
    <div class="stat-card"><div class="value">${byPlatform.PS3}</div><div class="label">PS3</div></div>
    <div class="stat-card"><div class="value">${byPlatform.PS4}</div><div class="label">PS4</div></div>
    <div class="stat-card"><div class="value">${byPlatform.PS5}</div><div class="label">PS5</div></div>
    <div class="stat-card"><div class="value">${byPlatform.PC}</div><div class="label">PC</div></div>
    <div class="stat-card"><div class="value">${byStatus['Jogando']}</div><div class="label">Jogando</div></div>
    <div class="stat-card"><div class="value">${byStatus['Zerado'] + byStatus['100%']}</div><div class="label">Concluídos</div></div>
    <div class="stat-card"><div class="value">${totalHours.toFixed(1)}h</div><div class="label">Horas totais</div></div>
  `;
}

function renderGames() {
  const listEl = document.getElementById('games-list');
  const emptyMsg = document.getElementById('empty-msg');
  const countEl = document.getElementById('game-count');
  const filtered = getFilteredGames();

  countEl.textContent = `(${filtered.length}${filtered.length !== games.length ? ' de ' + games.length : ''})`;

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    emptyMsg.textContent = games.length === 0
      ? 'Nenhum jogo cadastrado ainda. Adicione seu primeiro jogo! 🎮'
      : 'Nenhum jogo encontrado com esses filtros. 🔍';
    return;
  }
  emptyMsg.classList.add('hidden');

  listEl.innerHTML = filtered.map(game => {
    const safeCover = sanitizeUrl(game.cover);
    const safePlatform = escapeHtml(game.platform);
    return `
      <div class="game-card">
        ${safeCover ? `<img class="game-cover" src="${escapeHtml(safeCover)}" alt="${escapeHtml(game.title)}" onerror="this.style.display='none'">` : ''}
        <div class="game-header">
          <span class="game-title">${escapeHtml(game.title)}</span>
          <span class="platform-badge platform-${safePlatform}">${safePlatform}</span>
        </div>
        <div class="game-meta">
          <span class="badge ${statusClass(game.status)}">${escapeHtml(game.status)}</span>
          ${game.genre ? `<span class="badge">${escapeHtml(game.genre)}</span>` : ''}
          ${game.rating !== null && game.rating !== undefined ? `<span class="badge rating">★ ${game.rating}/10</span>` : ''}
          ${game.hours ? `<span class="badge">⏱ ${game.hours}h</span>` : ''}
        </div>
        ${game.notes ? `<div class="game-notes">${escapeHtml(game.notes)}</div>` : ''}
        <div class="game-actions">
          <button type="button" class="btn-edit" data-action="edit" data-id="${escapeHtml(game.id)}">✏️ Editar</button>
          <button type="button" class="btn-delete" data-action="delete" data-id="${escapeHtml(game.id)}">🗑️ Excluir</button>
        </div>
      </div>
    `;
  }).join('');
}

function render() {
  renderStats();
  renderCharts();
  renderGames();
  renderHeaderCovers();
}

// ===== Formulário Biblioteca =====
function getFormData() {
  return {
    title: document.getElementById('title').value.trim(),
    platform: document.getElementById('platform').value,
    genre: document.getElementById('genre').value.trim(),
    status: document.getElementById('status').value,
    rating: document.getElementById('rating').value !== '' ? parseFloat(document.getElementById('rating').value) : null,
    hours: document.getElementById('hours').value !== '' ? parseFloat(document.getElementById('hours').value) : 0,
    cover: sanitizeUrl(document.getElementById('cover').value.trim()),
    notes: document.getElementById('notes').value.trim(),
  };
}

function resetForm() {
  document.getElementById('game-form').reset();
  document.getElementById('game-id').value = '';
  editingId = null;
  document.getElementById('form-title').textContent = '➕ Adicionar Jogo';
  document.getElementById('cancel-edit').classList.add('hidden');
}

function startEdit(id) {
  const game = getGame(id);
  if (!game) return;
  editingId = id;
  document.getElementById('game-id').value = id;
  document.getElementById('title').value = game.title;
  document.getElementById('platform').value = game.platform;
  document.getElementById('genre').value = game.genre || '';
  document.getElementById('status').value = game.status;
  document.getElementById('rating').value = game.rating ?? '';
  document.getElementById('hours').value = game.hours || '';
  document.getElementById('cover').value = game.cover || '';
  document.getElementById('notes').value = game.notes || '';
  document.getElementById('form-title').textContent = '✏️ Editar Jogo';
  document.getElementById('cancel-edit').classList.remove('hidden');
  document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
}

// ===== Troca de Abas =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    document.getElementById(`tab-${target}`).classList.remove('hidden');

    if (target === 'library') renderCharts();
    if (target === 'wishlist' && typeof renderWishlist === 'function') renderWishlist();
    if (target === 'ranking') loadRanking();
    if (target === 'posts' && typeof loadCommunityPosts === 'function') loadCommunityPosts();

    if (target === 'chat' && typeof startChatPolling === 'function') {
      startChatPolling();
    } else if (typeof stopChatPolling === 'function') {
      stopChatPolling();
    }
  });
});

// Eventos Biblioteca
document.getElementById('game-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = getFormData();
  if (!data.title || !data.platform || !data.status) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    if (editingId) {
      await updateGame(editingId, data);
      showToast('Jogo atualizado!');
    } else {
      await addGame(data);
      showToast('Jogo adicionado!');
    }
    resetForm();
    render();
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('games-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'edit') startEdit(id);
  if (action === 'delete') deleteGame(id);
});

document.getElementById('cancel-edit').addEventListener('click', resetForm);
document.getElementById('fetch-cover-btn').addEventListener('click', () => {
  fetchCoverToFields(document.getElementById('title').value, 'fetch-cover-btn', 'cover');
});

// Eventos Backup & Filtros Biblioteca
document.getElementById('export-btn').addEventListener('click', exportBackup);
document.getElementById('import-input').addEventListener('change', (e) => {
  if (e.target.files[0]) importBackup(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('search').addEventListener('input', renderGames);
['filter-platform', 'filter-status', 'sort-by'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderGames);
});

// ===== PWA / Service Worker =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registrado'))
      .catch(err => console.log('SW falhou:', err));
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('install-btn').classList.remove('hidden');
});

document.getElementById('install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('install-btn').classList.add('hidden');
  }
  deferredPrompt = null;
});

window.addEventListener('appinstalled', () => {
  document.getElementById('install-btn').classList.add('hidden');
});

// ===== Init =====
(async () => {
  loadSession();
  updateAuthUI();
  if (authToken && currentUser) {
    await loadGames();
    render();
    if (typeof loadWishlist === 'function') {
      await loadWishlist();
      renderWishlist();
    }
  }
})();