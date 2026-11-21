// ========================================
// GameVault - Gerenciador de Biblioteca (Cloud + 3D)
// ========================================

let games = [];
let editingId = null;
let deferredPrompt = null;
let charts = { platforms: null, status: null };

// ===== Persistência (API + PostgreSQL Neon) =====
async function loadGames() {
  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error('Falha ao carregar biblioteca');
    games = await res.json();
  } catch (e) {
    console.error(e);
    showToast('Erro ao conectar com o servidor.');
    games = [];
  }
}

// ===== Helpers =====
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
  t._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ===== CRUD =====
async function addGame(data) {
  const game = { id: generateId(), ...data, addedAt: Date.now() };
  const res = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(game)
  });
  if (!res.ok) throw new Error('Erro ao salvar');
  games.unshift(game);
  return game;
}

async function updateGame(id, data) {
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) return false;
  const res = await fetch(`/api/games/${encodeURIComponent(id)}`, {
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
    const res = await fetch(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erro ao excluir');
    games = games.filter(g => g.id !== id);
    if (editingId === id) resetForm();
    render();
    showToast('Jogo excluído.');
  } catch (err) {
    showToast(err.message);
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
  a.download = `gamevault-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      const valid = imported.filter(g => g && typeof g.id === 'string' && g.title && g.platform);
      if (valid.length === 0) throw new Error('Nenhum jogo válido');

      const res = await fetch('/api/games/bulk', {
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
      showToast('Erro ao importar: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ===== RAWG API (via backend) =====
async function fetchCover(title) {
  if (!title.trim()) {
    showToast('Digite um título primeiro.');
    return;
  }

  const btn = document.getElementById('fetch-cover-btn');
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    const res = await fetch(`/api/cover?title=${encodeURIComponent(title)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro na API');

    if (data.cover) {
      document.getElementById('cover').value = data.cover;
      showToast('Capa encontrada!');
    } else {
      showToast('Jogo não encontrado ou sem capa.');
    }
  } catch (e) {
    showToast('Erro ao buscar capa: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍';
  }
}

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

// ===== Renderização =====
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
}

// ===== Formulário =====
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

// ===== Eventos =====
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
    showToast(err.message);
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
document.getElementById('export-btn').addEventListener('click', exportBackup);
document.getElementById('import-input').addEventListener('change', (e) => {
  if (e.target.files[0]) importBackup(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('fetch-cover-btn').addEventListener('click', () => {
  fetchCover(document.getElementById('title').value);
});

document.getElementById('search').addEventListener('input', renderGames);
['filter-platform', 'filter-status', 'sort-by'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderGames);
});

// ===== Efeito 3D Tilt nos Cards =====
const gamesListEl = document.getElementById('games-list');

gamesListEl.addEventListener('mousemove', (e) => {
  const card = e.target.closest('.game-card');
  if (!card) return;

  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  card.style.setProperty('--mouse-x', `${x}px`);
  card.style.setProperty('--mouse-y', `${y}px`);

  const rotateY = ((x / rect.width) - 0.5) * 14;
  const rotateX = ((y / rect.height) - 0.5) * -14;

  card.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px)`;
});

gamesListEl.addEventListener('mouseout', (e) => {
  const card = e.target.closest('.game-card');
  if (!card) return;
  if (!card.contains(e.relatedTarget)) {
    card.style.transform = 'rotateX(0deg) rotateY(0deg) translateY(0)';
  }
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
  await loadGames();
  render();
})();