// ========================================
// GameVault - Módulo Social (Mural, Chat & Perfil Público)
// ========================================

let chatPollTimer = null;

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ===== 1. Perfil Público de Outros Jogadores =====
async function openPlayerProfile(userId) {
  const modal = document.getElementById('player-profile-modal');
  const titleEl = document.getElementById('profile-modal-title');
  const statsEl = document.getElementById('profile-modal-stats');
  const gamesEl = document.getElementById('profile-modal-games');
  const emptyEl = document.getElementById('profile-modal-empty');

  modal.classList.remove('hidden');
  titleEl.textContent = 'Carregando perfil...';
  statsEl.innerHTML = '';
  gamesEl.innerHTML = '';
  emptyEl.classList.add('hidden');

  try {
    const res = await apiFetch(`/api/users/${encodeURIComponent(userId)}/profile`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao carregar perfil');

    titleEl.textContent = `🎮 Biblioteca de ${data.user.username}`;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="value">${data.stats.totalGames}</div><div class="label">Jogos</div></div>
      <div class="stat-card"><div class="value">${Number(data.stats.totalHours).toFixed(1)}h</div><div class="label">Horas Totais</div></div>
      <div class="stat-card"><div class="value">${data.stats.playing}</div><div class="label">Jogando</div></div>
      <div class="stat-card"><div class="value">${data.stats.completed}</div><div class="label">Zerados</div></div>
      <div class="stat-card"><div class="value">${data.stats.platinums}</div><div class="label">100% / Platina</div></div>
    `;

    if (!data.games.length) {
      emptyEl.classList.remove('hidden');
      return;
    }

    gamesEl.innerHTML = data.games.map(game => {
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
        </div>
      `;
    }).join('');
  } catch (err) {
    modal.classList.add('hidden');
    if (err.message !== 'Sessão expirada') showToast(err.message);
  }
}

document.getElementById('close-profile-modal').addEventListener('click', () => {
  document.getElementById('player-profile-modal').classList.add('hidden');
});

document.getElementById('player-profile-modal').addEventListener('click', (e) => {
  if (e.target.id === 'player-profile-modal') {
    e.target.classList.add('hidden');
  }
});

// ===== 2. Mural de Informações & Comentários =====
async function loadCommunityPosts() {
  const listEl = document.getElementById('posts-list');
  const emptyEl = document.getElementById('posts-empty-msg');
  listEl.innerHTML = '<p class="empty-msg">Carregando mural...</p>';
  emptyEl.classList.add('hidden');

  try {
    const res = await apiFetch('/api/posts');
    if (!res.ok) throw new Error('Erro ao carregar publicações');
    const posts = await res.json();

    if (!posts.length) {
      listEl.innerHTML = '';
      emptyEl.classList.remove('hidden');
      return;
    }

    listEl.innerHTML = posts.map(post => {
      const isMine = currentUser && post.userId === currentUser.id;
      return `
        <article class="post-card">
          <div class="post-header">
            <div>
              <div class="post-author-row">
                <button type="button" class="author-link" data-profile-id="${post.userId}">👤 ${escapeHtml(post.username)}</button>
                <span class="badge">${escapeHtml(post.category)}</span>
                <span>• ${formatDateTime(post.createdAt)}</span>
              </div>
              <h3 class="post-title" style="margin-top: 8px;">${escapeHtml(post.title)}</h3>
            </div>
            ${isMine ? `<button type="button" class="btn-mini-danger" data-delete-post="${escapeHtml(post.id)}">🗑️ Excluir</button>` : ''}
          </div>

          <div class="post-body">${escapeHtml(post.content)}</div>

          <div class="comments-box">
            <div class="comments-title">💬 Comentários (${post.comments.length})</div>
            ${post.comments.map(c => {
              const myComment = currentUser && c.userId === currentUser.id;
              return `
                <div class="comment-item">
                  <div class="comment-meta">
                    <div>
                      <button type="button" class="author-link" data-profile-id="${c.userId}">👤 ${escapeHtml(c.username)}</button>
                      <span> • ${formatDateTime(c.createdAt)}</span>
                    </div>
                    ${myComment ? `<button type="button" class="btn-mini-danger" data-delete-comment="${escapeHtml(c.id)}">✕</button>` : ''}
                  </div>
                  <div class="comment-text">${escapeHtml(c.content)}</div>
                </div>
              `;
            }).join('')}

            <form class="comment-form" data-post-id="${escapeHtml(post.id)}">
              <input type="text" maxlength="600" required placeholder="Escreva um comentário...">
              <button type="submit" class="btn-secondary">Comentar</button>
            </form>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    if (err.message !== 'Sessão expirada') {
      listEl.innerHTML = '';
      showToast(err.message);
    }
  }
}

document.getElementById('post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('post-title').value.trim();
  const category = document.getElementById('post-category').value;
  const content = document.getElementById('post-content').value.trim();
  if (!title || !content) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const res = await apiFetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category, content })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao publicar');

    e.target.reset();
    await loadCommunityPosts();
    showToast('Publicação enviada para todos!');
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('posts-list').addEventListener('click', async (e) => {
  const profileBtn = e.target.closest('[data-profile-id]');
  if (profileBtn) {
    openPlayerProfile(profileBtn.dataset.profileId);
    return;
  }

  const delPostBtn = e.target.closest('[data-delete-post]');
  if (delPostBtn) {
    if (!confirm('Excluir esta publicação?')) return;
    try {
      const res = await apiFetch(`/api/posts/${encodeURIComponent(delPostBtn.dataset.deletePost)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao excluir');
      await loadCommunityPosts();
      showToast('Publicação excluída.');
    } catch (err) {
      if (err.message !== 'Sessão expirada') showToast(err.message);
    }
    return;
  }

  const delCommentBtn = e.target.closest('[data-delete-comment]');
  if (delCommentBtn) {
    try {
      const res = await apiFetch(`/api/comments/${encodeURIComponent(delCommentBtn.dataset.deleteComment)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao excluir comentário');
      await loadCommunityPosts();
    } catch (err) {
      if (err.message !== 'Sessão expirada') showToast(err.message);
    }
  }
});

document.getElementById('posts-list').addEventListener('submit', async (e) => {
  const form = e.target.closest('.comment-form');
  if (!form) return;
  e.preventDefault();

  const input = form.querySelector('input');
  const content = input.value.trim();
  if (!content) return;

  const btn = form.querySelector('button');
  btn.disabled = true;

  try {
    const res = await apiFetch(`/api/posts/${encodeURIComponent(form.dataset.postId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw new Error('Erro ao comentar');
    input.value = '';
    await loadCommunityPosts();
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ===== 3. Chat Global =====
async function loadChatMessages(scrollBottom = true) {
  const box = document.getElementById('chat-messages');
  if (!box || !authToken) return;

  try {
    const res = await apiFetch('/api/chat');
    if (!res.ok) throw new Error('Erro ao carregar chat');
    const messages = await res.json();

    if (!messages.length) {
      box.innerHTML = '<p class="empty-msg">Nenhuma mensagem ainda. Seja o primeiro a dar oi! 👋</p>';
      return;
    }

    const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;

    box.innerHTML = messages.map(m => {
      const isMine = currentUser && m.userId === currentUser.id;
      return `
        <div class="chat-msg ${isMine ? 'mine' : ''}">
          <div class="chat-msg-header">
            <button type="button" class="author-link" data-profile-id="${m.userId}">👤 ${escapeHtml(m.username)}</button>
            <div>
              <span>${formatDateTime(m.createdAt)}</span>
              ${isMine ? `<button type="button" class="btn-mini-danger" data-delete-chat="${escapeHtml(m.id)}" style="margin-left:6px;">✕</button>` : ''}
            </div>
          </div>
          <div class="chat-msg-text">${escapeHtml(m.message)}</div>
        </div>
      `;
    }).join('');

    if (scrollBottom || wasNearBottom) {
      box.scrollTop = box.scrollHeight;
    }
  } catch (err) {
    if (err.message !== 'Sessão expirada') console.error(err);
  }
}

function startChatPolling() {
  stopChatPolling();
  loadChatMessages(true);
  chatPollTimer = setInterval(() => loadChatMessages(false), 5000);
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;

  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error('Erro ao enviar mensagem');
    input.value = '';
    await loadChatMessages(true);
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    btn.disabled = false;
    input.focus();
  }
});

document.getElementById('chat-messages').addEventListener('click', async (e) => {
  const profileBtn = e.target.closest('[data-profile-id]');
  if (profileBtn) {
    openPlayerProfile(profileBtn.dataset.profileId);
    return;
  }

  const delBtn = e.target.closest('[data-delete-chat]');
  if (delBtn) {
    try {
      const res = await apiFetch(`/api/chat/${encodeURIComponent(delBtn.dataset.deleteChat)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao apagar');
      await loadChatMessages(false);
    } catch (err) {
      if (err.message !== 'Sessão expirada') showToast(err.message);
    }
  }
});