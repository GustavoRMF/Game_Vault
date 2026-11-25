// ========================================
// GameVault - Meu Perfil (30 Capas de Jogos, Foto, Nome & Consoles)
// ========================================

const PRESET_GAMER_AVATARS = [
  { id: 'gow',         name: 'God of War',            img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1593500/library_600x900.jpg' },
  { id: 'gowr',        name: 'GoW Ragnarök',          img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2322010/library_600x900.jpg' },
  { id: 'tlou1',       name: 'The Last of Us',        img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1888930/library_600x900.jpg' },
  { id: 'spiderman',   name: 'Spider-Man',            img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1817070/library_600x900.jpg' },
  { id: 'miles',       name: 'Miles Morales',         img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1817190/library_600x900.jpg' },
  { id: 'ghost',       name: 'Ghost of Tsushima',     img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2215430/library_600x900.jpg' },
  { id: 'horizon',     name: 'Horizon Zero Dawn',     img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1151640/library_600x900.jpg' },
  { id: 'daysgone',    name: 'Days Gone',             img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1259420/library_600x900.jpg' },
  { id: 'uncharted',   name: 'Uncharted 4',           img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1659420/library_600x900.jpg' },
  { id: 'rdr2',        name: 'Red Dead 2',            img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1174180/library_600x900.jpg' },
  { id: 'gtav',        name: 'GTA V',                 img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/271590/library_600x900.jpg' },
  { id: 'cyberpunk',   name: 'Cyberpunk 2077',        img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/library_600x900.jpg' },
  { id: 'witcher3',    name: 'The Witcher 3',         img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/292030/library_600x900.jpg' },
  { id: 'eldenring',   name: 'Elden Ring',            img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_600x900.jpg' },
  { id: 'sekiro',      name: 'Sekiro',                img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/814380/library_600x900.jpg' },
  { id: 'ds3',         name: 'Dark Souls III',        img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/374320/library_600x900.jpg' },
  { id: 're4',         name: 'Resident Evil 4',       img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2050650/library_600x900.jpg' },
  { id: 're2',         name: 'Resident Evil 2',       img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/883710/library_600x900.jpg' },
  { id: 'revillage',   name: 'RE Village',            img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1196590/library_600x900.jpg' },
  { id: 'silenthill2', name: 'Silent Hill 2',         img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2124490/library_600x900.jpg' },
  { id: 'bg3',         name: 'Baldur’s Gate 3',       img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1086940/library_600x900.jpg' },
  { id: 'hogwarts',    name: 'Hogwarts Legacy',       img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/990080/library_600x900.jpg' },
  { id: 'starfield',   name: 'Starfield',             img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1716740/library_600x900.jpg' },
  { id: 'halo',        name: 'Halo Infinite',         img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1240440/library_600x900.jpg' },
  { id: 'forza5',      name: 'Forza Horizon 5',       img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1551360/library_600x900.jpg' },
  { id: 'mk1',         name: 'Mortal Kombat 1',       img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1971870/library_600x900.jpg' },
  { id: 'sf6',         name: 'Street Fighter 6',      img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1364780/library_600x900.jpg' },
  { id: 'tekken8',     name: 'Tekken 8',              img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1778820/library_600x900.jpg' },
  { id: 'hollow',      name: 'Hollow Knight',         img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/library_600x900.jpg' },
  { id: 'cuphead',     name: 'Cuphead',               img: 'https://cdn.cloudflare.steamstatic.com/steam/apps/268910/library_600x900.jpg' }
];

let myProfileData = {
  username: '',
  avatar: '',
  birthday: '',
  consoles: []
};

// Renderiza o avatar (foto base64, URL de capa ou inicial) em qualquer lugar do app
window.renderAvatarHtml = function (avatarValue, username = '?', size = 34) {
  let val = String(avatarValue || '').trim();

  if (val.startsWith('preset:')) {
    const presetId = val.replace('preset:', '');
    const found = PRESET_GAMER_AVATARS.find(a => a.id === presetId);
    val = found ? found.img : '';
  }

  if (val.startsWith('data:image/') || val.startsWith('http://') || val.startsWith('https://')) {
    return `<img src="${escapeHtml(val)}" alt="" class="gv-avatar-img" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;object-position:center top;border:1px solid rgba(56,189,248,0.55);background:#0f172a;flex-shrink:0;">`;
  }

  const initial = escapeHtml((username || '?').charAt(0).toUpperCase());
  return `<span class="gv-avatar-badge" style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,#003791,#0070d1);display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.44)}px;font-weight:700;color:#fff;border:1px solid rgba(56,189,248,0.4);flex-shrink:0;">${initial}</span>`;
};

function updateHeaderUserBadge() {
  const pill = document.querySelector('.user-pill');
  if (!pill || !currentUser) return;
  const avatarHtml = window.renderAvatarHtml(myProfileData.avatar, currentUser.username, 24);
  pill.style.display = 'inline-flex';
  pill.style.alignItems = 'center';
  pill.style.gap = '8px';
  pill.innerHTML = `${avatarHtml} <strong id="current-username">${escapeHtml(currentUser.username)}</strong>`;
}

function renderAvatarPickerGrid() {
  const grid = document.getElementById('avatar-presets-grid');
  if (!grid) return;

  grid.innerHTML = PRESET_GAMER_AVATARS.map(av => {
    const isSelected = myProfileData.avatar === av.img || myProfileData.avatar === `preset:${av.id}`;
    return `
      <button type="button" class="avatar-preset-item ${isSelected ? 'selected' : ''}" data-avatar-url="${escapeHtml(av.img)}" title="${escapeHtml(av.name)}">
        <img src="${escapeHtml(av.img)}" alt="${escapeHtml(av.name)}" loading="lazy" class="avatar-preset-circle" style="object-fit:cover;object-position:center top;background:#0f172a;">
        <span class="avatar-preset-label">${escapeHtml(av.name)}</span>
      </button>
    `;
  }).join('');
}

function updateProfilePreview() {
  const previewBox = document.getElementById('profile-avatar-preview');
  const nameInput = document.getElementById('profile-username-input');
  const displayName = (nameInput?.value || currentUser?.username || 'Jogador').trim();

  if (previewBox) {
    previewBox.innerHTML = window.renderAvatarHtml(myProfileData.avatar, displayName, 84);
  }
  renderAvatarPickerGrid();
}

async function loadMyProfile() {
  if (!authToken) return;
  try {
    const res = await apiFetch('/api/me/profile');
    if (!res.ok) return;
    const data = await res.json();
    myProfileData = {
      username: data.username || currentUser?.username || '',
      avatar: data.avatar || '',
      birthday: data.birthday || '',
      consoles: Array.isArray(data.consoles) ? data.consoles : []
    };

    const nameInput = document.getElementById('profile-username-input');
    const bdayInput = document.getElementById('profile-birthday-input');
    if (nameInput) nameInput.value = myProfileData.username;
    if (bdayInput) bdayInput.value = myProfileData.birthday;

    document.querySelectorAll('input[name="profile-console"]').forEach(cb => {
      cb.checked = myProfileData.consoles.includes(cb.value);
    });

    updateProfilePreview();
    updateHeaderUserBadge();
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
  }
}

// Redimensiona a foto escolhida pelo usuário para 180x180px JPEG leve
function resizeImageToDataUrl(file, maxSize = 180) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');

        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, maxSize, maxSize);

        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

// Clique nas capas de jogos predefinidas
document.getElementById('avatar-presets-grid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.avatar-preset-item');
  if (!btn) return;
  myProfileData.avatar = btn.dataset.avatarUrl;
  updateProfilePreview();
});

// Upload de foto personalizada
document.getElementById('profile-photo-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    const resized = await resizeImageToDataUrl(file, 180);
    myProfileData.avatar = resized;
    updateProfilePreview();
    showToast('Foto carregada! Clique em "Salvar Perfil" para confirmar.');
  } catch (err) {
    showToast(err.message || 'Erro ao processar foto.');
  }
});

// Remover foto/avatar
document.getElementById('profile-clear-avatar-btn')?.addEventListener('click', () => {
  myProfileData.avatar = '';
  updateProfilePreview();
});

document.getElementById('profile-username-input')?.addEventListener('input', updateProfilePreview);

// Salvar formulário de Meu Perfil
document.getElementById('my-profile-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('profile-username-input').value.trim();
  const birthday = document.getElementById('profile-birthday-input').value;
  const consoles = Array.from(document.querySelectorAll('input[name="profile-console"]:checked')).map(cb => cb.value);

  if (username.length < 3) {
    showToast('O nome do perfil deve ter pelo menos 3 caracteres.');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await apiFetch('/api/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        avatar: myProfileData.avatar,
        birthday,
        consoles
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar perfil');

    if (data.token && data.profile) {
      saveSession(data.token, { id: data.profile.id, username: data.profile.username });
      myProfileData = {
        username: data.profile.username,
        avatar: data.profile.avatar,
        birthday: data.profile.birthday,
        consoles: data.profile.consoles
      };
    }

    updateHeaderUserBadge();
    updateProfilePreview();
    showToast('Perfil atualizado com sucesso! 👤');
  } catch (err) {
    if (err.message !== 'Sessão expirada') showToast(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});