'use strict';
// VELA — aplicación web. Todo lo que ves aquí habla con el backend real
// (vela-backend) por HTTP; nada se inventa en el navegador.

const API_BASE = window.VELA_API_BASE || 'http://localhost:4000/api';

const state = {
  token: localStorage.getItem('vela_token') || null,
  profiles: [],
  activeProfileId: localStorage.getItem('vela_active_profile') || null,
  panel: 'operacion',
};

// ---------- capa de API ----------
async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  let body = null;
  try { body = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) {
    const err = new Error((body && (body.error || body.message)) || `Error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const Api = {
  register: (email, password) => apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email, password) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  listProfiles: () => apiFetch('/profiles'),
  createProfile: (name, description) => apiFetch('/profiles', { method: 'POST', body: JSON.stringify({ name, description }) }),
  patchProfile: (id, data) => apiFetch(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProfile: (id, confirm) => apiFetch(`/profiles/${id}${confirm ? '?confirm=true' : ''}`, { method: 'DELETE' }),

  listGroups: (profileId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/profiles/${profileId}/groups${q ? '?' + q : ''}`);
  },
  createGroup: (profileId, name, url) => apiFetch(`/profiles/${profileId}/groups`, { method: 'POST', body: JSON.stringify({ name, url }) }),
  patchGroup: (id, data) => apiFetch(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteGroup: (id) => apiFetch(`/groups/${id}`, { method: 'DELETE' }),

  listContents: (profileId) => apiFetch(`/contents?profileId=${profileId}`),
  createContent: (profileId, title, bodyText, imageUrl) => apiFetch('/contents', { method: 'POST', body: JSON.stringify({ profileId, title, bodyText, ...(imageUrl ? { imageUrl } : {}) }) }),
  duplicateContent: (id) => apiFetch(`/contents/${id}/duplicate`, { method: 'POST' }),
  deleteContent: (id) => apiFetch(`/contents/${id}`, { method: 'DELETE' }),

  listCampaigns: (profileId) => apiFetch(`/campaigns?profileId=${profileId}`),
  createCampaign: (data) => apiFetch('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  campaignAction: (id, action) => apiFetch(`/campaigns/${id}/${action}`, { method: 'POST' }),
  deleteCampaign: (id, confirm) => apiFetch(`/campaigns/${id}${confirm ? '?confirm=true' : ''}`, { method: 'DELETE' }),

  listHistory: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/history${q ? '?' + q : ''}`);
  },

  getSettings: () => apiFetch('/settings'),
  patchSettings: (data) => apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(data) }),

  getConnector: (profileId) => apiFetch(`/profiles/${profileId}/connector`),
  generateConnectorKey: (profileId) => apiFetch(`/profiles/${profileId}/connector`, { method: 'POST' }),
  revokeConnectorKey: (profileId) => apiFetch(`/profiles/${profileId}/connector/revoke`, { method: 'POST' }),
};

// ---------- utilidades de interfaz ----------
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function toast(message) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal-card">${html}</div></div>`;
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

const STATUS_LABEL = {
  draft: 'Borrador', scheduled: 'Programada', running: 'En curso', paused: 'Pausada',
  stopped: 'Detenida', completed: 'Completada', error: 'Error',
  active: 'Activo', inactive: 'Inactivo', archived: 'Archivado',
  published: 'Publicado', pending: 'Pendiente',
};
function statusPill(status) {
  return `<span class="pill pill-${status}">${STATUS_LABEL[status] || status}</span>`;
}

// ---------- autenticación ----------
let authMode = 'login';

function renderAuthMode() {
  document.getElementById('authSubmit').textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  document.getElementById('authToggle').innerHTML = authMode === 'login'
    ? '¿No tienes cuenta? <button type="button" id="authToggleBtn">Crear una</button>'
    : '¿Ya tienes cuenta? <button type="button" id="authToggleBtn">Entrar</button>';
  document.getElementById('authToggleBtn').addEventListener('click', () => {
    authMode = authMode === 'login' ? 'register' : 'login';
    renderAuthMode();
  });
}

document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const msg = document.getElementById('authMessage');
  msg.innerHTML = '';
  try {
    const fn = authMode === 'login' ? Api.login : Api.register;
    const res = await fn(email, password);
    state.token = res.token;
    localStorage.setItem('vela_token', res.token);
    await boot();
  } catch (err) {
    msg.innerHTML = `<div class="form-error">${escapeHtml(err.message || 'No se pudo continuar.')}</div>`;
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('vela_token');
  localStorage.removeItem('vela_active_profile');
  window.location.reload();
});

// ---------- navegación ----------
document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
  state.panel = btn.dataset.panel;
  renderCurrentPanel();
});

document.getElementById('profileTrigger').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('profileMenu');
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', () => { document.getElementById('profileMenu').hidden = true; });

function renderProfileSwitcher() {
  const active = state.profiles.find((p) => p.id === state.activeProfileId);
  document.getElementById('profileName').textContent = active ? active.name : 'Sin perfiles';
  const menu = document.getElementById('profileMenu');
  menu.innerHTML = state.profiles.map((p) =>
    `<button data-id="${p.id}">${escapeHtml(p.name)}</button>`
  ).join('') || '<button disabled>No hay perfiles todavía</button>';
  menu.querySelectorAll('button[data-id]').forEach((b) => {
    b.addEventListener('click', () => {
      state.activeProfileId = b.dataset.id;
      localStorage.setItem('vela_active_profile', state.activeProfileId);
      menu.hidden = true;
      renderProfileSwitcher();
      renderCurrentPanel();
    });
  });
}

function renderCurrentPanel() {
  const renderers = {
    operacion: renderOperacion, perfiles: renderPerfiles, grupos: renderGrupos,
    contenido: renderContenido, campanas: renderCampanas, historial: renderHistorial,
    configuracion: renderConfiguracion, conectar: renderConectar,
  };
  (renderers[state.panel] || renderOperacion)();
}

// ---------- Perfiles ----------
async function renderPerfiles() {
  const el = document.getElementById('panel-perfiles');
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Perfiles</h1><p class="page-sub">Cada perfil tiene sus propios grupos, campañas e historial</p></div>
      <button class="btn btn-accent" id="btnAddProfile">+ Agregar perfil</button>
    </div>
    <div class="surface" id="profilesList"><div class="empty-state">Cargando…</div></div>
  `;
  document.getElementById('btnAddProfile').addEventListener('click', () => {
    openModal(`
      <h2>Nuevo perfil</h2>
      <form id="profileForm">
        <div class="field-block"><label>Nombre</label><input id="pfName" required placeholder="Ej. Perfil Norte"></div>
        <div class="field-block"><label>Descripción (opcional)</label><input id="pfDesc" placeholder="Ej. Cuenta de la sucursal norte"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-line" id="pfCancel">Cancelar</button>
          <button type="submit" class="btn btn-accent">Crear perfil</button>
        </div>
      </form>
    `);
    document.getElementById('pfCancel').addEventListener('click', closeModal);
    document.getElementById('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('pfName').value.trim();
      const description = document.getElementById('pfDesc').value.trim();
      await Api.createProfile(name, description || undefined);
      closeModal();
      toast('Perfil creado.');
      await loadProfiles();
      renderPerfiles();
    });
  });

  const list = document.getElementById('profilesList');
  const profiles = state.profiles;
  if (!profiles.length) {
    list.innerHTML = '<div class="empty-state">Todavía no has agregado ningún perfil.</div>';
    return;
  }
  list.innerHTML = profiles.map((p) => `
    <div class="list-row" data-row="${p.id}">
      <div class="list-main">
        <div class="list-title">${escapeHtml(p.name)}</div>
        <div class="list-meta">${statusPill(p.status)}</div>
      </div>
      <div class="list-actions">
        <button class="btn btn-danger btn-sm" data-delete="${p.id}">Eliminar</button>
      </div>
    </div>
    <div class="warning-banner hidden" id="warn-${p.id}"></div>
  `).join('');

  list.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteProfile(btn.dataset.delete));
  });
}

async function confirmDeleteProfile(id, force) {
  const warn = document.getElementById('warn-' + id);
  try {
    await Api.deleteProfile(id, force);
    toast(force ? 'Perfil archivado.' : 'Perfil eliminado.');
    if (state.activeProfileId === id) {
      state.activeProfileId = null;
    }
    await loadProfiles();
    renderPerfiles();
  } catch (err) {
    if (err.status === 409 && err.body && err.body.error === 'HAS_DEPENDENCIES') {
      const d = err.body.dependencies;
      warn.classList.remove('hidden');
      warn.innerHTML = `
        <div>Este perfil tiene <strong>${d.groups}</strong> grupo(s), <strong>${d.campaigns}</strong> campaña(s),
        <strong>${d.contents}</strong> contenido(s) y <strong>${d.connections}</strong> conexión(es) de VELA Connect.
        Si continúas, se archivará y su historial se conservará.
        <div class="wb-actions">
          <button class="btn btn-line btn-sm" id="cancel-${id}">Cancelar</button>
          <button class="btn btn-danger btn-sm" id="confirm-${id}">Archivar de todas formas</button>
        </div></div>`;
      document.getElementById('cancel-' + id).addEventListener('click', () => warn.classList.add('hidden'));
      document.getElementById('confirm-' + id).addEventListener('click', () => confirmDeleteProfile(id, true));
    } else {
      toast('No se pudo eliminar: ' + err.message);
    }
  }
}

// ---------- Grupos ----------
async function renderGrupos() {
  const el = document.getElementById('panel-grupos');
  if (!state.activeProfileId) { el.innerHTML = noProfileMessage(); return; }
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Grupos</h1><p class="page-sub">${escapeHtml(activeProfileName())}</p></div>
      <button class="btn btn-accent" id="btnAddGroup">+ Agregar grupo</button>
    </div>
    <div class="surface">
      <div class="toolbar">
        <div class="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/></svg>
          <input type="text" id="groupSearch" placeholder="Buscar por nombre o URL…">
        </div>
        <button class="icon-btn" id="btnRefreshGroups" title="Actualizar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><polyline points="18 3 18 7 14 7"/><polyline points="6 21 6 17 10 17"/></svg>
        </button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>URL</th><th>Origen</th><th>Estado</th><th></th></tr></thead>
          <tbody id="groupsBody"><tr><td colspan="5" class="cell-muted">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  async function load() {
    const query = document.getElementById('groupSearch').value.trim();
    const groups = await Api.listGroups(state.activeProfileId, query ? { query } : {});
    const body = document.getElementById('groupsBody');
    if (!groups.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No hay grupos todavía. Agrega uno o impórtalos desde VELA Connect.</td></tr>';
      return;
    }
    body.innerHTML = groups.map((g) => `
      <tr>
        <td>${escapeHtml(g.name)}</td>
        <td class="cell-url">${escapeHtml(g.url)}</td>
        <td class="cell-muted">${g.importedFrom === 'connector' ? 'VELA Connect' : 'Manual'}</td>
        <td>${statusPill(g.status)}</td>
        <td><button class="btn btn-danger btn-sm" data-del="${g.id}">Eliminar</button></td>
      </tr>
    `).join('');
    body.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await Api.deleteGroup(btn.dataset.del);
        toast('Grupo eliminado (el historial que lo usó se conserva).');
        load();
      });
    });
  }

  document.getElementById('groupSearch').addEventListener('input', debounce(load, 300));
  document.getElementById('btnRefreshGroups').addEventListener('click', load);
  document.getElementById('btnAddGroup').addEventListener('click', () => {
    openModal(`
      <h2>Agregar grupo</h2>
      <form id="groupForm">
        <div class="field-block"><label>Nombre del grupo</label><input id="gName" required></div>
        <div class="field-block"><label>URL del grupo de Facebook</label><input id="gUrl" required placeholder="https://www.facebook.com/groups/..."></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-line" id="gCancel">Cancelar</button>
          <button type="submit" class="btn btn-accent">Agregar</button>
        </div>
      </form>
    `);
    document.getElementById('gCancel').addEventListener('click', closeModal);
    document.getElementById('groupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Api.createGroup(state.activeProfileId, document.getElementById('gName').value.trim(), document.getElementById('gUrl').value.trim());
        closeModal();
        toast('Grupo agregado.');
        load();
      } catch (err) {
        toast('No se pudo agregar: ' + err.message);
      }
    });
  });

  load();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Redimensiona/comprime una imagen en el navegador antes de guardarla, para
// no saturar la base de datos ni el envío hacia la extensión. Devuelve una
// data URL (imagen incrustada como texto) lista para guardar como imageUrl.
function resizeImageToDataUrl(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) {
      reject(new Error('El archivo elegido no es una imagen.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo abrir esa imagen.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Contenido ----------
async function renderContenido() {
  const el = document.getElementById('panel-contenido');
  if (!state.activeProfileId) { el.innerHTML = noProfileMessage(); return; }
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Contenido</h1><p class="page-sub">${escapeHtml(activeProfileName())}</p></div>
      <button class="btn btn-accent" id="btnAddContent">+ Crear contenido</button>
    </div>
    <div class="surface" id="contentList"><div class="empty-state">Cargando…</div></div>
  `;

  async function load() {
    const items = await Api.listContents(state.activeProfileId);
    const list = document.getElementById('contentList');
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Todavía no has creado ningún contenido.</div>';
      return;
    }
    list.innerHTML = items.map((c) => `
      <div class="content-card">
        <div class="row-flex" style="justify-content:space-between;">
          <div class="list-title">${escapeHtml(c.title)}${c.imageUrl ? ' <span class="cell-muted" style="font-weight:400;">(con imagen)</span>' : ''}</div>
          <div class="list-actions">
            <button class="btn btn-line btn-sm" data-preview="${c.id}">Vista previa</button>
            <button class="btn btn-line btn-sm" data-dup="${c.id}">Duplicar</button>
            <button class="btn btn-danger btn-sm" data-del="${c.id}">Eliminar</button>
          </div>
        </div>
        <div class="content-preview hidden" id="preview-${c.id}">
          ${c.imageUrl ? `<img src="${escapeHtml(c.imageUrl)}" alt="" style="max-width:220px;border-radius:8px;display:block;margin-bottom:8px;">` : ''}
          ${escapeHtml(c.bodyText)}
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-preview]').forEach((b) => b.addEventListener('click', () => {
      const p = document.getElementById('preview-' + b.dataset.preview);
      p.classList.toggle('hidden');
    }));
    list.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', async () => {
      await Api.duplicateContent(b.dataset.dup); toast('Contenido duplicado.'); load();
    }));
    list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      await Api.deleteContent(b.dataset.del); toast('Contenido eliminado.'); load();
    }));
  }

  document.getElementById('btnAddContent').addEventListener('click', () => {
    let pendingImageDataUrl = null;
    openModal(`
      <h2>Nuevo contenido</h2>
      <form id="contentForm">
        <div class="field-block"><label>Título (solo para identificarlo en VELA)</label><input id="cTitle" required></div>
        <div class="field-block"><label>Texto que se publicará</label><textarea id="cBody" required placeholder="Escribe el texto exacto, con saltos de línea y emojis si quieres."></textarea></div>
        <div class="field-block">
          <label>Imagen (opcional)</label>
          <input type="file" id="cImage" accept="image/*">
          <div class="cell-muted" id="cImageStatus" style="margin-top:6px;"></div>
          <img id="cImagePreview" class="hidden" style="max-width:220px;border-radius:8px;margin-top:8px;display:none;">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-line" id="cCancel">Cancelar</button>
          <button type="submit" class="btn btn-accent">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cCancel').addEventListener('click', closeModal);
    document.getElementById('cImage').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const status = document.getElementById('cImageStatus');
      const preview = document.getElementById('cImagePreview');
      if (!file) { pendingImageDataUrl = null; status.textContent = ''; preview.style.display = 'none'; return; }
      status.textContent = 'Preparando imagen…';
      try {
        pendingImageDataUrl = await resizeImageToDataUrl(file, 1280, 0.82);
        preview.src = pendingImageDataUrl;
        preview.style.display = 'block';
        status.textContent = 'Imagen lista (' + Math.round(pendingImageDataUrl.length / 1024) + ' KB).';
      } catch (err) {
        pendingImageDataUrl = null;
        preview.style.display = 'none';
        status.textContent = 'No se pudo procesar esa imagen: ' + (err.message || err);
      }
    });
    document.getElementById('contentForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Api.createContent(
          state.activeProfileId,
          document.getElementById('cTitle').value.trim(),
          document.getElementById('cBody').value,
          pendingImageDataUrl
        );
      } catch (err) {
        toast('No se pudo guardar: ' + err.message);
        return;
      }
      closeModal(); toast('Contenido guardado.'); load();
    });
  });

  load();
}

// ---------- Campañas ----------
async function renderCampanas() {
  const el = document.getElementById('panel-campanas');
  if (!state.activeProfileId) { el.innerHTML = noProfileMessage(); return; }
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Campañas</h1><p class="page-sub">${escapeHtml(activeProfileName())}</p></div>
      <button class="btn btn-accent" id="btnAddCampaign">+ Nueva campaña</button>
    </div>
    <div class="surface" id="campaignsList"><div class="empty-state">Cargando…</div></div>
  `;

  async function load() {
    const items = await Api.listCampaigns(state.activeProfileId);
    const list = document.getElementById('campaignsList');
    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Todavía no has creado ninguna campaña.</div>';
      return;
    }
    list.innerHTML = items.map((c) => `
      <div class="list-row">
        <div class="list-main">
          <div class="list-title">${escapeHtml(c.name)}</div>
          <div class="list-meta">${statusPill(c.status)}<span>${c.processed} de ${c.total} procesados</span></div>
        </div>
        <div class="list-actions">${campaignActions(c)}</div>
      </div>
    `).join('');
    list.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', async () => {
        try {
          if (b.dataset.action === 'delete') {
            await deleteCampaignFlow(b.dataset.id);
          } else {
            await Api.campaignAction(b.dataset.id, b.dataset.action);
          }
          load();
        } catch (err) { toast('No se pudo: ' + err.message); }
      });
    });
  }

  async function deleteCampaignFlow(id) {
    try {
      await Api.deleteCampaign(id);
      toast('Campaña eliminada.');
    } catch (err) {
      if (err.status === 409 && err.body && err.body.error === 'HAS_HISTORY') {
        if (confirm(`Esta campaña tiene ${err.body.historyCount} registro(s) en el historial, que se conservarán. ¿Eliminar la campaña de todas formas?`)) {
          await Api.deleteCampaign(id, true);
          toast('Campaña eliminada. Su historial se conserva.');
        }
      } else {
        throw err;
      }
    }
  }

  document.getElementById('btnAddCampaign').addEventListener('click', async () => {
    const [contents, groups] = await Promise.all([
      Api.listContents(state.activeProfileId),
      Api.listGroups(state.activeProfileId, { status: 'active' }),
    ]);
    if (!contents.length || !groups.length) {
      toast('Necesitas al menos un contenido y un grupo activo antes de crear una campaña.');
      return;
    }
    openModal(`
      <h2>Nueva campaña</h2>
      <form id="campaignForm">
        <div class="field-block"><label>Nombre de la campaña</label><input id="cmName" required></div>
        <div class="field-block"><label>Contenido</label>
          <select id="cmContent">${contents.map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('')}</select>
        </div>
        <div class="field-block"><label>Grupos</label>
          <div class="checkbox-list">
            ${groups.map((g) => `<label class="checkbox-row"><input type="checkbox" value="${g.id}" checked> ${escapeHtml(g.name)}</label>`).join('')}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-line" id="cmCancel">Cancelar</button>
          <button type="submit" class="btn btn-accent">Crear campaña</button>
        </div>
      </form>
    `);
    document.getElementById('cmCancel').addEventListener('click', closeModal);
    document.getElementById('campaignForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const groupIds = Array.from(document.querySelectorAll('#campaignForm .checkbox-row input:checked')).map((i) => i.value);
      if (!groupIds.length) { toast('Selecciona al menos un grupo.'); return; }
      await Api.createCampaign({
        profileId: state.activeProfileId,
        contentId: document.getElementById('cmContent').value,
        groupIds,
        name: document.getElementById('cmName').value.trim(),
      });
      closeModal(); toast('Campaña creada como borrador.'); load();
    });
  });

  load();
}

function campaignActions(c) {
  const del = `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">Eliminar</button>`;
  if (c.status === 'draft' || c.status === 'scheduled') {
    return `<button class="btn btn-accent btn-sm" data-action="start" data-id="${c.id}">Iniciar</button>${del}`;
  }
  if (c.status === 'running') {
    return `<button class="btn btn-line btn-sm" data-action="pause" data-id="${c.id}">Pausar</button>
            <button class="btn btn-danger btn-sm" data-action="stop" data-id="${c.id}">Detener</button>`;
  }
  if (c.status === 'paused') {
    return `<button class="btn btn-accent btn-sm" data-action="resume" data-id="${c.id}">Reanudar</button>
            <button class="btn btn-danger btn-sm" data-action="stop" data-id="${c.id}">Detener</button>`;
  }
  return del;
}

// ---------- Operación ----------
async function renderOperacion() {
  const el = document.getElementById('panel-operacion');
  if (!state.activeProfileId) { el.innerHTML = noProfileMessage(); return; }
  el.innerHTML = `
    <div class="page-head">
      <div><h1>Operación</h1><p class="page-sub">Centro de control — ${escapeHtml(activeProfileName())}</p></div>
    </div>
    <div class="op-grid" id="opGrid"><div class="empty-state">Cargando…</div></div>
  `;
  const items = (await Api.listCampaigns(state.activeProfileId)).filter((c) => ['running', 'paused'].includes(c.status));
  const grid = document.getElementById('opGrid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state">No hay campañas activas en este perfil ahora mismo.</div>';
    return;
  }
  grid.innerHTML = items.map((c) => `
    <div class="op-card" data-status="${c.status === 'running' ? 'running' : 'paused'}">
      <div class="op-card-head">
        <div class="op-card-title">${escapeHtml(c.name)}</div>
        ${statusPill(c.status)}
      </div>
      <div class="op-progress-row">
        <span>${c.processed} de ${c.total} procesados</span>
        <div class="op-progress-bar"><div class="op-progress-fill" style="width:${c.total ? Math.round((c.processed / c.total) * 100) : 0}%; ${c.status === 'paused' ? 'background:var(--warning);' : ''}"></div></div>
      </div>
      <div class="op-card-controls">
        ${c.status === 'running'
          ? `<button class="btn btn-line btn-sm" data-action="pause" data-id="${c.id}">Pausar</button><button class="btn btn-danger btn-sm" data-action="stop" data-id="${c.id}">Detener</button>`
          : `<button class="btn btn-accent btn-sm" data-action="resume" data-id="${c.id}">Reanudar</button><button class="btn btn-danger btn-sm" data-action="stop" data-id="${c.id}">Detener</button>`}
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('click', async () => { await Api.campaignAction(b.dataset.id, b.dataset.action); renderOperacion(); });
  });
}

// ---------- Historial ----------
async function renderHistorial() {
  const el = document.getElementById('panel-historial');
  if (!state.activeProfileId) { el.innerHTML = noProfileMessage(); return; }
  el.innerHTML = `
    <div class="page-head"><div><h1>Historial</h1><p class="page-sub">Se conserva aunque elimines un perfil, grupo, contenido o campaña</p></div></div>
    <div class="surface">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Grupo</th><th>Campaña</th><th>Estado</th><th>Resultado</th></tr></thead>
          <tbody id="historyBody"><tr><td colspan="5" class="cell-muted">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  const rows = await Api.listHistory({ profileId: state.activeProfileId });
  const body = document.getElementById('historyBody');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">Todavía no hay historial en este perfil.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td class="cell-muted">${formatDateTime(r.executedAt)}</td>
      <td>${escapeHtml(r.group || '—')}</td>
      <td>${escapeHtml(r.campaign || '—')}</td>
      <td>${statusPill(r.status)}</td>
      <td class="${r.confirmationUrl ? 'cell-url' : 'cell-muted'}">${escapeHtml(r.confirmationUrl || r.errorMessage || '—')}</td>
    </tr>
  `).join('');
}

// ---------- Configuración ----------
async function renderConfiguracion() {
  const el = document.getElementById('panel-configuracion');
  el.innerHTML = `
    <div class="page-head"><div><h1>Configuración</h1><p class="page-sub">Un único ajuste para todo el sistema</p></div></div>
    <div class="surface">
      <div class="config-grid" id="configGrid"><div class="empty-state">Cargando…</div></div>
      <div class="config-actions"><button class="btn btn-accent" id="btnSaveSettings">Guardar cambios</button></div>
    </div>
  `;
  const s = await Api.getSettings();
  document.getElementById('configGrid').innerHTML = `
    <div class="field"><label>Intervalo mínimo entre publicaciones (minutos)</label><input id="cfMin" value="${s.minIntervalMinutes}"></div>
    <div class="field"><label>Máximo de publicaciones por bloque</label><input id="cfMax" value="${s.maxPerBlock}"></div>
    <div class="field"><label>Espera entre bloques (minutos)</label><input id="cfWait" value="${s.blockWaitMinutes}"></div>
    <div class="field"><label>Límite diario por perfil</label><input id="cfDaily" value="${s.dailyLimitPerProfile}"></div>
    <div class="field"><label>Hora inicial permitida</label><input id="cfStart" value="${s.allowedStartTime}"></div>
    <div class="field"><label>Hora final permitida</label><input id="cfEnd" value="${s.allowedEndTime}"></div>
  `;
  document.getElementById('btnSaveSettings').addEventListener('click', async () => {
    await Api.patchSettings({
      minIntervalMinutes: Number(document.getElementById('cfMin').value),
      maxPerBlock: Number(document.getElementById('cfMax').value),
      blockWaitMinutes: Number(document.getElementById('cfWait').value),
      dailyLimitPerProfile: Number(document.getElementById('cfDaily').value),
      allowedStartTime: document.getElementById('cfStart').value,
      allowedEndTime: document.getElementById('cfEnd').value,
    });
    toast('Configuración guardada.');
  });
}

// ---------- VELA Connect ----------
async function renderConectar() {
  const el = document.getElementById('panel-conectar');
  if (!state.activeProfileId) { el.innerHTML = noProfileMessage(); return; }
  el.innerHTML = `
    <div class="page-head"><div><h1>VELA Connect</h1><p class="page-sub">${escapeHtml(activeProfileName())}</p></div></div>
    <div class="surface connect-card" id="connectCard"><div class="empty-state">Cargando…</div></div>
  `;
  const info = await Api.getConnector(state.activeProfileId);
  const card = document.getElementById('connectCard');
  const connected = info && info.status === 'connected';
  card.innerHTML = `
    <div class="row-flex" style="justify-content:space-between;">
      <div class="connect-status">
        <span class="dot ${connected ? 'dot-online' : 'dot-offline'}" style="width:11px;height:11px;"></span>
        <strong>${connected ? 'Conectado' : 'Desconectado'}</strong>
      </div>
      <button class="btn btn-line btn-sm" id="btnNewKey">Generar nueva clave de conexión</button>
    </div>
    ${info ? `
      <div class="connect-grid">
        <div><div class="kv-label">Installation ID</div><div class="kv-value">${escapeHtml(info.installationId)}</div></div>
        <div><div class="kv-label">Versión</div><div class="kv-value">${escapeHtml(info.extensionVersion || '—')}</div></div>
        <div><div class="kv-label">Última comunicación</div><div class="kv-value">${formatDateTime(info.lastSeenAt)}</div></div>
        <div><div class="kv-label">Última tarea</div><div class="kv-value">${formatDateTime(info.lastTaskAt)}</div></div>
        <div><div class="kv-label">Último error</div><div class="kv-value">${escapeHtml(info.lastErrorMessage || 'Sin errores recientes')}</div></div>
      </div>` : '<p class="cell-muted">Este perfil todavía no tiene una clave de conexión generada.</p>'}
    <div class="safety-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><polyline points="9 12 11 14 15 10"/></svg>
      VELA Connect nunca almacena ni solicita tu contraseña de Facebook.
    </div>
  `;
  document.getElementById('btnNewKey').addEventListener('click', async () => {
    const res = await Api.generateConnectorKey(state.activeProfileId);
    openModal(`
      <h2>Clave de conexión generada</h2>
      <p class="cell-muted" style="margin-bottom:10px;">Cópiala ahora: no se volverá a mostrar. Pégala en el popup de VELA Connect.</p>
      <div class="field-block"><label>Installation ID</label><input readonly value="${escapeHtml(res.installationId)}"></div>
      <div class="field-block"><label>Clave</label><input readonly value="${escapeHtml(res.connectorKey)}" class="mono-key"></div>
      <div class="modal-actions"><button class="btn btn-accent" id="closeKeyModal">Listo</button></div>
    `);
    document.getElementById('closeKeyModal').addEventListener('click', () => { closeModal(); renderConectar(); });
  });
}

function noProfileMessage() {
  return '<div class="empty-state">Primero crea un Perfil en la sección "Perfiles".</div>';
}
function activeProfileName() {
  const p = state.profiles.find((x) => x.id === state.activeProfileId);
  return p ? p.name : '';
}

// ---------- arranque ----------
async function loadProfiles() {
  state.profiles = await Api.listProfiles();
  if (!state.activeProfileId || !state.profiles.some((p) => p.id === state.activeProfileId)) {
    state.activeProfileId = state.profiles.length ? state.profiles[0].id : null;
    if (state.activeProfileId) localStorage.setItem('vela_active_profile', state.activeProfileId);
  }
  renderProfileSwitcher();
}

async function boot() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  await loadProfiles();
  renderCurrentPanel();
}

(async function start() {
  renderAuthMode();
  if (state.token) {
    try { await boot(); }
    catch (e) { localStorage.removeItem('vela_token'); state.token = null; }
  }
})();
