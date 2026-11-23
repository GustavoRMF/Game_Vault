// ========================================
// GameVault - Lista de Desejos (Wishlist)
// ========================================

let wishlist = [];
let editingWishId = null;

async function loadWishlist() {
  if (!authToken) return;
  try {
    const res = await apiFetch('/api/wishlist');
    if (!res.ok) throw new Error('Falha ao carregar lista de desejos');
    wishlist = await res.json();
    updateWishlistBadge();
  } catch (err) {
    console.error(err);
    wishlist = [];
    updateWishlistBadge();
  }
}

function updateWishlistBadge() {
  const badge = document.getElementById('wishlist-tab-badge');
  if (badge) badge.textContent = String(wishlist.length);
}

function getFilteredWishlist() {
  const searchEl = document.getElementById('wish-search');
  const platEl = document.getElementById('wish-filter-platform');
  const prioEl = document.getElementById('wish-filter-priority');
  const sortEl = document.getElementById('wish-sort-by');

  const search = (searchEl?.value || '').toLowerCase().trim();
  const platform = platEl?.value || '';
  const priority = prioEl?.value || '';
  const sortBy = sortEl?.value || 'priority-desc';

  const prioWeight = { Alta: 3, Média: 2, Baixa: 1 };

  const filtered = wishlist.filter(item => {
    if (search && !item.title.toLowerCase().includes(search)) return false;
    if (platform && item.platform !== platform) return false;
    if (priority && item.priority !== priority) return false;
    return true;
  });

  const sorters = {
    'priority-desc': (a, b) => (prioWeight[b.priority] || 0) - (prioWeight[a.priority] || 0) || (b.addedAt || 0) - (a.addedAt || 0),
    'added-desc': (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    'title-asc': (a, b) => a.title.localeCompare(b.title),
    'price-asc': (a, b) => (a.targetPrice ?? Infinity) - (b.targetPrice ?? Infinity)
  };

  return filtered.sort(sorters[sortBy] || sorters['priority-desc']);
}

function renderWishlistStats() {
  const statsEl = document.getElementById('wishlist-stats');
  if (!statsEl) return;

  const total = wishlist.length;
  const high = wishlist.filter(w => w.priority === 'Alta').length;
  const totalBudget = wishlist.reduce((acc, w) => acc + (Number(w.targetPrice) || 0), 0);

  statsEl.innerHTML = `
    <div class="stat-card"><div class="value">${total}</div><div class="label">Total Desejado</div></div>
    <div class="stat-card"><div class="value">${high}</div><div class="label">Prioridade Alta</div></div>
    <div class="stat-card"><div class="value">R$ ${totalBudget.toFixed(2)}</div><div class="label">Orçamento Alvo</div></div>
  `;
}

function renderWishlist() {
  updateWishlistBadge();
  renderWishlistStats();

  const listEl = document.getElementById('wishlist-list');
  const emptyMsg = document.getElementById('wishlist-empty-msg');
  const countEl = document.getElementById('wishlist-count');
  if (!listEl || !emptyMsg || !countEl) return;

  const filtered = getFilteredWishlist();
  countEl.textContent = `(${filtered.length}${filtered.length !== wishlist.length ? ' de ' + wishlist.length : ''})`;

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    emptyMsg.textContent = wishlist.length === 0
      ? 'Sua lista de desejos está vazia. Adicione jogos que pretende comprar! ⭐'
      : 'Nenhum item encontrado com esses filtros. 🔍';
    return;
  }

  emptyMsg.classList.add('hidden');
  const prioEmoji = { Alta: '🔥 Alta', Média: '⚡ Média', Baixa: '💤 Baixa' };

  listEl.innerHTML = filtered.map(item => {
    const safeCover = sanitizeUrl(item.cover);
    const safePlatform = escapeHtml(item.platform);
    return `
      <div class="game-card">
        ${safeCover ? `<img class="game-cover" src="${escapeHtml(safeCover)}" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'">` : ''}
        <div class="game-header">
          <span class="game-title">${escapeHtml(item.title)}</span>
          <span class="platform-badge platform-${safePlatform}">${safePlatform}</span>
        </div>
        <div class="game-meta">
          <span class="badge">${prioEmoji[item.priority] || escapeHtml(item.priority)}</span>
          ${item.genre ? `<span class="badge">${escapeHtml(item.genre)}</span>` : ''}
          ${item.targetPrice !== null && item.targetPrice !== undefined ? `<span class="badge rating">💰 R$ ${Number(item.targetPrice).toFixed(2)}</span>` : ''}
        </div>
        ${item.notes ? `<div class="game-notes">${escapeHtml(item.notes)}</div>` : ''}
        <div class="game-actions">
          <button type="button" class="btn-primary" data-wish-action="move" data-id="${escapeHtml(item.id)}">📚 Comprei</button>
          <button type="button" class="btn-edit" data-wish-action="edit" data-id="${escapeHtml(item.id)}">✏️</button>
          <button type="button" class="btn-delete" data-wish-action="delete" data-id="${escapeHtml(item.id)}">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function resetWishForm() {
  const form = document.getElementById('wishlist-form');
  if (form) form.reset();
  const idInput = document.getElementById('wish-id');
  if (idInput) idInput.value = '';
  editingWishId = null;
  const titleEl = document.getElementById('wish-form-title');
  if (titleEl) titleEl.textContent = '⭐ Adicionar à Lista de Desejos';
  const cancelBtn = document.getElementById('wish-cancel-edit');
  if (cancelBtn) cancelBtn.classList.add('hidden');
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
  document.getElementById('tab-wishlist').scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('wishlist-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: document.getElementById('wish-title').value.trim(),
    platform: document.getElementById('wish-platform').value,
    genre: document.getElementById('wish-genre').value.trim(),
    priority: document.getElementById('wish-priority').value,
    targetPrice: document.getElementById('wish-price').value !== '' ? parseFloat(document.getElementById('wish-price').value) : null,
    cover: sanitizeUrl(document.getElementById('wish-cover').value.trim()),
    notes: document.getElementById('wish-notes').value.trim()
  };

  if (!payload.title || !payload.platform) return;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    if (editingWishId) {
      const res = await apiFetch(`/api/wishlist/${encodeURIComponent(editingWishId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Erro ao atualizar item');
      const updated = await res.json();
      const idx = wishlist.findIndex(w => w.id === editingWishId);
      if (idx !== -1) wishlist[idx] = updated;
      showToast('Item atualizado!');
    } else {
      const res = await apiFetch('/api/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Erro ao salvar na lista');
      const created = await res.json();
      wishlist.unshift(created);
      showToast('Adicionado à lista de desejos!');
    }

    resetWishForm();
    renderWishlist();
    if (typeof renderHeaderCovers === 'function') renderHeaderCovers();
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById('wishlist-list')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-wish-action]');
  if (!btn) return;
  const { wishAction, id } = btn.dataset;

  if (wishAction === 'edit') {
    startEditWish(id);
  } else if (wishAction === 'delete') {
    if (!confirm('Remover este jogo da lista de desejos?')) return;
    try {
      const res = await apiFetch(`/api/wishlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao remover');
      wishlist = wishlist.filter(w => w.id !== id);
      if (editingWishId === id) resetWishForm();
      renderWishlist();
      showToast('Removido da lista.');
    } catch (err) {
      if (err.message !== 'Sessão expirada') showToast(err.message);
    }
  } else if (wishAction === 'move') {
    try {
      const res = await apiFetch(`/api/wishlist/${encodeURIComponent(id)}/move-to-library`, { method: 'POST' });
      if (!res.ok) throw new Error('Erro ao mover para biblioteca');
      const { game } = await res.json();
      wishlist = wishlist.filter(w => w.id !== id);
      if (game && Array.isArray(games)) games.unshift(game);
      renderWishlist();
      if (typeof render === 'function') render();
      showToast('Jogo movido para Minha Biblioteca! 🎮');
    } catch (err) {
      if (err.message !== 'Sessão expirada') showToast(err.message);
    }
  }
});

document.getElementById('wish-cancel-edit')?.addEventListener('click', resetWishForm);
document.getElementById('wish-fetch-cover-btn')?.addEventListener('click', () => {
  fetchCoverToFields(document.getElementById('wish-title').value, 'wish-fetch-cover-btn', 'wish-cover');
});

document.getElementById('wish-search')?.addEventListener('input', renderWishlist);
['wish-filter-platform', 'wish-filter-priority', 'wish-sort-by'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderWishlist);
});