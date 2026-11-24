(function () {
  const GAMER_EMOJIS = ['🎮', '🏆', '🔥', '⚔️', '💀', '🎯', '👑', '🚀', '❤️', '😂', '👏', '⚡'];

  // ===== 1. Presença Online (Heartbeat a cada 25s) =====
  window.onlineUserIds = new Set();

  window.renderOnlineDot = function (isOnline) {
    return `<span class="online-dot ${isOnline ? 'is-online' : ''}" title="${isOnline ? 'Online agora' : 'Offline'}"></span>`;
  };

  async function pingPresence() {
    const token = localStorage.getItem('gv_token') || localStorage.getItem('token') || (typeof authToken !== 'undefined' ? authToken : '');
    if (!token) return;
    try {
      const res = await fetch('/api/presence/ping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) return;
      const data = await res.json();
      window.onlineUserIds = new Set((data.onlineUsers || []).map(u => String(u.id)));

      const badge = document.getElementById('onlineCountBadge');
      if (badge) {
        badge.innerHTML = `<span class="online-dot is-online"></span> ${data.onlineCount || 1} online agora`;
      }
    } catch {}
  }

  // ===== 2. Botões Flutuantes (FAB) =====
  function injectFloatingButtons() {
    if (document.getElementById('gamerFabStack')) return;
    const stack = document.createElement('div');
    stack.id = 'gamerFabStack';
    stack.className = 'gamer-fab-stack';
    stack.innerHTML = `
      <button type="button" class="gamer-fab" id="fabChatBtn" title="Ir para o Chat Global">💬</button>
      <button type="button" class="gamer-fab primary" id="fabAddBtn" title="Adicionar Novo Jogo">➕</button>
    `;
    document.body.appendChild(stack);

    document.getElementById('fabChatBtn').addEventListener('click', () => {
      const chatTab = document.querySelector('[data-tab="chat"]');
      if (chatTab) chatTab.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.getElementById('fabAddBtn').addEventListener('click', () => {
      const libTab = document.querySelector('[data-tab="library"]');
      if (libTab) libTab.click();
      const titleInput = document.getElementById('title') || document.getElementById('gameTitle');
      if (titleInput) {
        titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => titleInput.focus(), 250);
      }
    });
  }

  // ===== 3. Helpers de Emoji & Paleta de Cores =====
  window.buildEmojiBarHtml = function (targetInputId) {
    return `<div class="emoji-bar" data-target="${targetInputId}">
      ${GAMER_EMOJIS.map(e => `<button type="button" class="emoji-chip" data-emoji="${e}">${e}</button>`).join('')}
    </div>`;
  };

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.emoji-chip');
    if (chip) {
      const bar = chip.closest('.emoji-bar');
      const targetId = bar?.dataset?.target;
      const input = targetId ? document.getElementById(targetId) : null;
      if (input) {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        const emoji = chip.dataset.emoji;
        input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
        input.focus();
        input.selectionStart = input.selectionEnd = start + emoji.length;
      }
      return;
    }

    const swatch = e.target.closest('.color-swatch');
    if (swatch) {
      const row = swatch.closest('.color-picker-row');
      row?.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      const hidden = document.getElementById('postColorInput');
      if (hidden) hidden.value = swatch.dataset.color;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    injectFloatingButtons();
    pingPresence();
    setInterval(pingPresence, 25000);
  });
})();