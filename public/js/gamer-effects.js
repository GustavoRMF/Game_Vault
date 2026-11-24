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
  // ===== 4. Cálculo de Nível, Patente e Barra de XP =====
  window.calculatePlayerXP = function ({ totalGames = 0, totalHours = 0, completed = 0, platinums = 0 }) {
    const xp = Math.round(
      (Number(totalHours) * 10) +
      (Number(completed) * 250) +
      (Number(platinums) * 600) +
      (Number(totalGames) * 50)
    );
    const level = Math.max(1, Math.floor(xp / 1000) + 1);
    const currentLevelXp = xp % 1000;
    const progressPct = Math.min(100, Math.round((currentLevelXp / 1000) * 100));

    let title = 'Novato';
    let icon = '🕹️';
    if (level >= 40)      { title = 'Lenda do GameVault'; icon = '👑'; }
    else if (level >= 25) { title = 'Mestre Gamer';       icon = '🔥'; }
    else if (level >= 15) { title = 'Veterano';           icon = '⚔️'; }
    else if (level >= 8)  { title = 'Caçador de Troféus'; icon = '🏆'; }
    else if (level >= 3)  { title = 'Explorador';         icon = '🧭'; }

    return { xp, level, currentLevelXp, progressPct, title, icon };
  };

  window.renderHeaderXpWidget = function (gamesList) {
    const headerTop = document.querySelector('.header-top > div');
    if (!headerTop || !Array.isArray(gamesList)) return;

    const stats = {
      totalGames: gamesList.length,
      totalHours: gamesList.reduce((acc, g) => acc + (Number(g.hours) || 0), 0),
      completed: gamesList.filter(g => g.status === 'Zerado' || g.status === '100%').length,
      platinums: gamesList.filter(g => g.status === '100%').length
    };
    const info = window.calculatePlayerXP(stats);

    let box = document.getElementById('headerXpWidget');
    if (!box) {
      box = document.createElement('div');
      box.id = 'headerXpWidget';
      box.className = 'xp-widget';
      headerTop.appendChild(box);
    }

    box.innerHTML = `
      <div class="xp-widget-top">
        <span class="xp-rank-badge">${info.icon} Nível ${info.level} • ${info.title}</span>
        <span style="color:var(--muted);">${info.currentLevelXp} / 1.000 XP (${info.xp.toLocaleString('pt-BR')} XP total)</span>
      </div>
      <div class="xp-bar-track">
        <div class="xp-bar-fill" style="width:${info.progressPct}%"></div>
      </div>
    `;
  };
})();