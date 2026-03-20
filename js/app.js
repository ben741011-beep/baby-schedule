/* ===================================================================
   寶寶作息表 — 記錄寶寶喝奶、睡覺、換尿布、體溫、自訂項目
   資料串接 Google Sheet (via Apps Script)
   =================================================================== */

// ====== Config ======
const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbwjUUkuHKeNQkaZRESbSzcp7bYNrmIHNTjVEZoK83snOSA-Ri_1dq8rqJlVQqilU0kHDg/exec';
let SCRIPT_URL = localStorage.getItem('baby-schedule-url') || DEFAULT_URL;

const $ = s => document.querySelector(s);

// ====== 欄位模板 ======
// 每種模板定義 form 怎麼長、怎麼送、怎麼顯示
const FIELD_TEMPLATES = {
  'time-only': {
    label: '⏰ 只記時間',
    headers: ['日期', '時間', '備註'],
    form: (now) => `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `,
    collect: (today) => {
      const note = ($('#f-note') && $('#f-note').value.trim()) || '';
      return [today, $('#f-time').value, note];
    },
    display: (r) => r['時間'] || '',
    timeKey: '時間',
  },
  'start-end': {
    label: '⏱️ 起止時間',
    headers: ['日期', '開始時間', '結束時間', '時長(分鐘)', '備註'],
    form: (now) => `
      <div class="field"><label>開始時間</label><input type="time" id="f-sleep-start" value="${now}"></div>
      <div class="field"><label>結束時間（進行中可留空）</label><input type="time" id="f-sleep-end"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `,
    collect: (today) => {
      const start = $('#f-sleep-start').value;
      const end = $('#f-sleep-end').value || '';
      let dur = '';
      if (start && end) {
        const [sh, sm] = start.split(':').map(Number);
        const [eh, em] = end.split(':').map(Number);
        dur = (eh * 60 + em) - (sh * 60 + sm);
        if (dur < 0) dur += 24 * 60;
      }
      const note = ($('#f-note') && $('#f-note').value.trim()) || '';
      return [today, start, end, dur, note];
    },
    display: (r) => `${r['開始時間'] || ''} ~ ${r['結束時間'] || '進行中'}${r['時長(分鐘)'] ? ' (' + r['時長(分鐘)'] + '分鐘)' : ''}`,
    timeKey: '開始時間',
  },
  'time-amount': {
    label: '📊 時間＋數量',
    headers: ['日期', '時間', '數量', '備註'],
    form: (now) => `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>數量</label><input type="number" id="f-amount" placeholder="例：100" inputmode="numeric"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `,
    collect: (today) => {
      const note = ($('#f-note') && $('#f-note').value.trim()) || '';
      return [today, $('#f-time').value, parseInt($('#f-amount').value) || 0, note];
    },
    display: (r) => `${r['數量'] || 0}`,
    timeKey: '時間',
  },
  'time-value': {
    label: '🔢 時間＋數值(小數)',
    headers: ['日期', '時間', '數值', '備註'],
    form: (now) => `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>數值</label><input type="number" id="f-val" step="0.1" placeholder="例：36.8" inputmode="decimal"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `,
    collect: (today) => {
      const note = ($('#f-note') && $('#f-note').value.trim()) || '';
      return [today, $('#f-time').value, parseFloat($('#f-val').value) || 0, note];
    },
    display: (r) => `${r['數值'] || 0}`,
    timeKey: '時間',
  },
};

// ====== 內建類型 ======
const BUILTIN_TYPES = [
  {
    id: 'milk', sheetName: '餵奶', icon: '🍼', label: '喝奶', color: 'milk',
    template: null, // 用自訂 form
    headers: ['日期', '時間', '類型', '奶量(ml)', '備註'],
  },
  {
    id: 'sleep', sheetName: '睡覺', icon: '😴', label: '睡覺', color: 'sleep',
    template: null,
    headers: ['日期', '開始時間', '結束時間', '時長(分鐘)', '備註'],
  },
  {
    id: 'diaper', sheetName: '換尿布', icon: '🧷', label: '尿布', color: 'diaper',
    template: null,
    headers: ['日期', '時間', '類型', '備註'],
  },
  {
    id: 'pump', sheetName: '擠奶', icon: '🤱', label: '擠奶', color: 'pump',
    template: null,
    headers: ['日期', '時間', '側別', '奶量(ml)', '備註'],
  },
  {
    id: 'temp', sheetName: '體溫', icon: '🌡️', label: '體溫', color: 'temp',
    template: null,
    headers: ['日期', '時間', '體溫(°C)', '備註'],
  },
];

// ====== 自訂類型 (存 localStorage) ======
function loadCustomTypes() {
  try { return JSON.parse(localStorage.getItem('baby-custom-types') || '[]'); }
  catch { return []; }
}
function saveCustomTypes(types) {
  localStorage.setItem('baby-custom-types', JSON.stringify(types));
}

// ====== 隱藏的內建類型 ======
function loadHiddenTypes() {
  try { return JSON.parse(localStorage.getItem('baby-hidden-types') || '[]'); }
  catch { return []; }
}
function saveHiddenTypes(ids) {
  localStorage.setItem('baby-hidden-types', JSON.stringify(ids));
}

function getAllTypes() {
  const hidden = loadHiddenTypes();
  const builtin = BUILTIN_TYPES.filter(t => !hidden.includes(t.id));
  return [...builtin, ...loadCustomTypes()];
}

// ====== Setup ======
function checkSetup() {
  const overlay = $('#setup-overlay');
  if (SCRIPT_URL) {
    overlay.classList.add('hidden');
    init();
  } else {
    overlay.classList.remove('hidden');
  }
}

function saveSetup() {
  const url = $('#setup-url').value.trim();
  if (!url || !url.startsWith('https://script.google.com')) {
    showToast('❌ 請輸入有效的 Apps Script URL');
    return;
  }
  SCRIPT_URL = url;
  localStorage.setItem('baby-schedule-url', url);
  $('#setup-overlay').classList.add('hidden');
  showToast('✅ 已連接！');
  init();
}

// ====== API ======
async function apiCall(data) {
  try {
    const resp = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(data),
    });
    return await resp.json();
  } catch (e) {
    console.error('API Error:', e);
    showToast('❌ 連線失敗，請檢查網路');
    return { status: 'error', message: e.toString() };
  }
}

// ====== State ======
let currentForm = null;
let todayData = {};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ====== Init ======
function init() {
  const d = new Date();
  const weekdays = ['日','一','二','三','四','五','六'];
  $('#today-date').textContent = `${d.getMonth()+1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;

  renderQuickActions();
  renderSummaryGrid();
  loadToday();
}

// ====== Render Quick Action Buttons ======
function renderQuickActions() {
  const el = $('#quick-actions');
  const types = getAllTypes();
  el.innerHTML = types.map(t =>
    `<button class="action-btn ${t.color || 'custom'}" onclick="openForm('${t.id}')">
      <span class="action-icon">${t.icon}</span>
      <span class="action-label">${t.label}</span>
    </button>`
  ).join('') +
  `<button class="action-btn add-type" onclick="openAddType()">
    <span class="action-icon">➕</span>
    <span class="action-label">新增</span>
  </button>`;
}

// ====== Render Summary Grid ======
function renderSummaryGrid() {
  const el = $('#summary-stats');
  const types = getAllTypes();
  el.innerHTML = types.map(t =>
    `<div class="summary-item">
      <div class="summary-icon">${t.icon}</div>
      <div class="summary-val" id="sum-${t.id}">0</div>
      <div class="summary-label">次${t.label}</div>
    </div>`
  ).join('');
}

// ====== Load Today's Data ======
async function loadToday() {
  const types = getAllTypes();
  const sheetNames = types.map(t => t.sheetName);
  const res = await apiCall({ action: 'getToday', date: todayStr(), sheets: sheetNames });
  if (res.status === 'ok' && res.data) {
    todayData = res.data;
    renderSummary();
    renderTimeline();
  }
}

// ====== Render Summary ======
function renderSummary() {
  const types = getAllTypes();
  types.forEach(t => {
    const count = (todayData[t.sheetName] || []).length;
    const el = document.getElementById('sum-' + t.id);
    if (el) el.textContent = count;
  });
}

// ====== Render Timeline ======
function renderTimeline() {
  const tl = $('#timeline');
  const empty = $('#timeline-empty');
  tl.innerHTML = '';
  const items = [];
  const types = getAllTypes();

  types.forEach(t => {
    (todayData[t.sheetName] || []).forEach(r => {
      let text, time;
      // 內建類型用特殊顯示
      if (t.id === 'milk') {
        time = r['時間'] || '';
        text = `${r['類型'] || '母奶'} ${r['奶量(ml)'] || ''}ml`;
      } else if (t.id === 'sleep') {
        time = r['開始時間'] || '';
        const dur = r['時長(分鐘)'] ? ` (${r['時長(分鐘)']}分鐘)` : '';
        text = `${r['開始時間'] || ''} ~ ${r['結束時間'] || '進行中'}${dur}`;
      } else if (t.id === 'diaper') {
        time = r['時間'] || '';
        text = r['類型'] || '';
      } else if (t.id === 'temp') {
        time = r['時間'] || '';
        const temp = parseFloat(r['體溫(°C)']) || 0;
        text = `${r['體溫(°C)']}°C${temp >= 37.5 ? ' ⚠️' : ''}`;
      } else if (t.id === 'pump') {
        time = r['時間'] || '';
        text = `${r['側別'] || ''} ${r['奶量(ml)'] || ''}ml`;
      } else if (t.template) {
        // 自訂類型
        const tmpl = FIELD_TEMPLATES[t.template];
        const timeKey = tmpl ? tmpl.timeKey : '時間';
        time = r[timeKey] || '';
        text = tmpl ? tmpl.display(r) : (r['備註'] || '');
      } else {
        time = r['時間'] || '';
        text = r['備註'] || '';
      }
      items.push({ time, icon: t.icon, sheet: t.sheetName, text, note: r['備註'] || '' });
    });
  });

  items.sort((a, b) => b.time.localeCompare(a.time));

  if (items.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'timeline-item';
    el.innerHTML = `
      <span class="tl-time">${item.time}</span>
      <span class="tl-icon">${item.icon}</span>
      <div class="tl-content">
        ${item.text}
        ${item.note ? `<br><small>${item.note}</small>` : ''}
      </div>
      <button class="tl-delete" title="刪除" data-sheet="${item.sheet}" data-time="${item.time}">🗑️</button>
    `;
    tl.appendChild(el);
  });

  tl.querySelectorAll('.tl-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除這筆記錄？')) return;
      await apiCall({ action: 'delete', sheet: btn.dataset.sheet, date: todayStr(), time: btn.dataset.time });
      showToast('🗑️ 已刪除');
      loadToday();
    });
  });
}

// ====== Forms ======
function openForm(typeId) {
  const types = getAllTypes();
  const t = types.find(x => x.id === typeId);
  if (!t) return;

  currentForm = typeId;
  const body = $('#form-body');
  const title = $('#form-title');
  const overlay = $('#form-overlay');
  const now = nowTime();

  // 內建類型
  if (typeId === 'milk') {
    title.textContent = '🍼 記錄喝奶';
    body.innerHTML = `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>類型</label>
        <div class="radio-group" id="f-milk-type">
          <div class="radio-option selected" data-val="母奶">🤱 母奶</div>
          <div class="radio-option" data-val="配方奶">🍼 配方奶</div>
        </div>
      </div>
      <div class="field"><label>奶量 (ml)</label><input type="number" id="f-ml" placeholder="例：120" inputmode="numeric"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `;
  } else if (typeId === 'sleep') {
    title.textContent = '😴 記錄睡覺';
    body.innerHTML = `
      <div class="field"><label>開始時間</label><input type="time" id="f-sleep-start" value="${now}"></div>
      <div class="field"><label>結束時間（還在睡可留空）</label><input type="time" id="f-sleep-end"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `;
  } else if (typeId === 'diaper') {
    title.textContent = '🧷 記錄換尿布';
    body.innerHTML = `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>類型</label>
        <div class="radio-group" id="f-diaper-type">
          <div class="radio-option" data-val="小便">💧 小便</div>
          <div class="radio-option" data-val="大便">💩 大便</div>
          <div class="radio-option selected" data-val="兩者">💧💩 兩者</div>
        </div>
      </div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `;
  } else if (typeId === 'pump') {
    title.textContent = '🤱 記錄擠奶';
    body.innerHTML = `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>側別</label>
        <div class="radio-group" id="f-pump-side">
          <div class="radio-option" data-val="左側">⬅️ 左側</div>
          <div class="radio-option" data-val="右側">➡️ 右側</div>
          <div class="radio-option selected" data-val="兩側">↔️ 兩側</div>
        </div>
      </div>
      <div class="field"><label>奶量 (ml)</label><input type="number" id="f-pump-ml" placeholder="例：80" inputmode="numeric"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `;
  } else if (typeId === 'temp') {
    title.textContent = '🌡️ 記錄體溫';
    body.innerHTML = `
      <div class="field"><label>時間</label><input type="time" id="f-time" value="${now}"></div>
      <div class="field"><label>體溫 (°C)</label><input type="number" id="f-temp" step="0.1" placeholder="例：36.8" inputmode="decimal"></div>
      <div class="field"><label>備註</label><input type="text" id="f-note" placeholder="選填"></div>
    `;
  } else if (t.template && FIELD_TEMPLATES[t.template]) {
    // 自訂類型
    title.textContent = `${t.icon} 記錄${t.label}`;
    body.innerHTML = FIELD_TEMPLATES[t.template].form(now);
  }

  // Radio toggle
  body.querySelectorAll('.radio-group').forEach(group => {
    group.querySelectorAll('.radio-option').forEach(opt => {
      opt.addEventListener('click', () => {
        group.querySelectorAll('.radio-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });
  });

  overlay.classList.remove('hidden');
}

function closeForm() {
  $('#form-overlay').classList.add('hidden');
  currentForm = null;
}

async function submitForm() {
  const btn = $('#btn-submit');
  const textEl = $('#btn-submit-text');
  const loadEl = $('#btn-submit-loading');
  btn.disabled = true;
  textEl.classList.add('hidden');
  loadEl.classList.remove('hidden');

  const today = todayStr();
  const types = getAllTypes();
  const t = types.find(x => x.id === currentForm);
  let sheetName, row;

  if (currentForm === 'milk') {
    const note = ($('#f-note') && $('#f-note').value.trim()) || '';
    sheetName = '餵奶';
    row = [today, $('#f-time').value, document.querySelector('#f-milk-type .selected')?.dataset.val || '母奶', parseInt($('#f-ml').value) || 0, note];
  } else if (currentForm === 'sleep') {
    const start = $('#f-sleep-start').value;
    const end = $('#f-sleep-end').value || '';
    let dur = '';
    if (start && end) {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      dur = (eh * 60 + em) - (sh * 60 + sm);
      if (dur < 0) dur += 24 * 60;
    }
    const note = ($('#f-note') && $('#f-note').value.trim()) || '';
    sheetName = '睡覺';
    row = [today, start, end, dur, note];
  } else if (currentForm === 'diaper') {
    const note = ($('#f-note') && $('#f-note').value.trim()) || '';
    sheetName = '換尿布';
    row = [today, $('#f-time').value, document.querySelector('#f-diaper-type .selected')?.dataset.val || '小便', note];
  } else if (currentForm === 'pump') {
    const note = ($('#f-note') && $('#f-note').value.trim()) || '';
    sheetName = '擠奶';
    row = [today, $('#f-time').value, document.querySelector('#f-pump-side .selected')?.dataset.val || '兩側', parseInt($('#f-pump-ml').value) || 0, note];
  } else if (currentForm === 'temp') {
    const note = ($('#f-note') && $('#f-note').value.trim()) || '';
    sheetName = '體溫';
    row = [today, $('#f-time').value, parseFloat($('#f-temp').value) || 36.5, note];
  } else if (t && t.template && FIELD_TEMPLATES[t.template]) {
    sheetName = t.sheetName;
    row = FIELD_TEMPLATES[t.template].collect(today);
  }

  const headers = t ? (t.template ? FIELD_TEMPLATES[t.template].headers : t.headers) : null;
  const res = await apiCall({ action: 'add', sheet: sheetName, row, headers });

  btn.disabled = false;
  textEl.classList.remove('hidden');
  loadEl.classList.add('hidden');

  if (res.status === 'ok') {
    showToast('✅ 已記錄！');
    closeForm();
    loadToday();
  } else {
    showToast('❌ ' + (res.message || '記錄失敗'));
  }
}

// ====== 新增自訂類型 ======
const EMOJI_CHOICES = ['🛁','💊','🧴','👶','🍎','🥣','💉','🏥','📝','🎵','🚗','☀️','🌙','💤','🧸','👣','🍌','🧃','💩','🩺'];

function openAddType() {
  currentForm = '__add_type__';
  const body = $('#form-body');
  const title = $('#form-title');
  title.textContent = '➕ 新增記錄項目';

  body.innerHTML = `
    <div class="field">
      <label>名稱</label>
      <input type="text" id="f-type-name" placeholder="例：洗澡、吃藥" maxlength="6">
    </div>
    <div class="field">
      <label>選個圖示</label>
      <div class="emoji-picker" id="f-type-emoji">
        ${EMOJI_CHOICES.map((e, i) => `<span class="emoji-opt${i === 0 ? ' selected' : ''}" data-val="${e}">${e}</span>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>欄位模板</label>
      <div class="radio-group" id="f-type-template" style="flex-wrap:wrap">
        ${Object.entries(FIELD_TEMPLATES).map(([k, v], i) =>
          `<div class="radio-option${i === 0 ? ' selected' : ''}" data-val="${k}">${v.label}</div>`
        ).join('')}
      </div>
    </div>
    <div id="custom-type-list" style="margin-top:16px"></div>
  `;

  // Emoji picker
  body.querySelectorAll('.emoji-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      body.querySelectorAll('.emoji-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });

  // Radio toggle
  body.querySelectorAll('.radio-group').forEach(group => {
    group.querySelectorAll('.radio-option').forEach(opt => {
      opt.addEventListener('click', () => {
        group.querySelectorAll('.radio-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });
  });

  // Show existing custom types with delete buttons
  renderCustomTypeList();

  $('#form-overlay').classList.remove('hidden');
}

function renderCustomTypeList() {
  const el = document.getElementById('custom-type-list');
  if (!el) return;
  const customs = loadCustomTypes();
  const hidden = loadHiddenTypes();

  let html = '<label style="font-size:13px;font-weight:600;color:#888;display:block;margin-bottom:8px">管理項目</label>';

  // Built-in types (can hide/show)
  html += BUILTIN_TYPES.map(t => {
    const isHidden = hidden.includes(t.id);
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${isHidden ? '#f0f0f0' : '#f8f8f8'};border-radius:10px;margin-bottom:6px;${isHidden ? 'opacity:0.5' : ''}">
        <span style="font-size:20px">${t.icon}</span>
        <span style="flex:1;font-weight:600">${t.label}</span>
        <span style="font-size:11px;color:#aaa">內建</span>
        <button onclick="toggleBuiltinType('${t.id}')" style="border:none;background:none;font-size:16px;cursor:pointer">${isHidden ? '👁️' : '🙈'}</button>
      </div>`;
  }).join('');

  // Custom types (can delete)
  if (customs.length > 0) {
    html += customs.map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8f8f8;border-radius:10px;margin-bottom:6px">
        <span style="font-size:20px">${t.icon}</span>
        <span style="flex:1;font-weight:600">${t.label}</span>
        <span style="font-size:12px;color:#999">${FIELD_TEMPLATES[t.template]?.label || ''}</span>
        <button onclick="deleteCustomType('${t.id}')" style="border:none;background:none;font-size:16px;cursor:pointer;opacity:0.5">🗑️</button>
      </div>
    `).join('');
  }

  el.innerHTML = html;
}

function toggleBuiltinType(id) {
  let hidden = loadHiddenTypes();
  if (hidden.includes(id)) {
    hidden = hidden.filter(x => x !== id);
    showToast('👁️ 已顯示');
  } else {
    hidden.push(id);
    showToast('🙈 已隱藏');
  }
  saveHiddenTypes(hidden);
  renderQuickActions();
  renderSummaryGrid();
  renderCustomTypeList();
}

function deleteCustomType(id) {
  if (!confirm('確定要刪除此項目？')) return;
  let customs = loadCustomTypes();
  customs = customs.filter(t => t.id !== id);
  saveCustomTypes(customs);
  renderQuickActions();
  renderSummaryGrid();
  renderCustomTypeList();
  showToast('🗑️ 已刪除');
}

function submitAddType() {
  const name = $('#f-type-name').value.trim();
  if (!name) { showToast('❌ 請輸入名稱'); return false; }
  const emoji = document.querySelector('#f-type-emoji .selected')?.dataset.val || '📝';
  const template = document.querySelector('#f-type-template .selected')?.dataset.val || 'time-only';

  const id = 'custom_' + Date.now();
  const customs = loadCustomTypes();

  customs.push({
    id,
    sheetName: name,
    icon: emoji,
    label: name,
    color: 'custom',
    template,
    headers: FIELD_TEMPLATES[template].headers,
  });

  saveCustomTypes(customs);
  renderQuickActions();
  renderSummaryGrid();
  showToast(`✅ 已新增「${name}」！`);
  closeForm();
  loadToday();
  return true;
}

// Override submitForm to handle add-type
const _originalSubmit = submitForm;
submitForm = async function() {
  if (currentForm === '__add_type__') {
    submitAddType();
    return;
  }
  return _originalSubmit();
};

// ====== Toast ======
let toastTimer;
function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

// ====== Start ======
checkSetup();
