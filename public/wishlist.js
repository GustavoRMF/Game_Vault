// ========================================
// GameVault - Módulo da Lista de Desejos (Wishlist)
// ========================================

let wishlist = [];
let editingWishId = null;

// ===== Helpers específicos da Wishlist =====
function priorityClass(priority) {
  if (priority === 'Alta') return 'priority-Alta';
  if (priority === 'Baixa') return 'priority-Baixa';
  return 'priority-Media';
}

function priorityIcon(priority) {
  if (priority === 'Alta') return '🔥 Alta';
  if (priority === 'Baixa') return '❄️ Baixa';
  return '⭐ Média';
}

function formatBRL(value) {
  if (value === null || value === undefined || isNaN(value)) return '';
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ===== Carregamento & CRUD =====
async function loadWishlist() {
  if (!authToken) return;
  try {
    const res = await apiFetch('/api/wishlist');
    if (!res.ok) throw new Error('Falha ao carregar lista de desejos');
    wishlist = await res.json();
  } catch (e) {
    console.error(e);
    wishlist = [];
  }
}

async function addWishItem(data) {
  const item = { id: generateId(), ...data, addedAt: Date.now() };
  const res = await apiFetch('/api/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item)
  });
  if (!res.ok) throw new Error('Erro ao salvar na lista de desejos');
  const saved = await res.json();
  if (saved.id) item.id = saved.id;
  wishlist.unshift(item);
  return item;
}

async function updateWishItem(id, data) {
  const idx = wishlist.findIndex(w => w.id === id);
  if (idx === -1) return false;
  const res = await apiFetch(`/api/wishlist/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Erro ao atualizar item');
  wishlist[idx] = { ...wishlist[idx], ...data };
  return true;
}

async function deleteWishItem(id) {
  if (!confirm('Remover este jogo da lista de desejos?')) return;
  try {
    const res = await apiFetch(`/api/wishlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Erro ao remover');
    wishlist = wishlist.filter(w => w.id !== id);
    if (editingWishId === id) resetWishForm();
    renderWishlist();
    showToast('Removido da lista de desejos.');
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  }
}

async function moveWishToLibrary(id) {
  const item = wishlist.find(w => w.id === id);
  if (!item) return;
  if (!confirm(`Marcar "${item.title}" como adquirido e mover para sua Biblioteca?`)) return;

  try {
    const res = await apiFetch(`/api/wishlist/${encodeURIComponent(id)}/move-to-library`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao mover jogo');

    wishlist = wishlist.filter(w => w.id !== id);
    if (editingWishId === id) resetWishForm();
    if (data.game) games.unshift(data.game);

    renderWishlist();
    render();
    showToast(`🎉 "${item.title}" movido para a Biblioteca!`);
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  }
}

// ===== Renderização =====
function renderWishlistStats() {
  const total = wishlist.length;
  const high = wishlist.filter(w => w.priority === 'Alta').length;
  const totalEstimate = wishlist.reduce((acc, w) => acc + (parseFloat(w.targetPrice) || 0), 0);

  document.getElementById('wish-stats').innerHTML = `
    <div class="stat-card"><div class="value">${total}</div><div class="label">Total Desejos</div></div>
    <div class="stat-card"><div class="value">${high}</div><div class="label">Prioridade Alta</div></div>
    <div class="stat-card"><div class="value">${formatBRL(totalEstimate)}</div><div class="label">Estimativa Total</div></div>
  `;
}

function renderWishlist() {
  renderWishlistStats();
  if (typeof renderHeaderCovers === 'function') renderHeaderCovers();
  const listEl = document.getElementById('wish-list');
  const emptyMsg = document.getElementById('wish-empty-msg');
  const countEl = document.getElementById('wish-count');

  const search = document.getElementById('wish-search').value.toLowerCase().trim();
  const platform = document.getElementById('wish-filter-platform').value;
  const priority = document.getElementById('wish-filter-priority').value;

  const priorityWeight = { Alta: 1, Média: 2, Baixa: 3 };

  const filtered = wishlist
    .filter(w => {
      if (search && !w.title.toLowerCase().includes(search)) return false;
      if (platform && w.platform !== platform) return false;
      if (priority && w.priority !== priority) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = (priorityWeight[a.priority] || 2) - (priorityWeight[b.priority] || 2);
      return diff !== 0 ? diff : (b.addedAt || 0) - (a.addedAt || 0);
    });

  countEl.textContent = `(${filtered.length}${filtered.length !== wishlist.length ? ' de ' + wishlist.length : ''})`;

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    emptyMsg.textContent = wishlist.length === 0
      ? 'Sua lista de desejos está vazia. Adicione os próximos jogos que você quer jogar! ⭐'
      : 'Nenhum desejo encontrado com esses filtros. 🔍';
    return;
  }
  emptyMsg.classList.add('hidden');

  listEl.innerHTML = filtered.map(item => {
    const safeCover = sanitizeUrl(item.cover);
    const safePlatform = escapeHtml(item.platform);
    const formattedPrice = formatBRL(item.targetPrice);

    return `
      <div class="game-card">
        ${safeCover ? `<img class="game-cover" src="${escapeHtml(safeCover)}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'">` : ''}
        <div class="game-header">
          <span class="game-title">${escapeHtml(item.title)}</span>
          <span class="platform-badge platform-${safePlatform}">${safePlatform}</span>
        </div>
        <div class="game-meta">
          <span class="badge ${priorityClass(item.priority)}">${priorityIcon(item.priority)}</span>
          ${item.genre ? `<span class="badge">${escapeHtml(item.genre)}</span>` : ''}
          ${formattedPrice ? `<span class="badge price">💰 Alvo: ${formattedPrice}</span>` : ''}
        </div>
        ${item.notes ? `<div class="game-notes">${escapeHtml(item.notes)}</div>` : ''}
        <div class="wish-actions-wrap">
          <button type="button" class="btn-acquire" data-action="acquire" data-id="${escapeHtml(item.id)}">✅ Comprei! Mover p/ Biblioteca</button>
          <div class="game-actions">
            <button type="button" class="btn-edit" data-action="edit" data-id="${escapeHtml(item.id)}">✏️ Editar</button>
            <button type="button" class="btn-delete" data-action="delete" data-id="${escapeHtml(item.id)}">🗑️ Remover</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ===== Formulário & Eventos da Wishlist =====
function getWishFormData() {
  return {
    title: document.getElementById('wish-title').value.trim(),
    platform: document.getElementById('wish-platform').value,
    genre: document.getElementById('wish-genre').value.trim(),
    priority: document.getElementById('wish-priority').value,
    targetPrice: document.getElementById('wish-price').value !== '' ? parseFloat(document.getElementById('wish-price').value) : null,
    cover: sanitizeUrl(document.getElementById('wish-cover').value.trim()),
    notes: document.getElementById('wish-notes').value.trim(),
  };
}

function resetWishForm() {
  document.getElementById('wish-form').reset();
  document.getElementById('wish-id').value = '';
  editingWishId = null;
  document.getElementById('wish-form-title').textContent = '⭐ Adicionar à Lista de Desejos';
  document.getElementById('wish-cancel-edit').classList.add('hidden');
}

function startEditWish(id) {
  const item = wishlist.find(w => w.id === id);
  if (!item) return;
  editingWishId = id;
  document.getElementById('wish-id').value = id;
  document.getElementById('wish-title').value = item.title;
  document.getElementById('wish-platform').value = item.platform;
  document.getElementById('wish-genre').value = item.genre || '';
  document.getElementById('wish-priority').value = item.priority || 'Média';
  document.getElementById('wish-price').value = item.targetPrice ?? '';
  document.getElementById('wish-cover').value = item.cover || '';
  document.getElementById('wish-notes').value = item.notes || '';
  document.getElementById('wish-form-title').textContent = '✏️ Editar Desejo';
  document.getElementById('wish-cancel-edit').classList.remove('hidden');
  document.getElementById('wish-form-section').scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('wish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = getWishFormData();
  if (!data.title || !data.platform) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    if (editingWishId) {
      await updateWishItem(editingWishId, data);
      showToast('Desejo atualizado!');
    } else {
      await addWishItem(data);
      showToast('Adicionado à lista de desejos!');
    }
    resetWishForm();
    renderWishlist();
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('wish-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'acquire') moveWishToLibrary(id);
  if (action === 'edit') startEditWish(id);
  if (action === 'delete') deleteWishItem(id);
});

document.getElementById('wish-cancel-edit').addEventListener('click', resetWishForm);
document.getElementById('wish-fetch-cover-btn').addEventListener('click', () => {
  fetchCoverToFields(document.getElementById('wish-title').value, 'wish-fetch-cover-btn', 'wish-cover');
});

document.getElementById('wish-search').addEventListener('input', renderWishlist);
['wish-filter-platform', 'wish-filter-priority'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderWishlist);
});