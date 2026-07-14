const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: sessionStorage.getItem('ef_admin_token') || '',
  admin: null,
  permissions: [],
  view: 'dashboard',
  page: 1,
  filters: {},
  contentTab: 'rooms',
  operationsTab: 'expeditions',
  liveOpsTab: 'analytics',
  liveOpsCache: {},
  settings: {}
};

const NAV = [
  ['dashboard', 'Сводка', 'Ⅰ', 'Состояние дома'],
  ['users', 'Жильцы', 'Ⅱ', 'Пользователи и прогресс'],
  ['purchases', 'Покупки Stars', 'Ⅲ', 'Платежи и возвраты'],
  ['content', 'Содержимое', 'Ⅳ', 'Комнаты, магазин, события'],
  ['broadcasts', 'Рассылки', 'Ⅴ', 'Сообщения жильцам'],
  ['operations', 'Операции', 'Ⅵ', 'Вылазки и модерация'],
  ['v2', 'V2 · LiveOps', 'Ⅹ', 'Realtime, аналитика и истории'],
  ['settings', 'Настройки дома', 'Ⅶ', 'Аварийные переключатели'],
  ['admins', 'Администраторы', 'Ⅷ', 'Роли и доступ'],
  ['audit', 'Журнал действий', 'Ⅸ', 'История изменений']
];


const NAV_REQUIRED = {
  dashboard: 'dashboard:read', users: 'users:read', purchases: 'purchases:read', content: 'content:read',
  broadcasts: 'broadcasts:read', operations: 'operations:read', v2: 'operations:read', settings: 'settings:read', admins: 'admins:read', audit: 'audit:read'
};

const viewMeta = Object.fromEntries(NAV.map(([id, title, , kicker]) => [id, { title, kicker }]));

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function attr(value = '') { return escapeHtml(value).replace(/`/g, '&#96;'); }
function fmtDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('ru-RU', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}
function fmtNumber(value) { return new Intl.NumberFormat('ru-RU').format(Number(value || 0)); }
function initials(item) { return `${item?.first_name?.[0] || item?.username?.[0] || '?'}${item?.last_name?.[0] || ''}`.toUpperCase(); }
function avatar(item) {
  return `<span class="avatar">${item?.photo_url ? `<img src="${attr(item.photo_url)}" alt="">` : escapeHtml(initials(item))}</span>`;
}
function statusBadge(status) {
  const map = {
    paid: ['Оплачено', 'ok'], pending: ['Ожидает', 'warning'], refunded: ['Возврат', 'neutral'], cancelled: ['Отменено', 'danger'],
    active: ['Активна', 'ok'], escaped: ['Вернулся', 'ok'], lost: ['Потерян', 'danger'], draft: ['Черновик', 'neutral'],
    queued: ['В очереди', 'warning'], running: ['Отправляется', 'ok'], paused: ['Пауза', 'warning'], completed: ['Завершена', 'ok'],
    archived: ['Архив', 'neutral'], true: ['Включено', 'ok'], false: ['Выключено', 'danger']
  };
  const [label, kind] = map[String(status)] || [String(status ?? '—'), 'neutral'];
  return `<span class="pill ${kind}">${escapeHtml(label)}</span>`;
}
function button(label, action, id = '', className = 'ghost', extra = '') {
  return `<button class="button small ${className}" data-action="${attr(action)}" data-id="${attr(id)}" ${extra}>${escapeHtml(label)}</button>`;
}
function json(value) { return escapeHtml(JSON.stringify(value ?? {}, null, 2)); }
function queryString(object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(object)) if (value !== undefined && value !== null && value !== '') params.set(key, value);
  return params.toString();
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(`/admin/api${path}`, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.includes('/auth/login')) {
    logout(false);
    throw new Error(payload.error || 'Сессия истекла');
  }
  if (!response.ok) throw new Error(payload.error || `Ошибка ${response.status}`);
  return payload;
}

function toast(message, type = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toastStack').append(node);
  setTimeout(() => node.remove(), 4200);
}

function setLoading() { $('#content').innerHTML = '<div class="loading">Проверяем журналы и замки…</div>'; }
function updateHeader() {
  const meta = viewMeta[state.view];
  $('#pageTitle').textContent = meta.title;
  $('#pageKicker').textContent = meta.kicker;
  $$('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.view === state.view));
  const maintenance = Boolean(state.settings.maintenance_mode);
  $('#maintenanceBadge').className = `status-badge ${maintenance ? 'danger' : 'ok'}`;
  $('#maintenanceBadge').textContent = maintenance ? 'техработы' : 'дом открыт';
}
function renderNavigation() {
  const visible = NAV.filter(([id]) => state.admin?.role === 'superadmin' || state.admin?.permissions?.includes(NAV_REQUIRED[id]));
  $('#navigation').innerHTML = visible.map(([id, title, icon]) => `<button class="nav-item" data-view="${id}"><span class="nav-icon">${icon}</span>${escapeHtml(title)}</button>`).join('');
}
function showApp() {
  $('#loginScreen').hidden = true;
  $('#appShell').hidden = false;
  $('#adminIdentity').innerHTML = `<strong>${escapeHtml(state.admin.username)}</strong><span>${escapeHtml(state.admin.role)} · ${state.admin.permissions.length} прав</span>`;
  renderNavigation();
  updateHeader();
}
function showLogin() {
  $('#appShell').hidden = true;
  $('#loginScreen').hidden = false;
}
function logout(showMessage = true) {
  state.token = '';
  state.admin = null;
  sessionStorage.removeItem('ef_admin_token');
  showLogin();
  if (showMessage) toast('Служебная сессия закрыта');
}

function closeModal() { if ($('#modal').open) $('#modal').close(); }
function openModal({ title, kicker = 'Служебная операция', body, submitText = null, submitClass = 'primary', onSubmit = null, width = null }) {
  $('#modalTitle').textContent = title;
  $('#modalKicker').textContent = kicker;
  $('#modalBody').innerHTML = body;
  $('#modalFooter').innerHTML = `<button type="button" class="button ghost" data-modal-close>Закрыть</button>${submitText ? `<button type="button" id="modalSubmit" class="button ${submitClass}">${escapeHtml(submitText)}</button>` : ''}`;
  if (width) $('#modal').style.maxWidth = width;
  else $('#modal').style.maxWidth = '';
  $$('[data-modal-close]', $('#modal')).forEach(node => node.addEventListener('click', closeModal));
  if (submitText && onSubmit) $('#modalSubmit').addEventListener('click', async () => {
    const submit = $('#modalSubmit');
    submit.disabled = true;
    try { await onSubmit($('#modalBody')); }
    catch (error) { toast(error.message, 'error'); }
    finally { submit.disabled = false; }
  });
  $('#modal').showModal();
}
function formObject(root) {
  const data = Object.fromEntries(new FormData($('form', root)).entries());
  $$('input[type="checkbox"]', root).forEach(input => { data[input.name] = input.checked; });
  return data;
}

async function boot() {
  if (!state.token) return showLogin();
  try {
    const result = await api('/auth/me');
    state.admin = result.admin;
    state.permissions = result.permissions;
    showApp();
    await renderCurrent();
  } catch { showLogin(); }
}

async function renderCurrent() {
  setLoading();
  updateHeader();
  try {
    const renderer = {
      dashboard: renderDashboard,
      users: renderUsers,
      purchases: renderPurchases,
      content: renderContent,
      broadcasts: renderBroadcasts,
      operations: renderOperations,
      v2: renderV2,
      settings: renderSettings,
      admins: renderAdmins,
      audit: renderAudit
    }[state.view];
    await renderer();
    updateHeader();
  } catch (error) {
    $('#content').innerHTML = `<div class="empty"><strong>Не удалось открыть раздел</strong><p>${escapeHtml(error.message)}</p></div>`;
    toast(error.message, 'error');
  }
}

async function renderDashboard() {
  const data = await api('/dashboard');
  const settings = await api('/settings').catch(() => ({ settings: {} }));
  state.settings = settings.settings || {};
  const max = Math.max(1, ...data.series.map(item => Math.max(Number(item.signups), Number(item.runs))));
  $('#content').innerHTML = `
    <div class="metric-grid">
      <article class="metric"><span>Всего жильцов</span><strong>${fmtNumber(data.users)}</strong><small>${fmtNumber(data.dau)} были в доме за сутки</small></article>
      <article class="metric"><span>Получено Stars</span><strong>${fmtNumber(data.paid_stars)}</strong><small>${fmtNumber(data.paid_count)} подтверждённых покупок</small></article>
      <article class="metric"><span>Вылазки сегодня</span><strong>${fmtNumber(data.expeditions_today)}</strong><small>${fmtNumber(data.active_expeditions)} проходят прямо сейчас</small></article>
      <article class="metric"><span>Доверие сообщества</span><strong>${fmtNumber(data.referrals)}</strong><small>${fmtNumber(data.notes)} записок · ${fmtNumber(data.banned)} блокировок</small></article>
    </div>
    <div class="panel-grid">
      <article class="panel span-2">
        <div class="panel-header"><div><h2>Движение за 14 дней</h2><p>Новые жильцы и запущенные вылазки по дням</p></div></div>
        <div class="chart">${data.series.map(item => `<div class="chart-column"><i class="chart-bar" style="height:${Math.max(2, Number(item.signups) / max * 100)}%" title="Новые: ${item.signups}"></i><i class="chart-bar secondary" style="height:${Math.max(2, Number(item.runs) / max * 100)}%" title="Вылазки: ${item.runs}"></i><span class="chart-label">${new Date(item.day).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</span></div>`).join('')}</div>
        <div class="chart-legend"><span><i></i>новые жильцы</span><span><i class="secondary"></i>вылазки</span></div>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h2>Новые жильцы</h2><p>Последние заселения</p></div>${button('Открыть всех', 'go-users')}</div>
        <div class="card-list">${data.recentUsers.length ? data.recentUsers.map(user => `<div class="list-card"><div class="person-cell">${avatar(user)}<div><strong>${escapeHtml(user.first_name)}</strong><span class="subline">${user.username ? '@' + escapeHtml(user.username) : user.id} · кв. ${user.apartment_no}</span></div></div><span class="subline">${fmtDate(user.created_at)}</span></div>`).join('') : '<div class="empty">Пока никого</div>'}</div>
      </article>
      <article class="panel">
        <div class="panel-header"><div><h2>Последние покупки</h2><p>Инвойсы Telegram Stars</p></div>${button('Все платежи', 'go-purchases')}</div>
        <div class="card-list">${data.recentPurchases.length ? data.recentPurchases.map(item => `<div class="list-card"><div><h3>${escapeHtml(item.sku)}</h3><p>${escapeHtml(item.first_name)} ${item.username ? '· @' + escapeHtml(item.username) : ''}</p><div class="list-meta">${statusBadge(item.status)}<span class="pill neutral">${fmtNumber(item.stars)} ★</span></div></div><span class="subline">${fmtDate(item.created_at)}</span></div>`).join('') : '<div class="empty">Покупок ещё нет</div>'}</div>
      </article>
    </div>`;
}

async function renderUsers() {
  const filters = { page: state.page, limit: 25, search: state.filters.userSearch || '', status: state.filters.userStatus || 'all', sort: state.filters.userSort || 'recent' };
  const data = await api(`/users?${queryString(filters)}`);
  $('#content').innerHTML = `
    <div class="toolbar">
      <input id="userSearch" class="grow" placeholder="Имя, username или Telegram ID" value="${attr(filters.search)}">
      <select id="userStatus"><option value="all">Все статусы</option><option value="active">Активные</option><option value="banned">Заблокированные</option><option value="club">Клуб жильцов</option><option value="new">Новые за 7 дней</option></select>
      <select id="userSort"><option value="recent">По регистрации</option><option value="last_seen">По активности</option><option value="stars">По Stars</option><option value="trust">По доверию</option><option value="clues">По уликам</option></select>
      <button class="button primary" data-action="users-apply">Найти</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Жилец</th><th>Квартира</th><th>Прогресс</th><th>Stars</th><th>Активность</th><th>Статус</th><th></th></tr></thead><tbody>
      ${data.items.map(user => `<tr><td><div class="person-cell">${avatar(user)}<div><strong>${escapeHtml(user.first_name)} ${escapeHtml(user.last_name || '')}</strong><span class="subline">${user.username ? '@' + escapeHtml(user.username) : user.id}</span></div></div></td><td>№ ${user.apartment_no}<span class="subline">${fmtNumber(user.referrals)} приглашений</span></td><td>${fmtNumber(user.clues)} улик<span class="subline">доверие ${fmtNumber(user.trust)} · ключи ${fmtNumber(user.keys_count)}</span></td><td>${fmtNumber(user.stars_spent)} ★</td><td>${fmtDate(user.last_seen)}</td><td>${user.banned ? '<span class="pill danger">Заблокирован</span>' : user.club_until && new Date(user.club_until) > new Date() ? '<span class="pill ok">Клуб</span>' : '<span class="pill neutral">Жилец</span>'}</td><td><div class="row-actions">${button('Карточка', 'user-open', user.id, 'ghost')}</div></td></tr>`).join('')}
    </tbody></table></div>
    ${data.items.length ? `<div class="pagination"><span>Найдено: ${fmtNumber(data.total)} · страница ${data.page} из ${data.totalPages}</span><div class="pagination-buttons">${button('←', 'page-prev', '', 'ghost', data.page <= 1 ? 'disabled' : '')}${button('→', 'page-next', '', 'ghost', data.page >= data.totalPages ? 'disabled' : '')}</div></div>` : '<div class="empty">Жильцы не найдены</div>'}`;
  $('#userStatus').value = filters.status;
  $('#userSort').value = filters.sort;
}

async function openUser(id) {
  const data = await api(`/users/${id}`);
  const p = data.profile;
  const inventory = data.inventory.filter(item => Number(item.quantity) > 0);
  openModal({
    title: `${p.first_name} ${p.last_name || ''}`.trim(),
    kicker: `Жилец ${p.id}`,
    width: '1080px',
    body: `<div class="detail-grid">
      <aside class="profile-card">
        <div class="profile-head">${avatar(p)}<div><h3>${escapeHtml(p.first_name)}</h3><span class="subline">${p.username ? '@' + escapeHtml(p.username) : p.id}</span></div></div>
        <div class="profile-stats"><div class="profile-stat"><span>Квартира</span><strong>${p.apartment_no}</strong></div><div class="profile-stat"><span>Глава</span><strong>${p.chapter}</strong></div><div class="profile-stat"><span>Улики</span><strong>${fmtNumber(p.clues)}</strong></div><div class="profile-stat"><span>Доверие</span><strong>${fmtNumber(p.trust)}</strong></div><div class="profile-stat"><span>Ключи</span><strong>${fmtNumber(p.keys_count)}</strong></div><div class="profile-stat"><span>Stars</span><strong>${fmtNumber(p.stars_spent)}</strong></div></div>
        <div class="stack">
          ${button('Изменить профиль', 'user-edit', p.id, 'primary')}
          ${button('Изменить инвентарь', 'user-inventory', p.id)}
          ${button('Выдать товар', 'user-grant-product', p.id)}
          ${button('Выдать право', 'user-entitlement', p.id)}
          ${button('Написать в Telegram', 'user-message', p.id)}
          ${button(p.banned ? 'Разблокировать' : 'Заблокировать', 'user-moderate', p.id, p.banned ? 'ghost' : 'danger')}
        </div>
      </aside>
      <div class="detail-sections">
        <section class="panel"><div class="panel-header"><div><h2>Инвентарь</h2><p>${inventory.length} типов предметов</p></div></div><div class="item-chips">${inventory.length ? inventory.map(item => `<span class="item-chip">${escapeHtml(item.catalog?.icon || '·')} ${escapeHtml(item.catalog?.name || item.item_id)} <b>×${item.quantity}</b></span>`).join('') : '<span class="muted">Пусто</span>'}</div></section>
        <section class="panel"><div class="panel-header"><div><h2>Покупки</h2><p>Последние 50 операций</p></div></div>${compactTable(data.purchases, [['sku','Товар'],['stars','Stars'],['status','Статус'],['created_at','Дата']], row => ({...row, status: statusBadge(row.status), created_at: fmtDate(row.created_at)}), ['status'])}</section>
        <section class="panel"><div class="panel-header"><div><h2>Вылазки</h2><p>История маршрутов</p></div></div>${compactTable(data.expeditions, [['status','Исход'],['room_index','Комнат'],['started_at','Начало'],['completed_at','Конец']], row => ({...row,status:statusBadge(row.status),started_at:fmtDate(row.started_at),completed_at:fmtDate(row.completed_at)}), ['status'])}</section>
        <section class="panel"><div class="panel-header"><div><h2>Права и записки</h2><p>${data.entitlements.length} прав · ${data.notes.length} записок</p></div></div><div class="item-chips">${data.entitlements.map(item => `<span class="item-chip">${escapeHtml(item.entitlement_key)}</span>`).join('') || '<span class="muted">Нет специальных прав</span>'}</div></section>
        <section class="danger-zone"><h3>Опасная зона</h3><div class="page-actions">${button('Сбросить прогресс', 'user-reset', p.id, 'danger')}${button('Удалить игрока', 'user-delete', p.id, 'danger')}</div></section>
      </div>
    </div>`
  });
}

function compactTable(items, columns, map = row => row, htmlColumns = []) {
  if (!items?.length) return '<div class="empty">Записей нет</div>';
  return `<div class="table-wrap"><table><thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${items.map(raw => { const row = map(raw); return `<tr>${columns.map(([key]) => `<td>${htmlColumns.includes(key) ? row[key] : escapeHtml(row[key] ?? '—')}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>`;
}

async function userEdit(id) {
  const { profile: p } = await api(`/users/${id}`);
  openModal({ title: 'Изменить профиль', kicker: `Жилец ${id}`, submitText: 'Сохранить', body: `<form class="form-grid">
    <label>Имя<input name="firstName" value="${attr(p.first_name)}"></label><label>Фамилия<input name="lastName" value="${attr(p.last_name || '')}"></label>
    <label>Username<input name="username" value="${attr(p.username || '')}"></label><label>Номер квартиры<input name="apartmentNo" type="number" value="${p.apartment_no}"></label>
    <label>Стиль квартиры<input name="apartmentStyle" value="${attr(p.apartment_style)}"></label><label>Самообладание<input name="nerve" type="number" min="0" max="100" value="${p.nerve}"></label>
    <label>Доверие<input name="trust" type="number" min="0" value="${p.trust}"></label><label>Улики<input name="clues" type="number" min="0" value="${p.clues}"></label>
    <label>Ключи<input name="keys" type="number" min="0" value="${p.keys_count}"></label><label>Глава<input name="chapter" type="number" min="1" value="${p.chapter}"></label>
    <label class="wide">Клуб до <input name="clubUntil" type="datetime-local" value="${p.club_until ? new Date(p.club_until).toISOString().slice(0,16) : ''}"></label>
    <label class="check-row wide"><input name="introSeen" type="checkbox" ${p.intro_seen ? 'checked' : ''}> Вступление просмотрено</label>
  </form>`, onSubmit: async root => {
    const d = formObject(root);
    await api(`/users/${id}/profile`, { method: 'PATCH', body: { firstName:d.firstName,lastName:d.lastName||null,username:d.username||null,apartmentNo:Number(d.apartmentNo),apartmentStyle:d.apartmentStyle,nerve:Number(d.nerve),trust:Number(d.trust),clues:Number(d.clues),keys:Number(d.keys),chapter:Number(d.chapter),clubUntil:d.clubUntil ? new Date(d.clubUntil).toISOString() : null,introSeen:Boolean(d.introSeen) } });
    closeModal(); toast('Профиль обновлён'); await renderUsers();
  }});
}

function userInventory(id) {
  openModal({ title:'Коррекция инвентаря', kicker:`Жилец ${id}`, submitText:'Применить', body:`<form class="form-grid"><label>Код предмета<input name="itemId" placeholder="archive_stamp" required></label><label>Изменение количества<input name="delta" type="number" value="1" required></label><p class="muted wide">Положительное число добавляет предметы, отрицательное — забирает. Количество никогда не станет меньше нуля.</p></form>`, onSubmit:async root=>{const d=formObject(root);await api(`/users/${id}/inventory`,{method:'POST',body:{itemId:d.itemId,delta:Number(d.delta)}});closeModal();toast('Инвентарь скорректирован');await openUser(id);}});
}
async function userGrantProduct(id) {
  const {items}=await api('/shop');
  openModal({title:'Выдать товар без оплаты',kicker:`Жилец ${id}`,submitText:'Выдать',body:`<form><label>Товар<select name="sku">${items.map(i=>`<option value="${attr(i.sku)}">${escapeHtml(i.title)} · ${i.stars} ★</option>`).join('')}</select></label></form>`,onSubmit:async root=>{const d=formObject(root);await api(`/users/${id}/grant-product`,{method:'POST',body:{sku:d.sku}});closeModal();toast('Товар выдан');await openUser(id);}});
}
function userEntitlement(id){openModal({title:'Специальное право',kicker:`Жилец ${id}`,submitText:'Применить',body:`<form class="form-grid"><label>Ключ права<input name="key" placeholder="season_access" required></label><label>Действие<select name="action"><option value="grant">Выдать</option><option value="revoke">Отозвать</option></select></label><label class="wide">Значение JSON<textarea class="json-field" name="value">{}</textarea></label></form>`,onSubmit:async root=>{const d=formObject(root);await api(`/users/${id}/entitlements`,{method:'POST',body:{key:d.key,action:d.action,value:JSON.parse(d.value||'{}')}});closeModal();toast('Права обновлены');await openUser(id);}})}
function userMessage(id){openModal({title:'Сообщение жильцу',kicker:`Telegram ID ${id}`,submitText:'Отправить',body:`<form class="form-grid"><label class="wide">Текст<textarea name="text" required maxlength="4000"></textarea></label><label>Текст кнопки<input name="buttonText"></label><label>Ссылка кнопки<input name="buttonUrl" type="url"></label></form>`,onSubmit:async root=>{const d=formObject(root);await api(`/users/${id}/message`,{method:'POST',body:{text:d.text,buttonText:d.buttonText||null,buttonUrl:d.buttonUrl||null}});closeModal();toast('Сообщение отправлено');}})}
async function userModerate(id){const {profile:p}=await api(`/users/${id}`);const banning=!p.banned;openModal({title:banning?'Заблокировать жильца':'Снять блокировку',kicker:`Жилец ${id}`,submitText:banning?'Заблокировать':'Разблокировать',submitClass:banning?'danger':'primary',body:`<form class="form-grid"><label class="wide">Причина<textarea name="reason">${attr(p.ban_reason||'')}</textarea></label><label class="wide">До указанной даты <input name="bannedUntil" type="datetime-local" value="${p.banned_until?new Date(p.banned_until).toISOString().slice(0,16):''}"></label></form>`,onSubmit:async root=>{const d=formObject(root);await api(`/users/${id}/moderation`,{method:'POST',body:{banned:banning,reason:banning?(d.reason||null):null,bannedUntil:banning&&d.bannedUntil?new Date(d.bannedUntil).toISOString():null}});closeModal();toast(banning?'Доступ ограничен':'Доступ восстановлен');await renderUsers();}})}
function userReset(id){openModal({title:'Сбросить игровой прогресс?',kicker:`Жилец ${id}`,submitText:'Сбросить',submitClass:'danger',body:`<form><label class="check-row"><input type="checkbox" name="preservePurchases" checked> Сохранить покупки и специальные права</label><p class="muted">Будут удалены вылазки, предметы в квартире, инвентарь и записки. Профиль вернётся к начальному состоянию.</p></form>`,onSubmit:async root=>{const d=formObject(root);await api(`/users/${id}/reset`,{method:'POST',body:{preservePurchases:Boolean(d.preservePurchases)}});closeModal();toast('Прогресс сброшен');await renderUsers();}})}
function userDelete(id){openModal({title:'Удалить жильца безвозвратно?',kicker:`Telegram ID ${id}`,submitText:'Удалить данные',submitClass:'danger',body:`<p class="muted">Будут удалены профиль, покупки, инвентарь, вылазки, записки и все связанные записи. Операцию нельзя отменить.</p><form><label>Введите DELETE для подтверждения<input name="confirm" autocomplete="off"></label></form>`,onSubmit:async root=>{const d=formObject(root);if(d.confirm!=='DELETE')throw new Error('Подтверждение не совпадает');await api(`/users/${id}`,{method:'DELETE'});closeModal();toast('Жилец удалён');await renderUsers();}})}

async function renderPurchases() {
  const filters={page:state.page,limit:25,status:state.filters.purchaseStatus||'all',search:state.filters.purchaseSearch||''};
  const [data,balance]=await Promise.all([api(`/purchases?${queryString(filters)}`),api('/stars/balance').catch(error=>({balance:{error:error.message}}))]);
  $('#content').innerHTML=`<div class="metric-grid"><article class="metric"><span>Баланс бота</span><strong>${fmtNumber(balance.balance?.amount ?? balance.balance?.star_count ?? balance.balance?.balance ?? 0)} ★</strong><small>Данные Telegram Bot API</small></article><article class="metric"><span>Записей</span><strong>${fmtNumber(data.total)}</strong><small>по выбранному фильтру</small></article></div>
  <div class="toolbar"><input id="purchaseSearch" class="grow" placeholder="ID, пользователь или SKU" value="${attr(filters.search)}"><select id="purchaseStatus"><option value="all">Все</option><option value="pending">Ожидают</option><option value="paid">Оплачены</option><option value="refunded">Возвращены</option><option value="cancelled">Отменены</option></select><button class="button primary" data-action="purchases-apply">Найти</button><button class="button ghost" data-action="stars-transactions">Транзакции Telegram</button></div>
  <div class="table-wrap"><table><thead><tr><th>Покупка</th><th>Жилец</th><th>Товар</th><th>Сумма</th><th>Статус</th><th>Дата</th><th></th></tr></thead><tbody>${data.items.map(item=>`<tr><td><span class="code">${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.first_name)}<span class="subline">${item.username?'@'+escapeHtml(item.username):item.user_id}</span></td><td>${escapeHtml(item.sku)}</td><td>${fmtNumber(item.stars)} ★</td><td>${statusBadge(item.status)}</td><td>${fmtDate(item.created_at)}</td><td><div class="row-actions">${item.status==='paid'?button('Возврат','purchase-refund',item.id,'danger'):''}${item.status==='pending'?button('Отменить','purchase-cancel',item.id,'danger'):''}</div></td></tr>`).join('')}</tbody></table></div>
  <div class="pagination"><span>Страница ${data.page} из ${data.totalPages}</span><div class="pagination-buttons">${button('←','page-prev','','ghost',data.page<=1?'disabled':'')}${button('→','page-next','','ghost',data.page>=data.totalPages?'disabled':'')}</div></div>`;
  $('#purchaseStatus').value=filters.status;
}
async function showStarTransactions(){const data=await api('/stars/transactions?limit=100');openModal({title:'Транзакции Telegram Stars',kicker:'Ответ Bot API',width:'1000px',body:`<pre class="code">${json(data.transactions)}</pre>`});}
function confirmPurchaseAction(id,type){const refund=type==='refund';openModal({title:refund?'Вернуть Stars покупателю?':'Отменить ожидающий счёт?',kicker:`Покупка ${id}`,submitText:refund?'Оформить возврат':'Отменить',submitClass:'danger',body:`<p class="muted">${refund?'Telegram вернёт Stars пользователю, а сервер попытается отозвать выданные предметы и права.':'Счёт станет недействительным. Оплатить его после отмены будет нельзя.'}</p>`,onSubmit:async()=>{await api(`/purchases/${id}/${type}`,{method:'POST'});closeModal();toast(refund?'Возврат выполнен':'Счёт отменён');await renderPurchases();}})}

function contentTabs(){return `<div class="tabs">${[['rooms','Комнаты'],['shop','Магазин'],['events','События'],['seasons','Сезоны']].map(([id,label])=>`<button class="tab ${state.contentTab===id?'active':''}" data-action="content-tab" data-id="${id}">${label}</button>`).join('')}</div>`}
async function renderContent(){const renderers={rooms:renderRooms,shop:renderShop,events:renderEvents,seasons:renderSeasons};$('#content').innerHTML=contentTabs()+'<div id="contentTabBody" class="loading">Открываем архив…</div>';await renderers[state.contentTab]();}
async function renderRooms(){const {items}=await api('/rooms');$('#contentTabBody').className='';$('#contentTabBody').innerHTML=`<div class="panel-header"><div><h2>Комнаты восьмого этажа</h2><p>Изменения применяются к новым вылазкам. Активные маршруты используют сохранённый снимок комнаты.</p></div>${button('Новая комната','room-new','','primary')}</div><div class="card-list">${items.map(room=>`<article class="list-card"><div><h3><span style="color:${attr(room.accent)}">■</span> ${escapeHtml(room.title)}</h3><p>${escapeHtml(room.description)}</p><div class="list-meta">${statusBadge(room.enabled)}<span class="pill neutral">${escapeHtml(room.ambience)}</span><span class="pill neutral">${room.choices.length} действий</span><span class="pill neutral">порядок ${room.sort_order}</span></div></div><div class="list-actions">${button('Изменить','room-edit',room.id)}${button('Удалить','room-delete',room.id,'danger')}</div></article>`).join('')}</div>`;}
function roomForm(room={}){return `<form class="form-grid"><label>ID комнаты<input name="id" value="${attr(room.id||'')}" pattern="[a-z0-9-]+" required></label><label>Порядок<input name="sortOrder" type="number" value="${room.sort_order??0}"></label><label>Название<input name="title" value="${attr(room.title||'')}" required></label><label>Звук/атмосфера<input name="ambience" value="${attr(room.ambience||'room')}" required></label><label class="wide">Описание<textarea name="description" required>${escapeHtml(room.description||'')}</textarea></label><label>Акцент<input name="accent" type="color" value="${attr(room.accent||'#b89a5e')}"></label><label class="check-row"><input name="enabled" type="checkbox" ${room.enabled!==false?'checked':''}> Комната включена</label><label class="wide">Действия JSON<textarea class="json-field" name="choices" rows="16">${json(room.choices||[{label:'Осмотреть комнату',outcome:'Вы замечаете деталь, которой раньше не было.',effects:{clues:1,noise:2}},{label:'Отступить к лифту',outcome:'Дверь за спиной закрывается слишком тихо.',effects:{nerve:-2,danger:-1}}])}</textarea></label></form>`}
async function editRoom(id){const room=id?(await api('/rooms')).items.find(x=>x.id===id):{};openModal({title:id?'Изменить комнату':'Новая комната',kicker:'Редактор маршрутов',submitText:'Сохранить',width:'980px',body:roomForm(room),onSubmit:async root=>{const d=formObject(root);await api('/rooms',{method:'POST',body:{id:d.id,title:d.title,description:d.description,ambience:d.ambience,accent:d.accent,choices:JSON.parse(d.choices),enabled:Boolean(d.enabled),sortOrder:Number(d.sortOrder)}});closeModal();toast('Комната сохранена');await renderContent();}})}
function deleteRoom(id){openModal({title:'Удалить комнату?',kicker:id,submitText:'Удалить',submitClass:'danger',body:'<p class="muted">Активные вылазки продолжат использовать сохранённый снимок. Новые маршруты эту комнату больше не получат.</p>',onSubmit:async()=>{await api(`/rooms/${encodeURIComponent(id)}`,{method:'DELETE'});closeModal();toast('Комната удалена');await renderContent();}})}
async function renderShop(){const {items}=await api('/shop');$('#contentTabBody').className='';$('#contentTabBody').innerHTML=`<div class="panel-header"><div><h2>Каталог Telegram Stars</h2><p>Цены и серверная выдача предметов, прав и клубного времени</p></div>${button('Новый товар','shop-new','','primary')}</div><div class="card-list">${items.map(item=>`<article class="list-card"><div><h3>${escapeHtml(item.icon)} ${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="list-meta"><span class="pill warning">${fmtNumber(item.stars)} ★</span>${statusBadge(item.active)}<span class="pill neutral">${escapeHtml(item.sku)}</span></div></div><div class="list-actions">${button('Изменить','shop-edit',item.sku)}${button('Отключить','shop-disable',item.sku,'danger')}</div></article>`).join('')}</div>`;}
function shopForm(item={}){return `<form class="form-grid"><label>SKU<input name="sku" value="${attr(item.sku||'')}" pattern="[a-z0-9_-]+" required></label><label>Порядок<input name="sortOrder" type="number" value="${item.sort_order??0}"></label><label>Название<input name="title" value="${attr(item.title||'')}" required></label><label>Иконка<input name="icon" value="${attr(item.icon||'✦')}" maxlength="12"></label><label class="wide">Описание<textarea name="description" required>${escapeHtml(item.description||'')}</textarea></label><label>Цена в Stars<input name="stars" type="number" min="1" value="${item.stars??50}"></label><label class="check-row"><input name="active" type="checkbox" ${item.active!==false?'checked':''}> Товар доступен</label><label class="wide">Серверная выдача JSON<textarea class="json-field" name="grantConfig" rows="15">${json(item.grant_config||{inventory:[],entitlements:[],clubDays:0})}</textarea></label></form>`}
async function editShop(sku){const item=sku?(await api('/shop')).items.find(x=>x.sku===sku):{};openModal({title:sku?'Изменить товар':'Новый товар',kicker:'Telegram Stars',submitText:'Сохранить',width:'900px',body:shopForm(item),onSubmit:async root=>{const d=formObject(root);await api('/shop',{method:'POST',body:{sku:d.sku,title:d.title,description:d.description,stars:Number(d.stars),icon:d.icon,active:Boolean(d.active),sortOrder:Number(d.sortOrder),grantConfig:JSON.parse(d.grantConfig)}});closeModal();toast('Товар сохранён');await renderContent();}})}
function disableShop(sku){openModal({title:'Отключить товар?',kicker:sku,submitText:'Отключить',submitClass:'danger',body:'<p class="muted">Новые счета по этому SKU создаваться не будут. Уже оплаченные счета продолжат обрабатываться.</p>',onSubmit:async()=>{await api(`/shop/${encodeURIComponent(sku)}`,{method:'DELETE'});closeModal();toast('Товар отключён');await renderContent();}})}
async function renderEvents(){const {items}=await api('/events');$('#contentTabBody').className='';$('#contentTabBody').innerHTML=`<div class="panel-header"><div><h2>Происшествия в доме</h2><p>Активное событие отображается всем жильцам</p></div>${button('Новое событие','event-new','','primary')}</div><div class="card-list">${items.map(item=>`<article class="list-card"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><div class="list-meta"><span class="pill ${item.severity==='critical'||item.severity==='danger'?'danger':item.severity==='warning'?'warning':'neutral'}">${escapeHtml(item.severity)}</span><span class="pill neutral">${fmtDate(item.active_from)} — ${fmtDate(item.active_until)}</span></div></div><div class="list-actions">${button('Изменить','event-edit',item.event_key)}${button('Удалить','event-delete',item.event_key,'danger')}</div></article>`).join('')}</div>`;}
function localDate(value){return value?new Date(value).toISOString().slice(0,16):new Date().toISOString().slice(0,16)}
async function editEvent(key){const item=key?(await api('/events')).items.find(x=>x.event_key===key):{};openModal({title:key?'Изменить событие':'Новое событие',kicker:'Доска происшествий',submitText:'Сохранить',body:`<form class="form-grid"><label>Ключ<input name="eventKey" value="${attr(item.event_key||'')}" pattern="[a-z0-9_-]+" required></label><label>Важность<select name="severity"><option>info</option><option>warning</option><option>danger</option><option>critical</option></select></label><label class="wide">Заголовок<input name="title" value="${attr(item.title||'')}" required></label><label class="wide">Текст<textarea name="body" required>${escapeHtml(item.body||'')}</textarea></label><label>Начало<input name="activeFrom" type="datetime-local" value="${localDate(item.active_from)}"></label><label>Окончание<input name="activeUntil" type="datetime-local" value="${localDate(item.active_until||Date.now()+7*86400000)}"></label></form>`,onSubmit:async root=>{const d=formObject(root);await api('/events',{method:'POST',body:{eventKey:d.eventKey,title:d.title,body:d.body,severity:d.severity,activeFrom:new Date(d.activeFrom).toISOString(),activeUntil:new Date(d.activeUntil).toISOString()}});closeModal();toast('Событие сохранено');await renderContent();}});$('#modalBody select[name="severity"]').value=item.severity||'warning';}
function deleteEvent(key){openModal({title:'Удалить событие?',kicker:key,submitText:'Удалить',submitClass:'danger',body:'<p class="muted">Событие сразу исчезнет из интерфейса игроков.</p>',onSubmit:async()=>{await api(`/events/${encodeURIComponent(key)}`,{method:'DELETE'});closeModal();toast('Событие удалено');await renderContent();}})}
async function renderSeasons(){const {items}=await api('/seasons');$('#contentTabBody').className='';$('#contentTabBody').innerHTML=`<div class="panel-header"><div><h2>Сезоны</h2><p>Одновременно активным может быть только один сезон</p></div>${button('Новый сезон','season-new','','primary')}</div><div class="card-list">${items.map(item=>`<article class="list-card"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="list-meta">${statusBadge(item.status)}<span class="pill neutral">${escapeHtml(item.slug)}</span><span class="pill neutral">${fmtDate(item.starts_at)} — ${fmtDate(item.ends_at)}</span></div></div><div class="list-actions">${button('Изменить','season-edit',item.id)}${button('Удалить','season-delete',item.id,'danger')}</div></article>`).join('')}</div>`;}
async function editSeason(id){const item=id?(await api('/seasons')).items.find(x=>x.id===id):{};openModal({title:id?'Изменить сезон':'Новый сезон',kicker:'Сюжетная кампания',submitText:'Сохранить',body:`<form class="form-grid"><label>Slug<input name="slug" value="${attr(item.slug||'')}" pattern="[a-z0-9-]+" required></label><label>Статус<select name="status"><option value="draft">Черновик</option><option value="active">Активный</option><option value="archived">Архив</option></select></label><label class="wide">Название<input name="title" value="${attr(item.title||'')}" required></label><label class="wide">Описание<textarea name="description" required>${escapeHtml(item.description||'')}</textarea></label><label>Начало<input name="startsAt" type="datetime-local" value="${item.starts_at?localDate(item.starts_at):''}"></label><label>Окончание<input name="endsAt" type="datetime-local" value="${item.ends_at?localDate(item.ends_at):''}"></label><label class="wide">Метаданные JSON<textarea class="json-field" name="metadata">${json(item.metadata||{})}</textarea></label></form>`,onSubmit:async root=>{const d=formObject(root);await api('/seasons',{method:'POST',body:{id:id||undefined,slug:d.slug,title:d.title,description:d.description,status:d.status,startsAt:d.startsAt?new Date(d.startsAt).toISOString():null,endsAt:d.endsAt?new Date(d.endsAt).toISOString():null,metadata:JSON.parse(d.metadata||'{}')}});closeModal();toast('Сезон сохранён');await renderContent();}});$('#modalBody select[name="status"]').value=item.status||'draft';}
function deleteSeason(id){openModal({title:'Удалить сезон?',kicker:id,submitText:'Удалить',submitClass:'danger',body:'<p class="muted">Описание и метаданные сезона будут удалены.</p>',onSubmit:async()=>{await api(`/seasons/${id}`,{method:'DELETE'});closeModal();toast('Сезон удалён');await renderContent();}})}

async function renderBroadcasts(){const {items}=await api('/broadcasts');$('#content').innerHTML=`<div class="panel-header"><div><h2>Массовые сообщения</h2><p>Очередь отправляется порциями и переживает перезапуск Railway</p></div>${button('Создать рассылку','broadcast-new','','primary')}</div><div class="card-list">${items.map(item=>`<article class="list-card"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><div class="list-meta">${statusBadge(item.status)}<span class="pill neutral">${fmtNumber(item.sent)} / ${fmtNumber(item.total)} отправлено</span><span class="pill ${item.failed?'danger':'neutral'}">${fmtNumber(item.failed)} ошибок</span><span class="pill neutral">${escapeHtml(item.creator||'—')}</span></div></div><div class="list-actions">${['draft','paused'].includes(item.status)?button('Запустить','broadcast-start',item.id,'primary'):''}${['queued','running'].includes(item.status)?button('Пауза','broadcast-pause',item.id):''}${!['completed','cancelled'].includes(item.status)?button('Отменить','broadcast-cancel',item.id,'danger'):''}</div></article>`).join('')||'<div class="empty">Рассылок пока нет</div>'}</div>`;}
function newBroadcast(){openModal({title:'Новая рассылка',kicker:'Telegram-сообщение',submitText:'Сохранить черновик',body:`<form class="form-grid"><label class="wide">Название кампании<input name="title" required></label><label class="wide">Текст сообщения<textarea name="body" maxlength="4000" required></textarea></label><label>Текст кнопки<input name="buttonText"></label><label>Ссылка кнопки<input name="buttonUrl" type="url"></label><label>Активность за последние дней<input name="lastSeenDays" type="number" min="1" placeholder="пусто = все"></label><label class="check-row"><input name="clubOnly" type="checkbox"> Только клуб жильцов</label><label class="check-row wide"><input name="excludeBanned" type="checkbox" checked> Исключить заблокированных</label></form>`,onSubmit:async root=>{const d=formObject(root);await api('/broadcasts',{method:'POST',body:{title:d.title,body:d.body,buttonText:d.buttonText||null,buttonUrl:d.buttonUrl||null,audience:{lastSeenDays:d.lastSeenDays?Number(d.lastSeenDays):null,clubOnly:Boolean(d.clubOnly),excludeBanned:Boolean(d.excludeBanned)}}});closeModal();toast('Черновик создан');await renderBroadcasts();}})}
function broadcastAction(id,action){const labels={start:['Запустить рассылку?','Запустить','primary'],pause:['Поставить рассылку на паузу?','Пауза','ghost'],cancel:['Отменить рассылку?','Отменить','danger']}[action];openModal({title:labels[0],kicker:id,submitText:labels[1],submitClass:labels[2],body:`<p class="muted">${action==='start'?'При первом запуске будет зафиксирован список получателей.':'Уже отправленные сообщения отозвать невозможно.'}</p>`,onSubmit:async()=>{await api(`/broadcasts/${id}/${action}`,{method:'POST'});closeModal();toast('Статус рассылки изменён');await renderBroadcasts();}})}

function operationsTabs(){return `<div class="tabs">${[['expeditions','Вылазки'],['notes','Записки'],['referrals','Рефералы']].map(([id,label])=>`<button class="tab ${state.operationsTab===id?'active':''}" data-action="operations-tab" data-id="${id}">${label}</button>`).join('')}</div>`}
async function renderOperations(){ $('#content').innerHTML=operationsTabs()+'<div id="operationsBody" class="loading">Проверяем журнал…</div>'; if(state.operationsTab==='expeditions')await renderExpeditions();if(state.operationsTab==='notes')await renderNotes();if(state.operationsTab==='referrals')await renderReferrals();}
async function renderExpeditions(){const {items}=await api('/operations/expeditions?limit=150');$('#operationsBody').className='';$('#operationsBody').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Жилец</th><th>Статус</th><th>Комната</th><th>Показатели</th><th>Начало</th><th></th></tr></thead><tbody>${items.map(item=>`<tr><td>${escapeHtml(item.first_name)}<span class="subline">${item.username?'@'+escapeHtml(item.username):item.user_id}</span></td><td>${statusBadge(item.status)}</td><td>${item.room_index}/${item.state?.maxRooms||'—'}</td><td>нерв ${item.state?.nerve??'—'} · риск ${item.state?.danger??'—'} · шум ${item.state?.noise??'—'}</td><td>${fmtDate(item.started_at)}</td><td>${item.status==='active'?button('Прервать','expedition-cancel',item.id,'danger'):''}</td></tr>`).join('')}</tbody></table></div>`;}
async function renderNotes(){const {items}=await api('/operations/notes?limit=200');$('#operationsBody').className='';$('#operationsBody').innerHTML=`<div class="table-wrap"><table><thead><tr><th>От кого</th><th>Кому</th><th>Записка</th><th>Настроение</th><th>Дата</th><th></th></tr></thead><tbody>${items.map(item=>`<tr><td>${escapeHtml(item.author_name)}<span class="subline">${item.author_id}</span></td><td>${escapeHtml(item.target_name)}<span class="subline">${item.target_id}</span></td><td>${escapeHtml(item.body)}</td><td>${escapeHtml(item.mood)}</td><td>${fmtDate(item.created_at)}</td><td>${button('Удалить','note-delete',item.id,'danger')}</td></tr>`).join('')}</tbody></table></div>`;}
async function renderReferrals(){const {items}=await api('/operations/referrals');$('#operationsBody').className='';$('#operationsBody').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Пригласил</th><th>Новый жилец</th><th>Награда выдана</th></tr></thead><tbody>${items.map(item=>`<tr><td>${escapeHtml(item.inviter_name)}<span class="subline">${item.inviter_username?'@'+escapeHtml(item.inviter_username):item.inviter_id}</span></td><td>${escapeHtml(item.invited_name)}<span class="subline">${item.invited_username?'@'+escapeHtml(item.invited_username):item.invited_id}</span></td><td>${fmtDate(item.rewarded_at)}</td></tr>`).join('')}</tbody></table></div>`;}
function operationDelete(path,title,after){openModal({title,kicker:'Модерация',submitText:'Подтвердить',submitClass:'danger',body:'<p class="muted">Действие будет записано в журнал аудита.</p>',onSubmit:async()=>{await api(path,{method:path.includes('/cancel')?'POST':'DELETE'});closeModal();toast('Операция выполнена');await after();}})}

async function renderSettings(){const {settings}=await api('/settings');state.settings=settings;$('#content').innerHTML=`<div class="panel-grid"><article class="panel"><div class="panel-header"><div><h2>Аварийное управление</h2><p>Переключатели действуют сразу</p></div></div><form id="settingsForm" class="stack"><label class="check-row"><input name="maintenance_mode" type="checkbox" ${settings.maintenance_mode?'checked':''}> Режим технических работ</label><label>Сообщение при закрытии<textarea name="maintenance_message">${escapeHtml(settings.maintenance_message||'')}</textarea></label><label class="check-row"><input name="expeditions_enabled" type="checkbox" ${settings.expeditions_enabled?'checked':''}> Разрешить вылазки</label><label class="check-row"><input name="notes_enabled" type="checkbox" ${settings.notes_enabled?'checked':''}> Разрешить записки</label><label class="check-row"><input name="shop_enabled" type="checkbox" ${settings.shop_enabled?'checked':''}> Разрешить магазин Stars</label><label>Комнат в одной вылазке<input name="max_expedition_rooms" type="number" min="1" max="20" value="${settings.max_expedition_rooms||6}"></label><button class="button primary" type="submit">Сохранить настройки</button></form></article><article class="panel"><div class="panel-header"><div><h2>Текущее состояние</h2><p>Как сервер воспринимает конфигурацию</p></div></div><pre class="code">${json(settings)}</pre></article></div>`;$('#settingsForm').addEventListener('submit',async event=>{event.preventDefault();const d=formObject($('#content'));await api('/settings',{method:'PATCH',body:{maintenance_mode:Boolean(d.maintenance_mode),maintenance_message:d.maintenance_message,expeditions_enabled:Boolean(d.expeditions_enabled),notes_enabled:Boolean(d.notes_enabled),shop_enabled:Boolean(d.shop_enabled),max_expedition_rooms:Number(d.max_expedition_rooms)}});toast('Настройки применены');await renderSettings();updateHeader();});}

async function renderAdmins(){const data=await api('/admins');$('#content').innerHTML=`<div class="panel-header"><div><h2>Служебные учётные записи</h2><p>Роли, индивидуальные разрешения и отзыв сессий</p></div>${button('Новый администратор','admin-new','','primary')}</div><div class="table-wrap"><table><thead><tr><th>Логин</th><th>Роль</th><th>Доп. права</th><th>Последний вход</th><th>Статус</th><th></th></tr></thead><tbody>${data.items.map(item=>`<tr><td><strong>${escapeHtml(item.username)}</strong><span class="subline code">${item.id}</span></td><td>${escapeHtml(item.role)}</td><td>${item.permissions?.length?item.permissions.map(p=>`<span class="pill neutral">${escapeHtml(p)}</span>`).join(' '):'—'}</td><td>${fmtDate(item.last_login_at)}</td><td>${statusBadge(item.active)}</td><td>${button('Изменить','admin-edit',item.id)}</td></tr>`).join('')}</tbody></table></div>`;state.adminCatalog=data;}
function permissionsField(selected=[]){return `<div class="item-chips">${state.adminCatalog.permissions.map(p=>`<label class="check-row"><input type="checkbox" name="permission" value="${attr(p)}" ${selected.includes(p)?'checked':''}> ${escapeHtml(p)}</label>`).join('')}</div>`}
async function editAdmin(id){const item=id?state.adminCatalog.items.find(x=>x.id===id):null;openModal({title:item?'Изменить администратора':'Новая учётная запись',kicker:'RBAC и безопасность',submitText:'Сохранить',width:'980px',body:`<form class="form-grid">${item?'':`<label>Логин<input name="username" required minlength="3"></label>`}<label>Роль<select name="role">${state.adminCatalog.roles.map(role=>`<option value="${role}" ${item?.role===role?'selected':''}>${role}</option>`).join('')}</select></label><label class="wide">${item?'Новый пароль, если нужно':'Пароль'}<input name="password" type="password" ${item?'':'required'} minlength="12"></label>${item?`<label class="check-row wide"><input name="active" type="checkbox" ${item.active?'checked':''}> Учётная запись активна</label>`:''}<div class="wide"><label>Дополнительные права</label>${permissionsField(item?.permissions||[])}</div></form>`,onSubmit:async root=>{const d=formObject(root);const permissions=$$('input[name="permission"]:checked',root).map(x=>x.value);if(item)await api(`/admins/${id}`,{method:'PATCH',body:{role:d.role,permissions,active:Boolean(d.active),...(d.password?{password:d.password}:{})}});else await api('/admins',{method:'POST',body:{username:d.username,password:d.password,role:d.role,permissions}});closeModal();toast('Учётная запись сохранена');await renderAdmins();}})}

async function renderAudit(){const filters={page:state.page,limit:50,search:state.filters.auditSearch||''};const data=await api(`/audit?${queryString(filters)}`);$('#content').innerHTML=`<div class="toolbar"><input id="auditSearch" class="grow" placeholder="Действие, сущность, ID или администратор" value="${attr(filters.search)}"><button class="button primary" data-action="audit-apply">Найти</button></div><div class="table-wrap"><table><thead><tr><th>Время</th><th>Администратор</th><th>Действие</th><th>Объект</th><th>Детали</th><th>IP</th></tr></thead><tbody>${data.items.map(item=>`<tr><td class="nowrap">${fmtDate(item.created_at)}</td><td>${escapeHtml(item.admin_username||'system')}</td><td><span class="code">${escapeHtml(item.action)}</span></td><td>${escapeHtml(item.entity_type)}<span class="subline code">${escapeHtml(item.entity_id||'—')}</span></td><td><button class="button small ghost" data-action="audit-details" data-json="${attr(JSON.stringify(item.details||{}))}">Открыть</button></td><td>${escapeHtml(item.ip||'—')}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>Страница ${data.page} из ${data.totalPages}</span><div class="pagination-buttons">${button('←','page-prev','','ghost',data.page<=1?'disabled':'')}${button('→','page-next','','ghost',data.page>=data.totalPages?'disabled':'')}</div></div>`;}



const V2_TABS=[['analytics','Аналитика'],['daily','Сценарии дня'],['realtime','Realtime'],['buildings','Подъезды'],['market','Рынок'],['content','Редактор историй'],['experiments','A/B-тесты'],['support','Поддержка'],['moderation','Модерация'],['backups','Backup'],['observability','Система']];
async function renderV2(){
  const tabs=`<div class="tabs">${V2_TABS.map(([id,label])=>button(label,'v2-tab',id,state.liveOpsTab===id?'primary':'ghost')).join('')}</div>`;
  $('#content').innerHTML=tabs+'<div id="v2Body" class="loading">Открываем служебный журнал…</div>';
  const fn={analytics:renderV2Analytics,daily:renderV2Daily,realtime:renderV2Realtime,buildings:renderV2Buildings,market:renderV2Market,content:renderV2Content,experiments:renderV2Experiments,support:renderV2Support,moderation:renderV2Moderation,backups:renderV2Backups,observability:renderV2Observability}[state.liveOpsTab];
  await fn();
}
function metric(label,value,sub=''){return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${fmtNumber(value)}</strong><small>${escapeHtml(sub)}</small></article>`;}
async function renderV2Analytics(){const d=await api('/v2/analytics?days=30');state.liveOpsCache.analytics=d;$('#v2Body').innerHTML=`<div class="metric-grid">${metric('D1 retention',Number(d.retention?.d1||0)+'%','вернулись на следующий день')}${metric('D7 retention',Number(d.retention?.d7||0)+'%','вернулись через неделю')}${metric('D30 retention',Number(d.retention?.d30||0)+'%','месячное удержание')}${metric('ARPPU',d.revenue?.payers?Math.round(Number(d.revenue.stars||0)/Number(d.revenue.payers)):0,'Stars на плательщика')}${metric('Конверсия',d.retention?.signups?Math.round(Number(d.revenue?.payers||0)/Number(d.retention.signups)*100)+'%':'0%','в покупку')}${metric('Сессий',d.revenue?.purchases||0,'за 30 дней')}</div><div class="panel-grid"><article class="panel"><div class="panel-header"><div><h2>Воронка</h2><p>Обучение, первая вылазка, приглашение и покупка</p></div></div>${compactTable(d.funnel||[],[['event_name','Событие'],['users','Игроков']])}</article><article class="panel"><div class="panel-header"><div><h2>Товары</h2><p>Stars и повторные покупки</p></div></div>${compactTable(d.products||[],[['title','Товар'],['purchases','Покупки'],['stars','Stars'],['payers','Плательщики']])}</article><article class="panel span-2"><div class="panel-header"><div><h2>Комнаты и ошибки</h2><p>Где игроки принимают решения и закрывают приложение</p></div></div>${compactTable(d.rooms||[],[['room_id','Комната'],['choices','Решений'],['users','Игроков']])}${compactTable(d.errors||[],[['message','Ошибка'],['count','Количество']])}</article></div>`;}
async function renderV2Daily(){const d=await api('/v2/daily-scenarios');state.liveOpsCache.daily=d.items;$('#v2Body').innerHTML=`<div class="panel-header"><div><h2>Ежедневные сценарии</h2><p>Событие вместо награды за вход</p></div>${button('Новый сценарий','v2-daily-new','','primary')}</div><div class="table-wrap"><table><thead><tr><th>Название</th><th>План</th><th>Сцен</th><th>Приоритет</th><th>Статус</th></tr></thead><tbody>${d.items.map(x=>`<tr><td><strong>${escapeHtml(x.title)}</strong><span class="subline code">${escapeHtml(x.slug)}</span></td><td>${x.scheduled_date||('день недели '+(x.weekday??'любой'))}</td><td>${Array.isArray(x.scenes)?x.scenes.length:0}</td><td>${x.priority}</td><td>${statusBadge(x.active)}</td></tr>`).join('')}</tbody></table></div>`;}
function defaultDailyScenes(){return [{id:'arrival',text:'За стеной кто-то трижды двигает стул.',actions:[{key:'listen',label:'Прислушаться'},{key:'knock',label:'Постучать'}]},{id:'trace',text:'Звук переместился к лифту.',actions:[{key:'follow',label:'Пойти следом'},{key:'warn',label:'Предупредить соседей'}]},{id:'ending',text:'Дом запомнил выбор.',actions:[]}];}
function createDailyScenario(){openModal({title:'Новый сценарий дня',kicker:'Планировщик происшествий',submitText:'Создать',width:'980px',body:`<form class="form-grid"><label>Slug<input name="slug" value="night-${Date.now().toString().slice(-6)}" required></label><label>Название<input name="title" value="Шум за стеной" required></label><label class="wide">Тизер<textarea name="teaser">Соседняя квартира пуста, но там двигают мебель.</textarea></label><label>Дата<input name="scheduledDate" type="date"></label><label>Приоритет<input name="priority" type="number" value="10"></label><label class="wide">Сцены JSON<textarea name="scenes" class="code" style="min-height:260px">${attr(JSON.stringify(defaultDailyScenes(),null,2))}</textarea></label><label class="wide">Награда JSON<textarea name="rewardConfig" class="code">{
  "clues": 1,
  "marks": 3
}</textarea></label></form>`,onSubmit:async root=>{const d=formObject(root);await api('/v2/daily-scenarios',{method:'POST',body:{slug:d.slug,title:d.title,teaser:d.teaser,scenes:JSON.parse(d.scenes),rewardConfig:JSON.parse(d.rewardConfig),active:true,scheduledDate:d.scheduledDate||null,priority:Number(d.priority)}});closeModal();toast('Сценарий запланирован');await renderV2Daily();}});}
async function renderV2Realtime(){const d=await api('/v2/realtime');$('#v2Body').innerHTML=`<div class="metric-grid">${metric('Недавно онлайн',d.presence?.recently_seen||0,'за 2 минуты')}${metric('Redis',d.redis?.ok?1:0,d.redis?.ok?'доступен':'ошибка')}${metric('Активные матчи',d.matches.filter(x=>['lobby','playing'].includes(x.status)).length,'Socket.IO')}</div><div class="table-wrap"><table><thead><tr><th>Код</th><th>Фаза</th><th>Хост</th><th>Игроки</th><th>Обновлён</th><th></th></tr></thead><tbody>${d.matches.map(x=>`<tr><td class="code">${escapeHtml(x.code)}</td><td>${statusBadge(x.status)}</td><td>${escapeHtml(x.host_name||'—')}</td><td>${x.members}/${x.max_players}</td><td>${fmtDate(x.updated_at)}</td><td>${['lobby','playing'].includes(x.status)?button('Завершить','v2-coop-cancel',x.id,'danger'):''}</td></tr>`).join('')}</tbody></table></div>`;}
async function cancelV2Coop(id){if(!confirm('Принудительно закрыть кооперативную сессию?'))return;await api(`/v2/realtime/${id}/cancel`,{method:'POST',body:{}});toast('Сессия закрыта');await renderV2Realtime();}
async function renderV2Buildings(){const d=await api('/v2/buildings');$('#v2Body').innerHTML=`<div class="panel-header"><div><h2>Постоянные подъезды</h2><p>20–30 игроков, общий прогресс, склад и решения</p></div></div><div class="table-wrap"><table><thead><tr><th>Код</th><th>Название</th><th>Жильцов</th><th>Старший</th><th>Доверие</th><th></th></tr></thead><tbody>${d.items.map(x=>`<tr><td class="code">${escapeHtml(x.code)}</td><td>${escapeHtml(x.title)}</td><td>${x.members}/${x.capacity}</td><td>${escapeHtml(x.elder_name||'не выбран')}</td><td>${x.trust_score}</td><td>${button('Открыть','v2-building-open',x.id)}</td></tr>`).join('')}</tbody></table></div>`;}
async function openBuildingV2(id){const d=await api(`/v2/buildings/${id}`);openModal({title:d.building.title,kicker:d.building.code,width:'1080px',body:`<div class="metric-grid">${metric('Жильцы',d.members.length)}${metric('Склад',d.storage.length)}${metric('Записи',d.posts.length)}${metric('Голосования',d.votes.length)}</div><div class="panel"><h2>Состав подъезда</h2>${compactTable(d.members,[['first_name','Имя'],['apartment_no','Квартира'],['profession','Профессия'],['local_trust','Доверие']])}</div><div class="panel"><h2>Общий склад</h2>${compactTable(d.storage,[['item_id','Предмет'],['quantity','Количество'],['updated_at','Обновлено']],x=>({...x,updated_at:fmtDate(x.updated_at)}))}</div><div class="panel"><h2>Доска</h2>${compactTable(d.posts,[['author_name','Автор'],['body','Текст'],['created_at','Дата']],x=>({...x,created_at:fmtDate(x.created_at)}))}</div>`});}
async function renderV2Market(){const d=await api('/v2/market');$('#v2Body').innerHTML=`<div class="metric-grid">${metric('Лоты',d.listings.length)}${metric('Сделки',d.trades.length)}${metric('Заявки',d.orders.length)}</div><div class="panel"><h2>Активные и закрытые лоты</h2>${compactTable(d.listings,[['item_id','Предмет'],['seller_name','Продавец'],['remaining','Остаток'],['price_per_unit','Цена'],['status','Статус']])}</div><div class="panel"><h2>История сделок</h2>${compactTable(d.trades,[['item_id','Предмет'],['seller_name','Продавец'],['buyer_name','Покупатель'],['quantity','Кол-во'],['unit_price','Цена']])}</div>`;}
async function renderV2Content(){const d=await api('/v2/content-documents');state.liveOpsCache.documents=d.items;$('#v2Body').innerHTML=`<div class="panel-header"><div><h2>Визуальный редактор историй</h2><p>Узлы, варианты, условия, награды, публикация и откат</p></div>${button('Новая история','v2-content-new','','primary')}</div><div class="card-grid">${d.items.map(x=>`<article class="panel"><span class="pill ${x.status==='published'?'ok':'neutral'}">${escapeHtml(x.status)}</span><h2>${escapeHtml(x.title)}</h2><p class="code">${escapeHtml(x.slug)}</p><p>Опубликована версия: ${x.published_version||'—'} · всего версий ${x.version_count||0}</p>${button('Открыть редактор','v2-content-open',x.id,'primary')}</article>`).join('')||'<div class="empty">Историй ещё нет</div>'}</div>`;}
function graphTemplate(){return{startNodeId:'start',nodes:[{id:'start',type:'scene',title:'Начало',text:'Лифт открывается в незнакомый коридор.',x:80,y:80,config:{choices:[{key:'go',label:'Сделать шаг'}],conditions:[],rewards:{}}},{id:'ending',type:'ending',title:'Конец главы',text:'Двери закрываются.',x:420,y:80,config:{conditions:[],rewards:{entitlement:'chapter_complete'}}}],edges:[{id:'edge-start-ending',from:'start',to:'ending',label:'Сделать шаг',condition:{}}],metadata:{estimatedMinutes:30}};}
function graphEditor(graph){return `<div id="graphEditor"><div class="toolbar"><button type="button" class="button small ghost" id="graphAddNode">+ Узел</button><span class="subline">Переходы, условия и случайные ветки задаются связями</span></div><label>Стартовый узел<input id="graphStart" value="${attr(graph.startNodeId)}"></label><div id="graphNodes">${graph.nodes.map(nodeCard).join('')}</div><label>Связи JSON<textarea id="graphEdges" class="code" style="min-height:220px">${escapeHtml(JSON.stringify(graph.edges||[],null,2))}</textarea></label><label>Метаданные JSON<textarea id="graphMetadata" class="code">${escapeHtml(JSON.stringify(graph.metadata||{},null,2))}</textarea></label></div>`;}
function nodeCard(n){return `<article class="panel graph-node" data-node-id="${attr(n.id)}"><div class="panel-header"><input data-field="id" value="${attr(n.id)}" class="code"><select data-field="type">${['scene','choice','condition','reward','ending'].map(type=>`<option value="${type}" ${n.type===type?'selected':''}>${type}</option>`).join('')}</select><button type="button" class="button small danger" data-remove-node>×</button></div><label>Заголовок<input data-field="title" value="${attr(n.title)}"></label><label>Текст<textarea data-field="text">${escapeHtml(n.text)}</textarea></label><div class="form-grid"><label>X<input data-field="x" type="number" value="${Number(n.x||0)}"></label><label>Y<input data-field="y" type="number" value="${Number(n.y||0)}"></label></div><label>Конфигурация JSON <span class="subline">choices, conditions, rewards, item requirements</span><textarea data-field="config" class="code" style="min-height:190px">${escapeHtml(JSON.stringify(n.config||{},null,2))}</textarea></label></article>`;}
function readGraph(root=document){return{startNodeId:$('#graphStart',root).value,nodes:$$('.graph-node',root).map(n=>({id:$('[data-field="id"]',n).value,type:$('[data-field="type"]',n).value,title:$('[data-field="title"]',n).value,text:$('[data-field="text"]',n).value,x:Number($('[data-field="x"]',n).value||0),y:Number($('[data-field="y"]',n).value||0),config:JSON.parse($('[data-field="config"]',n).value||'{}')})),edges:JSON.parse($('#graphEdges',root).value||'[]'),metadata:JSON.parse($('#graphMetadata',root).value||'{}')};}
function bindGraphEditor(){ $('#graphAddNode').onclick=()=>{const id='node_'+Date.now().toString().slice(-6);$('#graphNodes').insertAdjacentHTML('beforeend',nodeCard({id,type:'scene',title:'Новая сцена',text:'',x:120,y:120,config:{choices:[],conditions:[],rewards:{}}}));bindGraphRemovers();};bindGraphRemovers();}
function bindGraphRemovers(){$$('[data-remove-node]').forEach(b=>b.onclick=()=>b.closest('.graph-node').remove());}
function createContentDocument(){const graph=graphTemplate();openModal({title:'Новая сюжетная глава',kicker:'Визуальный редактор',submitText:'Создать черновик',width:'1180px',body:`<form class="form-grid"><label>Slug<input name="slug" value="chapter-${Date.now().toString().slice(-6)}"></label><label>Название<input name="title" value="Новая история"></label><label>Тип<input name="contentType" value="story_chapter"></label><label>Комментарий<input name="changeNote" value="Первая версия"></label><div class="wide">${graphEditor(graph)}</div></form>`,onSubmit:async root=>{const d=formObject(root);await api('/v2/content-documents',{method:'POST',body:{slug:d.slug,title:d.title,contentType:d.contentType,changeNote:d.changeNote,graph:readGraph(root)}});closeModal();toast('Черновик создан');await renderV2Content();}});setTimeout(bindGraphEditor);}
async function openContentDocument(id){const d=await api(`/v2/content-documents/${id}`);const version=d.versions?.[0]?.version||1;const g=await api(`/v2/content-documents/${id}/versions/${version}`);openModal({title:d.document.title,kicker:`${d.document.slug} · версия ${version}`,submitText:'Сохранить новой версией',width:'1180px',body:`<div class="toolbar"><input id="contentChangeNote" class="grow" placeholder="Что изменилось"><button type="button" class="button ghost" id="contentPublish">Опубликовать текущую</button></div>${graphEditor(g.graph)}<div class="panel"><h2>История версий</h2>${compactTable(d.versions,[['version','Версия'],['status','Статус'],['author_name','Автор'],['change_note','Комментарий'],['created_at','Дата']],x=>({...x,created_at:fmtDate(x.created_at)}))}</div>`,onSubmit:async root=>{const result=await api(`/v2/content-documents/${id}/versions`,{method:'POST',body:{graph:readGraph(root),changeNote:$('#contentChangeNote').value}});toast(`Создана версия ${result.version}`);closeModal();await openContentDocument(id);}});setTimeout(()=>{bindGraphEditor();$('#contentPublish').onclick=async()=>{await api(`/v2/content-documents/${id}/publish`,{method:'POST',body:{version,testAudience:{}}});toast('Версия опубликована');closeModal();await renderV2Content();};});}
async function renderV2Experiments(){const d=await api('/v2/experiments');state.liveOpsCache.experiments=d;$('#v2Body').innerHTML=`<div class="panel-header"><div><h2>A/B-тесты</h2><p>Первый экран, цены, комнаты, рефералы и предложения</p></div>${button('Новый тест','v2-experiment-new','','primary')}</div><div class="table-wrap"><table><thead><tr><th>Тест</th><th>Статус</th><th>Охват</th><th>Варианты</th><th>Участники</th><th></th></tr></thead><tbody>${d.experiments.map(e=>{const variants=d.variants.filter(v=>v.experiment_id===e.id);const users=d.assignments.filter(a=>a.experiment_id===e.id).reduce((s,a)=>s+Number(a.users),0);return`<tr><td><strong>${escapeHtml(e.title)}</strong><span class="subline code">${escapeHtml(e.key)}</span></td><td>${statusBadge(e.status)}</td><td>${e.allocation}%</td><td>${variants.map(v=>`<span class="pill">${escapeHtml(v.key)} · ${v.weight}</span>`).join('')}</td><td>${users}</td><td>${button(e.status==='running'?'Пауза':'Запустить','v2-experiment-toggle',e.id,e.status==='running'?'danger':'primary',`data-status="${e.status==='running'?'paused':'running'}"`)}</td></tr>`}).join('')}</tbody></table></div>`;}
function createExperiment(){openModal({title:'Новый A/B-тест',kicker:'Продуктовый эксперимент',submitText:'Создать',width:'900px',body:`<form class="form-grid"><label>Ключ<input name="key" value="first-screen-${Date.now().toString().slice(-5)}"></label><label>Название<input name="title" value="Первый экран"></label><label class="wide">Описание<textarea name="description">Сравнение двух вариантов вступления</textarea></label><label>Охват, %<input name="allocation" type="number" value="50"></label><label class="wide">Варианты JSON<textarea name="variants" class="code">[
  {"key":"control","weight":50,"config":{"headline":"Лифт остановился"}},
  {"key":"door","weight":50,"config":{"headline":"Кто-то ждёт за дверью"}}
]</textarea></label></form>`,onSubmit:async root=>{const d=formObject(root);await api('/v2/experiments',{method:'POST',body:{key:d.key,title:d.title,description:d.description,allocation:Number(d.allocation),variants:JSON.parse(d.variants)}});closeModal();toast('Эксперимент создан');await renderV2Experiments();}});}
async function toggleExperiment(id,status){await api(`/v2/experiments/${id}`,{method:'PATCH',body:{status}});toast('Статус теста изменён');await renderV2Experiments();}
async function renderV2Support(){const d=await api('/v2/support');$('#v2Body').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Тема</th><th>Игрок</th><th>Категория</th><th>Статус</th><th>Версия</th><th>Обновлено</th><th></th></tr></thead><tbody>${d.items.map(t=>`<tr><td>${escapeHtml(t.subject)}</td><td>${escapeHtml(t.first_name)}<span class="subline">${t.user_id}</span></td><td>${escapeHtml(t.category)}</td><td>${statusBadge(t.status)}</td><td>${escapeHtml(t.app_version||'—')}</td><td>${fmtDate(t.updated_at)}</td><td>${button('Открыть','v2-ticket-open',t.id)}</td></tr>`).join('')}</tbody></table></div>`;}
async function openSupportTicket(id){const d=await api(`/v2/support/${id}`);openModal({title:d.ticket.subject,kicker:`${d.ticket.category} · ${d.ticket.user_id}`,submitText:'Ответить',width:'900px',body:`<div class="panel"><pre class="code">${json(d.ticket.context)}</pre></div>${d.messages.map(m=>`<div class="list-card"><div><strong>${m.author_user_id?'Игрок':m.admin_name||'Администратор'}</strong><p>${escapeHtml(m.body)}</p></div><span>${fmtDate(m.created_at)}</span></div>`).join('')}<form class="form-grid"><label class="wide">Ответ<textarea name="body"></textarea></label><label>Статус<select name="status"><option value="waiting_user">Ждём игрока</option><option value="resolved">Решено</option><option value="closed">Закрыто</option></select></label><label class="check-row"><input name="sendTelegram" type="checkbox" checked> Отправить в Telegram</label></form>`,onSubmit:async root=>{const f=formObject(root);await api(`/v2/support/${id}/reply`,{method:'POST',body:{body:f.body,status:f.status,sendTelegram:Boolean(f.sendTelegram)}});closeModal();toast('Ответ отправлен');await renderV2Support();}});}
async function renderV2Moderation(){const d=await api('/v2/moderation');state.liveOpsCache.moderation=d;$('#v2Body').innerHTML=`<div class="metric-grid">${metric('Жалобы',d.reports.length)}${metric('Риск-флаги',d.flags.length)}${metric('Правила текста',d.terms.length)}</div><div class="panel"><h2>Автоматические флаги</h2><div class="table-wrap"><table><thead><tr><th>Игрок</th><th>Тип</th><th>Риск</th><th>Статус</th><th></th></tr></thead><tbody>${d.flags.map(f=>`<tr><td>${escapeHtml(f.first_name||f.user_id)}</td><td>${escapeHtml(f.flag_type)}</td><td>${f.risk_score}</td><td>${statusBadge(f.status)}</td><td>${button('Подтвердить','v2-risk-status',f.id,'danger','data-status="confirmed"')} ${button('Очистить','v2-risk-status',f.id,'ghost','data-status="cleared"')}</td></tr>`).join('')}</tbody></table></div></div><div class="panel"><h2>Жалобы игроков</h2>${compactTable(d.reports,[['reporter_name','Автор'],['target_name','На кого'],['entity_type','Объект'],['reason','Причина'],['status','Статус']])}</div><div class="panel"><h2>Фильтр текста</h2>${compactTable(d.terms,[['pattern','Выражение'],['severity','Риск'],['action','Действие'],['active','Активно']])}</div>`;}
async function updateRiskFlag(id,status){await api(`/v2/moderation/flags/${id}`,{method:'PATCH',body:{status}});toast('Флаг обработан');await renderV2Moderation();}
async function renderV2Backups(){const d=await api('/v2/backups');$('#v2Body').innerHTML=`<div class="panel-header"><div><h2>Резервные копии PostgreSQL</h2><p>Ежедневные копии, retention, checksum и проверка восстановления</p></div>${button('Создать сейчас','v2-backup','','primary')}</div><div class="table-wrap"><table><thead><tr><th>Тип</th><th>Статус</th><th>Размер</th><th>Checksum</th><th>Начало</th><th>Проверено</th></tr></thead><tbody>${d.items.map(x=>`<tr><td>${escapeHtml(x.kind)}</td><td>${statusBadge(x.status)}</td><td>${x.size_bytes?fmtNumber(Math.round(x.size_bytes/1024))+' KB':'—'}</td><td class="code">${escapeHtml((x.checksum||'').slice(0,16))}</td><td>${fmtDate(x.started_at)}</td><td>${fmtDate(x.verified_at)}</td></tr>`).join('')}</tbody></table></div><div class="panel"><h2>Команды восстановления</h2><pre class="code">npm run backup:verify -- /backups/file.dump
npm run backup:restore -- /backups/file.dump
npm run export:data</pre></div>`;}
async function createV2Backup(){await api('/v2/backups',{method:'POST',body:{}});toast('Резервная копия создана');await renderV2Backups();}
async function renderV2Observability(){const d=await api('/v2/observability');$('#v2Body').innerHTML=`<div class="metric-grid">${metric('DB connections',d.database.connections)}${metric('Размер базы',Math.round(Number(d.database.database_bytes)/1024/1024),'MB')}${metric('Redis',d.redis?.ok?1:0,d.redis?.ok?'доступен':'ошибка')}</div><div class="panel-grid"><article class="panel"><h2>Очередь рассылок</h2>${compactTable(d.queues,[['status','Статус'],['count','Количество']])}</article><article class="panel"><h2>Платежи за 24 часа</h2>${compactTable(d.payments,[['status','Статус'],['count','Количество']])}</article><article class="panel span-2"><h2>Prometheus metrics</h2><pre class="code" style="max-height:420px;overflow:auto">${escapeHtml(d.metrics)}</pre></article></div>`;}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const errorNode = $('#loginError');
  errorNode.hidden = true;
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const buttonNode = $('button[type="submit"]', event.currentTarget);
  buttonNode.disabled = true;
  try {
    const result = await api('/auth/login', { method: 'POST', body: data });
    state.token = result.token;
    sessionStorage.setItem('ef_admin_token', result.token);
    const me = await api('/auth/me');
    state.admin = me.admin;
    state.permissions = me.permissions;
    showApp();
    await renderCurrent();
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
  } finally { buttonNode.disabled = false; }
});

$('#logoutButton').addEventListener('click', () => logout());
$('#refreshButton').addEventListener('click', renderCurrent);
$('#navigation').addEventListener('click', event => {
  const node = event.target.closest('[data-view]');
  if (!node) return;
  state.view = node.dataset.view;
  state.page = 1;
  state.filters = {};
  renderCurrent();
});

$('#content').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('#userSearch,#purchaseSearch,#auditSearch')) {
    event.preventDefault();
    const action = event.target.id === 'userSearch' ? 'users-apply' : event.target.id === 'purchaseSearch' ? 'purchases-apply' : 'audit-apply';
    $(`[data-action="${action}"]`, $('#content'))?.click();
  }
});

async function handleAction(action, id, node) {
  if (action === 'go-users') { state.view='users';state.page=1;return renderCurrent(); }
  if (action === 'go-purchases') { state.view='purchases';state.page=1;return renderCurrent(); }
  if (action === 'page-prev') { state.page=Math.max(1,state.page-1);return renderCurrent(); }
  if (action === 'page-next') { state.page+=1;return renderCurrent(); }
  if (action === 'users-apply') { state.filters.userSearch=$('#userSearch').value;state.filters.userStatus=$('#userStatus').value;state.filters.userSort=$('#userSort').value;state.page=1;return renderUsers(); }
  if (action === 'user-open') return openUser(id);
  if (action === 'user-edit') return userEdit(id);
  if (action === 'user-inventory') return userInventory(id);
  if (action === 'user-grant-product') return userGrantProduct(id);
  if (action === 'user-entitlement') return userEntitlement(id);
  if (action === 'user-message') return userMessage(id);
  if (action === 'user-moderate') return userModerate(id);
  if (action === 'user-reset') return userReset(id);
  if (action === 'user-delete') return userDelete(id);
  if (action === 'purchases-apply') { state.filters.purchaseSearch=$('#purchaseSearch').value;state.filters.purchaseStatus=$('#purchaseStatus').value;state.page=1;return renderPurchases(); }
  if (action === 'stars-transactions') return showStarTransactions();
  if (action === 'purchase-refund') return confirmPurchaseAction(id,'refund');
  if (action === 'purchase-cancel') return confirmPurchaseAction(id,'cancel');
  if (action === 'content-tab') { state.contentTab=id;return renderContent(); }
  if (action === 'room-new') return editRoom();
  if (action === 'room-edit') return editRoom(id);
  if (action === 'room-delete') return deleteRoom(id);
  if (action === 'shop-new') return editShop();
  if (action === 'shop-edit') return editShop(id);
  if (action === 'shop-disable') return disableShop(id);
  if (action === 'event-new') return editEvent();
  if (action === 'event-edit') return editEvent(id);
  if (action === 'event-delete') return deleteEvent(id);
  if (action === 'season-new') return editSeason();
  if (action === 'season-edit') return editSeason(id);
  if (action === 'season-delete') return deleteSeason(id);
  if (action === 'broadcast-new') return newBroadcast();
  if (action === 'broadcast-start') return broadcastAction(id,'start');
  if (action === 'broadcast-pause') return broadcastAction(id,'pause');
  if (action === 'broadcast-cancel') return broadcastAction(id,'cancel');
  if (action === 'operations-tab') { state.operationsTab=id;return renderOperations(); }
  if (action === 'v2-tab') { state.liveOpsTab=id;return renderV2(); }
  if (action === 'v2-backup') return createV2Backup();
  if (action === 'v2-coop-cancel') return cancelV2Coop(id);
  if (action === 'v2-daily-new') return createDailyScenario();
  if (action === 'v2-content-new') return createContentDocument();
  if (action === 'v2-content-open') return openContentDocument(id);
  if (action === 'v2-experiment-new') return createExperiment();
  if (action === 'v2-experiment-toggle') return toggleExperiment(id,node.dataset.status);
  if (action === 'v2-ticket-open') return openSupportTicket(id);
  if (action === 'v2-risk-status') return updateRiskFlag(id,node.dataset.status);
  if (action === 'v2-building-open') return openBuildingV2(id);
  if (action === 'expedition-cancel') return operationDelete(`/operations/expeditions/${id}/cancel`,'Прервать активную вылазку?',renderExpeditions);
  if (action === 'note-delete') return operationDelete(`/operations/notes/${id}`,'Удалить записку?',renderNotes);
  if (action === 'admin-new') return editAdmin();
  if (action === 'admin-edit') return editAdmin(id);
  if (action === 'audit-apply') { state.filters.auditSearch=$('#auditSearch').value;state.page=1;return renderAudit(); }
  if (action === 'audit-details') return openModal({title:'Детали действия',kicker:'Запись аудита',body:`<pre class="code">${json(JSON.parse(node.dataset.json||'{}'))}</pre>`});
}

$('#content').addEventListener('click', async event => {
  const node = event.target.closest('[data-action]');
  if (!node || node.disabled) return;
  try { await handleAction(node.dataset.action, node.dataset.id || '', node); }
  catch (error) { toast(error.message, 'error'); }
});
$('#modalBody').addEventListener('click', async event => {
  const node = event.target.closest('[data-action]');
  if (!node) return;
  closeModal();
  try { await handleAction(node.dataset.action, node.dataset.id || '', node); }
  catch (error) { toast(error.message, 'error'); }
});

boot();
