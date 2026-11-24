// ========================================
// GameVault - Perfil Público, Mural (Cores/Emojis/Reações) & Chat Online
// ========================================

let chatPollTimer = null;
const REACTION_EMOJIS = ['🔥', '🏆', '❤️', '🎮', '😂'];

function onlineDotHtml(isOnline) {
  return `<span class="online-dot ${isOnline ? 'is-online' : ''}" title="${isOnline ? 'Online agora' : 'Offline'}"></span>`;
}

// Injeta seletor de cores e barra de emojis nos formulários do Mural e Chat
function initCommunityEnhancements() {
  const postForm = document.getElementById('post-form');
  if (postForm && !document.getElementById('postColorInput')) {
    const actionsDiv = postForm.querySelector('.form-actions');
    const extras = document.createElement('div');
    extras.innerHTML = `
      <input type="hidden" id="postColorInput" value="blue">
      <div class="color-picker-row">
        <span style="font-size:0.85rem; color:var(--muted);">🎨 Cor do card:</span>
        <button type="button" class="color-swatch selected" data-color="blue" title="Azul PSN"></button>
        <button type="button" class="color-swatch" data-color="purple" title="Roxo Arcade"></button>
        <button type="button" class="color-swatch" data-color="emerald" title="Verde Esmeralda"></button>
        <button type="button" class="color-swatch" data-color="gold" title="Dourado Lendário"></button>
        <button type="button" class="color-swatch" data-color="crimson" title="Vermelho Alerta"></button>
        <button type="button" class="color-swatch" data-color="cyan" title="Ciano Neon"></button>
      </div>
      ${typeof buildEmojiBarHtml === 'function' ? buildEmojiBarHtml('post-content') : ''}
    `;
    postForm.insertBefore(extras, actionsDiv);
  }

  const chatCard = document.querySelector('#tab-chat .chat-card');
  const chatForm = document.getElementById('chat-form');
  if (chatCard && chatForm && !document.getElementById('chatEmojiBarWrap')) {
    const wrap = document.createElement('div');
    wrap.id = 'chatEmojiBarWrap';
    wrap.innerHTML = typeof buildEmojiBarHtml === 'function' ? buildEmojiBarHtml('chat-input') : '';
    chatCard.insertBefore(wrap, chatForm);
  }

  const chatHeader = document.querySelector('#tab-chat .chat-header div');
  if (chatHeader && !document.getElementById('onlineCountBadge')) {
    const badge = document.createElement('span');
    badge.id = 'onlineCountBadge';
    badge.className = 'online-pill';
    badge.style.marginTop = '6px';
    badge.innerHTML = `<span class="online-dot is-online"></span> Online`;
    chatHeader.appendChild(badge);
  }
}

// ===== Modal Perfil Público =====
async function openPlayerProfile(userId) {
  const modal = document.getElementById('profile-modal');
  const titleEl = document.getElementById('profile-modal-title');
  const subEl = document.getElementById('profile-modal-sub');
  const statsEl = document.getElementById('profile-modal-stats');
  const gamesEl = document.getElementById('profile-modal-games');
  if (!modal) return;

  modal.classList.remove('hidden');
  titleEl.textContent = '👤 Carregando perfil...';
  subEl.textContent = '';
  statsEl.innerHTML = '';
  gamesEl.innerHTML = '<p class="empty-msg">Buscando biblioteca do jogador...</p>';

  try {
    const res = await apiFetch(`/api/users/${encodeURIComponent(userId)}/profile`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao carregar perfil');

    titleEl.innerHTML = `${onlineDotHtml(data.user.online)} 🎮 Biblioteca de ${escapeHtml(data.user.username)}`;
    const since = data.user.createdAt
      ? `Membro desde ${new Date(data.user.createdAt).toLocaleDateString('pt-BR')}`
      : 'Jogador da comunidade GameVault';
    subEl.textContent = `${data.user.online ? '🟢 Online agora • ' : ''}${since}`;

    statsEl.innerHTML = `
      <div class="stat-card"><div class="value">${data.stats.totalGames}</div><div class="label">Jogos</div></div>
      <div class="stat-card"><div class="value">${Number(data.stats.totalHours).toFixed(1)}h</div><div class="label">Horas Totais</div></div>
      <div class="stat-card"><div class="value">${data.stats.platinums}</div><div class="label">Platinas (100%)</div></div>
      <div class="stat-card"><div class="value">${data.stats.completed}</div><div class="label">Zerados</div></div>
      <div class="stat-card"><div class="value">${data.stats.playing}</div><div class="label">Jogando</div></div>
    `;
    
const xpInfo = typeof calculatePlayerXP === 'function' ? calculatePlayerXP(data.stats) : null;
    if (xpInfo) {
      subEl.innerHTML += ` • <strong>${xpInfo.icon} Nível ${xpInfo.level} (${xpInfo.title})</strong>`;
    }

    const platinumGames = data.games.filter(g => g.status === '100%');
    const existingShowcase = document.getElementById('profile-platinum-showcase');
    if (existingShowcase) existingShowcase.remove();

    if (platinumGames.length > 0) {
      const showcase = document.createElement('div');
      showcase.id = 'profile-platinum-showcase';
      showcase.className = 'platinum-showcase';
      showcase.innerHTML = `
        <h3>🏆 Vitrine de Platinas (${platinumGames.length})</h3>
        <div class="platinum-chips">
          ${platinumGames.map(p => `<span class="platinum-chip">💎 ${escapeHtml(p.title)}</span>`).join('')}
        </div>
      `;
      gamesEl.parentNode.insertBefore(showcase, gamesEl);
    }
    if (!data.games.length) {
      gamesEl.innerHTML = '<p class="empty-msg">Este jogador ainda não cadastrou nenhum jogo.</p>';
      return;
    }

    gamesEl.innerHTML = data.games.map(g => {
      const safeCover = sanitizeUrl(g.cover);
      const safePlatform = escapeHtml(g.platform);
      return `
        <div class="game-card">
          ${safeCover ? `<img class="game-cover" src="${escapeHtml(safeCover)}" alt="${escapeHtml(g.title)}" onerror="this.style.display='none'">` : ''}
          <div class="game-header">
            <span class="game-title">${escapeHtml(g.title)}</span>
            <span class="platform-badge platform-${safePlatform}">${safePlatform}</span>
          </div>
          <div class="game-meta">
            <span class="badge ${statusClass(g.status)}">${escapeHtml(g.status)}</span>
            ${g.genre ? `<span class="badge">${escapeHtml(g.genre)}</span>` : ''}
            ${g.rating !== null && g.rating !== undefined ? `<span class="badge rating">★ ${g.rating}/10</span>` : ''}
            ${g.hours ? `<span class="badge">⏱ ${g.hours}h</span>` : ''}
          </div>
          ${g.notes ? `<div class="game-notes">${escapeHtml(g.notes)}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (err) {
    gamesEl.innerHTML = `<p class="empty-msg">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('close-profile-modal')?.addEventListener('click', () => {
  document.getElementById('profile-modal')?.classList.add('hidden');
});

document.getElementById('profile-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'profile-modal') {
    e.currentTarget.classList.add('hidden');
  }
});

// ===== Mural de Publicações =====
async function loadCommunityPosts() {
  initCommunityEnhancements();
  const listEl = document.getElementById('posts-list');
  if (!listEl) return;
  listEl.innerHTML = '<p class="empty-msg">Carregando publicações...</p>';

  try {
    const res = await apiFetch('/api/posts');
    const posts = await res.json();
    if (!res.ok) throw new Error(posts.error || 'Erro ao carregar mural');

    if (!posts.length) {
      listEl.innerHTML = '<p class="empty-msg">Nenhuma publicação ainda. Seja o primeiro a postar! 📢</p>';
      return;
    }

    listEl.innerHTML = posts.map(post => {
      const isOwner = currentUser && String(post.userId) === String(currentUser.id);
      const dateStr = new Date(post.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const themeClass = `theme-${escapeHtml(post.color || 'blue')}`;

      const reactionsHtml = REACTION_EMOJIS.map(emoji => {
        const info = post.reactions?.[emoji] || { count: 0, reacted: false };
        return `
          <button type="button" class="reaction-btn ${info.reacted ? 'active' : ''}" data-react-post="${escapeHtml(post.id)}" data-emoji="${emoji}">
            <span>${emoji}</span>
            ${info.count > 0 ? `<span>${info.count}</span>` : ''}
          </button>
        `;
      }).join('');

      const commentsHtml = (post.comments || []).map(c => {
        const isCommentOwner = currentUser && String(c.userId) === String(currentUser.id);
        return `
          <div class="comment-item">
            <div>
              ${onlineDotHtml(c.online)}
              <strong class="clickable-user" data-profile-id="${escapeHtml(String(c.userId))}">${escapeHtml(c.username)}</strong>:
              <span>${escapeHtml(c.content)}</span>
            </div>
            ${isCommentOwner ? `<button type="button" class="btn-delete btn-small" data-del-comment="${escapeHtml(c.id)}">✕</button>` : ''}
          </div>
        `;
      }).join('');

      return `
        <article class="post-card ${themeClass}">
          <div class="post-header">
            <div>
              <span class="badge">${escapeHtml(post.category)}</span>
              <h3 class="post-title">${escapeHtml(post.title)}</h3>
              <span class="post-meta">
                por ${onlineDotHtml(post.online)}<strong class="clickable-user" data-profile-id="${escapeHtml(String(post.userId))}">${escapeHtml(post.username)}</strong> • ${dateStr}
              </span>
            </div>
            ${isOwner ? `<button type="button" class="btn-delete btn-small" data-del-post="${escapeHtml(post.id)}">🗑️ Excluir</button>` : ''}
          </div>
          <p class="post-body">${escapeHtml(post.content)}</p>
          <div class="post-reactions">${reactionsHtml}</div>
          <div class="post-comments">
            ${commentsHtml}
            <form class="comment-form" data-post-id="${escapeHtml(post.id)}">
              <input type="text" placeholder="Escreva um comentário..." maxlength="600" required>
              <button type="submit" class="btn-secondary btn-small">Comentar</button>
            </form>
          </div>
        </article>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<p class="empty-msg">${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('post-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('post-title').value.trim();
  const category = document.getElementById('post-category').value;
  const content = document.getElementById('post-content').value.trim();
  const color = document.getElementById('postColorInput')?.value || 'blue';
  if (!title || !content) return;

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await apiFetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category, content, color })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao publicar');
    e.target.reset();
    if (document.getElementById('postColorInput')) document.getElementById('postColorInput').value = 'blue';
    await loadCommunityPosts();
    showToast('Publicado no mural!');
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('posts-list')?.addEventListener('click', async (e) => {
  const reactBtn = e.target.closest('[data-react-post]');
  if (reactBtn) {
    const postId = reactBtn.dataset.reactPost;
    const emoji = reactBtn.dataset.emoji;
    const res = await apiFetch(`/api/posts/${encodeURIComponent(postId)}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji })
    });
    if (res.ok) loadCommunityPosts();
    return;
  }

  const profileTrigger = e.target.closest('[data-profile-id]');
  if (profileTrigger) {
    openPlayerProfile(profileTrigger.dataset.profileId);
    return;
  }

  const delPostBtn = e.target.closest('[data-del-post]');
  if (delPostBtn) {
    if (!confirm('Excluir esta publicação?')) return;
    const res = await apiFetch(`/api/posts/${encodeURIComponent(delPostBtn.dataset.delPost)}`, { method: 'DELETE' });
    if (res.ok) {
      loadCommunityPosts();
      showToast('Publicação excluída.');
    }
    return;
  }

  const delCommentBtn = e.target.closest('[data-del-comment]');
  if (delCommentBtn) {
    const res = await apiFetch(`/api/comments/${encodeURIComponent(delCommentBtn.dataset.delComment)}`, { method: 'DELETE' });
    if (res.ok) {
      loadCommunityPosts();
      showToast('Comentário removido.');
    }
  }
});

document.getElementById('posts-list')?.addEventListener('submit', async (e) => {
  const form = e.target.closest('.comment-form');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const content = input.value.trim();
  if (!content) return;

  const res = await apiFetch(`/api/posts/${encodeURIComponent(form.dataset.postId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  if (res.ok) {
    input.value = '';
    loadCommunityPosts();
  }
});

document.getElementById('refresh-posts-btn')?.addEventListener('click', loadCommunityPosts);

// ===== Chat Global =====
async function loadChatMessages(silent = false) {
  initCommunityEnhancements();
  const box = document.getElementById('chat-messages');
  if (!box) return;
  if (!silent) box.innerHTML = '<p class="empty-msg">Carregando chat...</p>';

  try {
    const res = await apiFetch('/api/chat');
    const messages = await res.json();
    if (!res.ok) throw new Error(messages.error || 'Erro ao carregar chat');

    if (!messages.length) {
      box.innerHTML = '<p class="empty-msg">Nenhuma mensagem ainda. Mande um oi para a comunidade! 💬</p>';
      return;
    }

    box.innerHTML = messages.map(m => {
      const isMe = currentUser && String(m.userId) === String(currentUser.id);
      const timeStr = new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="chat-msg ${isMe ? 'mine' : ''}">
          <div class="chat-msg-head">
            ${onlineDotHtml(m.online)}
            <strong class="clickable-user" data-profile-id="${escapeHtml(String(m.userId))}">${escapeHtml(m.username)}</strong>
            <span>${timeStr}</span>
            ${isMe ? `<button type="button" class="btn-delete btn-small" data-del-chat="${escapeHtml(m.id)}">✕</button>` : ''}
          </div>
          <div class="chat-msg-body">${escapeHtml(m.message)}</div>
        </div>
      `;
    }).join('');
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    if (!silent) box.innerHTML = `<p class="empty-msg">${escapeHtml(err.message)}</p>`;
  }
}

function startChatPolling() {
  stopChatPolling();
  loadChatMessages();
  chatPollTimer = setInterval(() => loadChatMessages(true), 6000);
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.disabled = true;
  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (res.ok) {
      input.value = '';
      await loadChatMessages(true);
    }
  } finally {
    input.disabled = false;
    input.focus();
  }
});

document.getElementById('chat-messages')?.addEventListener('click', async (e) => {
  const profileTrigger = e.target.closest('[data-profile-id]');
  if (profileTrigger) {
    openPlayerProfile(profileTrigger.dataset.profileId);
    return;
  }
  const delBtn = e.target.closest('[data-del-chat]');
  if (delBtn) {
    const res = await apiFetch(`/api/chat/${encodeURIComponent(delBtn.dataset.delChat)}`, { method: 'DELETE' });
    if (res.ok) loadChatMessages(true);
  }
});

document.getElementById('refresh-chat-btn')?.addEventListener('click', () => loadChatMessages());
document.addEventListener('DOMContentLoaded', initCommunityEnhancements);