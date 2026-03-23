/* ===================================================================
   寶寶作息表 — 記錄寶寶喝奶、睡覺、換尿布、體溫、自訂項目
   資料串接 Google Sheet (via Apps Script)
   =================================================================== */

// ====== Config ======
const APP_VERSION = 'v1.2.0';
const DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbxJc2ZRUIu7yRRT231dY3syylF77m8ERC-Wib9yfW4XRxJInzAXRpOCy491ID3tUOlR/exec';
let SCRIPT_URL = localStorage.getItem('baby-schedule-url') || DEFAULT_URL;

const $ = s => document.querySelector(s);

function getBabyName() {
  return localStorage.getItem('baby-name') || '';
}
function setBabyName(name) {
  localStorage.setItem('baby-name', name.trim());
  updateTitle();
}
function updateTitle() {
  const name = getBabyName();
  const titleEl = document.querySelector('.app-title');
  if (titleEl) {
    const ver = document.getElementById('app-version');
    titleEl.innerHTML = `🍼 ${name ? name + '的' : '寶寶'}作息表 <small id="app-version" style="font-size:11px;opacity:0.6">${APP_VERSION}</small>`;
  }
}

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
let selectedDate = new Date(); // 目前選擇的日期

function todayStr() {
  return formatDateStr(selectedDate);
}

function realTodayStr() {
  return formatDateStr(new Date());
}

function formatDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function isToday() {
  return formatDateStr(selectedDate) === formatDateStr(new Date());
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ====== Date Navigation ======
function updateDateDisplay() {
  const d = selectedDate;
  const weekdays = ['日','一','二','三','四','五','六'];
  const label = `${d.getMonth()+1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
  $('#today-date').textContent = label;

  // 顯示/隱藏「今天」按鈕
  const todayBtn = document.getElementById('date-today-btn');
  if (todayBtn) todayBtn.classList.toggle('hidden', isToday());

  // 未來日期不能按下一天
  const nextBtn = document.getElementById('date-next');
  if (nextBtn) nextBtn.disabled = isToday();

  // 更新標題
  const dayLabel = isToday() ? '今日' : `${d.getMonth()+1}/${d.getDate()}`;
  const sumTitle = document.getElementById('summary-title');
  if (sumTitle) sumTitle.textContent = `📋 ${dayLabel}摘要`;
  const tlTitle = document.getElementById('timeline-title');
  if (tlTitle) tlTitle.textContent = `🕐 ${dayLabel}記錄`;
}

function changeDate(delta) {
  selectedDate.setDate(selectedDate.getDate() + delta);
  // 不能超過今天
  if (selectedDate > new Date()) selectedDate = new Date();
  updateDateDisplay();
  loadToday();
}

function goToday() {
  selectedDate = new Date();
  updateDateDisplay();
  loadToday();
}

function openQuickDatePicker() {
  const overlay = document.getElementById('date-picker-overlay');
  overlay.classList.remove('hidden');
  showMonthGrid();
}

function closeDatePicker(e) {
  if (e.target.id === 'date-picker-overlay') {
    e.target.classList.add('hidden');
  }
}
function closeDatePickerForce() {
  document.getElementById('date-picker-overlay').classList.add('hidden');
}

function showMonthGrid() {
  const body = document.getElementById('dp-body');
  const title = document.getElementById('dp-title');
  const now = new Date();
  const curYear = now.getFullYear();
  // 顯示最近 12 個月
  title.textContent = '選擇月份';
  let html = '<div class="dp-grid dp-month-grid">';
  for (let i = 0; i < 12; i++) {
    const d = new Date(curYear, now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const label = y === curYear ? `${m + 1}月` : `${y}/${m + 1}月`;
    const isCurrent = (selectedDate.getFullYear() === y && selectedDate.getMonth() === m);
    html += `<button class="dp-btn${isCurrent ? ' dp-active' : ''}" onclick="pickMonth(${y}, ${m})">${label}</button>`;
  }
  html += '</div>';
  body.innerHTML = html;
}

function pickMonth(year, month) {
  const title = document.getElementById('dp-title');
  const body = document.getElementById('dp-body');
  const now = new Date();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  title.textContent = `${year}/${month + 1}月 - 選擇日期`;

  let html = '<button class="dp-back" onclick="showMonthGrid()">◀ 返回月份</button>';
  html += '<div class="dp-grid dp-day-grid">';
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isFuture = date > now;
    const isSelected = (selectedDate.getFullYear() === year && selectedDate.getMonth() === month && selectedDate.getDate() === d);
    const isToday = (now.getFullYear() === year && now.getMonth() === month && now.getDate() === d);
    const cls = isFuture ? 'dp-btn dp-disabled' : `dp-btn${isSelected ? ' dp-active' : ''}${isToday ? ' dp-today' : ''}`;
    html += `<button class="${cls}" ${isFuture ? 'disabled' : `onclick="pickDay(${year}, ${month}, ${d})"`}>${d}</button>`;
  }
  html += '</div>';
  body.innerHTML = html;
}

function pickDay(year, month, day) {
  selectedDate = new Date(year, month, day);
  document.getElementById('date-picker-overlay').classList.add('hidden');
  updateDateDisplay();
  loadToday();
}

// ====== Init ======
function init() {
  updateTitle();
  updateDateDisplay();

  renderQuickActions();
  renderSummaryGrid();
  loadToday();
}

// ====== Settings ======
function openSettings() {
  const name = getBabyName() || '';
  const newName = prompt(`👶 設定寶寶名字\n\n目前: ${name || '（未設定）'}\n\n請輸入寶寶名字:`, name);
  if (newName !== null && newName.trim()) {
    setBabyName(newName);
    showToast(`✅ 已設定: ${newName.trim()}的作息表`);
  } else if (newName !== null && newName.trim() === '') {
    localStorage.removeItem('baby-name');
    updateTitle();
    showToast('✅ 已清除寶寶名字');
  }
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
  console.log('[loadToday] 查詢日期:', todayStr(), '工作表:', sheetNames);
  console.log('[loadToday] SCRIPT_URL:', SCRIPT_URL);
  const res = await apiCall({ action: 'getToday', date: todayStr(), sheets: sheetNames });
  console.log('[loadToday] API 回應:', JSON.stringify(res));
  if (res.debug) console.log('[loadToday] Debug:', JSON.stringify(res.debug));
  if (res.status === 'ok' && res.data) {
    todayData = res.data;
    // 暫存 debug 供除錯用
    window._lastDebug = res.debug || null;
    renderSummary();
    renderTimeline();
  } else {
    console.error('[loadToday] 讀取失敗:', res);
    showToast('⚠️ 載入失敗: ' + (res.message || JSON.stringify(res)));
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
        const endTime = r['結束時間'] || '';
        const dur = r['時長(分鐘)'] ? ` (${r['時長(分鐘)']}分鐘)` : '';
        const inProgress = !endTime;
        text = `${r['開始時間'] || ''} ~ ${endTime || '進行中'}${dur}`;
        items.push({ time, icon: t.icon, sheet: t.sheetName, text, note: r['備註'] || '', sleepInProgress: inProgress });
        return; // skip the push below
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
    const endBtn = item.sleepInProgress
      ? `<button class="tl-end-sleep" title="結束睡覺" data-time="${item.time}" style="background:#ff9800;color:#fff;border:none;border-radius:8px;padding:4px 10px;font-size:13px;cursor:pointer;white-space:nowrap">⏰ 結束</button>`
      : '';
    el.innerHTML = `
      <span class="tl-time">${item.time}</span>
      <span class="tl-icon">${item.icon}</span>
      <div class="tl-content">
        ${item.text}
        ${item.note ? `<br><small>${item.note}</small>` : ''}
      </div>
      ${endBtn}
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

  // 結束睡覺按鈕
  tl.querySelectorAll('.tl-end-sleep').forEach(btn => {
    btn.addEventListener('click', () => {
      openEndSleep(btn.dataset.time);
    });
  });
}

// ====== 結束睡覺彈窗 ======
function openEndSleep(startTime) {
  currentForm = '__end_sleep__';
  window._endSleepStartTime = startTime;

  const body = $('#form-body');
  const title = $('#form-title');
  const now = nowTime();

  title.textContent = '😴 結束睡覺';

  // 隱藏刪除按鈕
  const deleteBtn = document.getElementById('btn-delete-type');
  if (deleteBtn) deleteBtn.classList.add('hidden');

  body.innerHTML = `
    <div class="field">
      <label>開始時間</label>
      <input type="time" value="${startTime}" disabled style="opacity:0.6">
    </div>
    <div class="field">
      <label>結束時間</label>
      <input type="time" id="f-sleep-end-update" value="${now}">
    </div>
  `;

  // 改按鈕文字
  $('#btn-submit-text').textContent = '確認結束';
  $('#form-overlay').classList.remove('hidden');
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

  // 顯示/隱藏刪除按鈕（只有自訂類型才顯示）
  const deleteBtn = document.getElementById('btn-delete-type');
  if (deleteBtn) {
    const isCustom = t.id.startsWith('custom_');
    deleteBtn.classList.toggle('hidden', !isCustom);
  }

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
  $('#btn-submit-text').textContent = '記錄';
  currentForm = null;
}

async function submitForm() {
  const btn = $('#btn-submit');
  const textEl = $('#btn-submit-text');
  const loadEl = $('#btn-submit-loading');
  btn.disabled = true;
  textEl.classList.add('hidden');
  loadEl.classList.remove('hidden');

  // 處理結束睡覺
  if (currentForm === '__end_sleep__') {
    const endTime = $('#f-sleep-end-update').value;
    const startTime = window._endSleepStartTime;
    if (!endTime) { showToast('❌ 請輸入結束時間'); btn.disabled = false; textEl.classList.remove('hidden'); loadEl.classList.add('hidden'); return; }
    // 計算時長
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let dur = (eh * 60 + em) - (sh * 60 + sm);
    if (dur < 0) dur += 24 * 60;
    // 更新 Sheet：col 2=結束時間, col 3=時長
    const res = await apiCall({ action: 'update', sheet: '睡覺', date: todayStr(), time: startTime, updates: { '2': endTime, '3': dur } });
    btn.disabled = false;
    textEl.classList.remove('hidden');
    loadEl.classList.add('hidden');
    if (res.status === 'ok') {
      showToast('✅ 已更新睡覺結束時間！');
      closeForm();
      loadToday();
    } else {
      showToast('❌ ' + (res.message || '更新失敗'));
    }
    return;
  }

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

  // Custom types (no delete button here, delete from form instead)
  if (customs.length > 0) {
    html += customs.map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8f8f8;border-radius:10px;margin-bottom:6px">
        <span style="font-size:20px">${t.icon}</span>
        <span style="flex:1;font-weight:600">${t.label}</span>
        <span style="font-size:12px;color:#999">${FIELD_TEMPLATES[t.template]?.label || ''}</span>
        <span style="font-size:11px;color:#aaa">自訂</span>
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

function deleteCurrentType() {
  if (!currentForm || !currentForm.startsWith('custom_')) return;
  if (!confirm('確定要刪除此項目？刪除後無法復原。')) return;
  deleteCustomType(currentForm);
  closeForm();
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

// ====== Share ======
const SHARE_URL = 'https://ben741011-beep.github.io/baby-schedule/';

function openShare() {
  const overlay = document.getElementById('share-overlay');
  const qrImg = document.getElementById('share-qr-img');
  // 用免費 API 動態產生 QR code
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(SHARE_URL)}`;
  // 偵測是否支援 navigator.share
  const nativeBtn = document.getElementById('btn-native-share');
  if (nativeBtn) nativeBtn.style.display = navigator.share ? 'flex' : 'none';
  overlay.classList.remove('hidden');
}

function shareToLine() {
  const name = getBabyName();
  const text = `${name ? name + '的' : '寶寶'}作息表 📋\n記錄喝奶、睡覺、尿布等\n${SHARE_URL}`;
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank');
}

function copyShareLink() {
  navigator.clipboard.writeText(SHARE_URL).then(() => {
    showToast('✅ 已複製連結！');
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = SHARE_URL;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('✅ 已複製連結！');
  });
}

async function nativeShare() {
  if (!navigator.share) return;
  const name = getBabyName();
  try {
    await navigator.share({
      title: `${name ? name + '的' : '寶寶'}作息表`,
      text: '記錄寶寶喝奶、睡覺、尿布等',
      url: SHARE_URL,
    });
  } catch (e) {
    // user cancelled
  }
}

// ====== Start ======
checkSetup();
