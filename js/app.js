/* ===================================================================
   寶寶作息表 — 記錄寶寶喝奶、睡覺、換尿布、體溫
   資料串接 Google Sheet (via Apps Script)
   =================================================================== */

// ====== Config ======
let SCRIPT_URL = localStorage.getItem('baby-schedule-url') || '';

const $ = s => document.querySelector(s);

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
      headers: { 'Content-Type': 'text/plain' }, // avoid CORS preflight
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
let todayData = { '餵奶': [], '睡覺': [], '換尿布': [], '體溫': [] };

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
  // Show today's date
  const d = new Date();
  const weekdays = ['日','一','二','三','四','五','六'];
  $('#today-date').textContent = `${d.getMonth()+1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;

  loadToday();
}

// ====== Load Today's Data ======
async function loadToday() {
  const res = await apiCall({ action: 'getToday', date: todayStr() });
  if (res.status === 'ok' && res.data) {
    todayData = res.data;
    renderSummary();
    renderTimeline();
  }
}

// ====== Render Summary ======
function renderSummary() {
  const milkCount = (todayData['餵奶'] || []).length;
  const sleepCount = (todayData['睡覺'] || []).length;
  const diaperCount = (todayData['換尿布'] || []).length;
  const totalMl = (todayData['餵奶'] || []).reduce((sum, r) => sum + (parseInt(r['奶量(ml)']) || 0), 0);

  $('#sum-milk').textContent = milkCount;
  $('#sum-sleep').textContent = sleepCount;
  $('#sum-diaper').textContent = diaperCount;
  $('#sum-total-ml').textContent = totalMl;
}

// ====== Render Timeline ======
function renderTimeline() {
  const tl = $('#timeline');
  const empty = $('#timeline-empty');
  tl.innerHTML = '';

  const items = [];

  (todayData['餵奶'] || []).forEach(r => {
    items.push({
      time: r['時間'] || '',
      icon: '🍼',
      sheet: '餵奶',
      text: `${r['類型'] || '母奶'} ${r['奶量(ml)'] || ''}ml`,
      note: r['備註'] || '',
    });
  });

  (todayData['睡覺'] || []).forEach(r => {
    const dur = r['時長(分鐘)'] ? ` (${r['時長(分鐘)']}分鐘)` : '';
    items.push({
      time: r['開始時間'] || '',
      icon: '😴',
      sheet: '睡覺',
      text: `${r['開始時間'] || ''} ~ ${r['結束時間'] || '進行中'}${dur}`,
      note: r['備註'] || '',
    });
  });

  (todayData['換尿布'] || []).forEach(r => {
    items.push({
      time: r['時間'] || '',
      icon: '🧷',
      sheet: '換尿布',
      text: r['類型'] || '',
      note: r['備註'] || '',
    });
  });

  (todayData['體溫'] || []).forEach(r => {
    const temp = parseFloat(r['體溫(°C)']) || 0;
    const warn = temp >= 37.5 ? ' ⚠️' : '';
    items.push({
      time: r['時間'] || '',
      icon: '🌡️',
      sheet: '體溫',
      text: `${r['體溫(°C)']}°C${warn}`,
      note: r['備註'] || '',
    });
  });

  // Sort by time descending (newest first)
  items.sort((a, b) => b.time.localeCompare(a.time));

  if (items.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
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

  // Delete handlers
  tl.querySelectorAll('.tl-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除這筆記錄？')) return;
      const sheet = btn.dataset.sheet;
      const time = btn.dataset.time;
      await apiCall({ action: 'delete', sheet, date: todayStr(), time });
      showToast('🗑️ 已刪除');
      loadToday();
    });
  });
}

// ====== Forms ======
function openForm(type) {
  currentForm = type;
  const body = $('#form-body');
  const title = $('#form-title');
  const overlay = $('#form-overlay');

  const now = nowTime();

  if (type === 'milk') {
    title.textContent = '🍼 記錄喝奶';
    body.innerHTML = `
      <div class="field">
        <label>時間</label>
        <input type="time" id="f-time" value="${now}">
      </div>
      <div class="field">
        <label>類型</label>
        <div class="radio-group" id="f-milk-type">
          <div class="radio-option selected" data-val="母奶">🤱 母奶</div>
          <div class="radio-option" data-val="配方奶">🍼 配方奶</div>
        </div>
      </div>
      <div class="field">
        <label>奶量 (ml)</label>
        <input type="number" id="f-ml" placeholder="例：120" inputmode="numeric">
      </div>
      <div class="field">
        <label>備註</label>
        <input type="text" id="f-note" placeholder="選填">
      </div>
    `;
  } else if (type === 'sleep') {
    title.textContent = '😴 記錄睡覺';
    body.innerHTML = `
      <div class="field">
        <label>開始時間</label>
        <input type="time" id="f-sleep-start" value="${now}">
      </div>
      <div class="field">
        <label>結束時間（還在睡可留空）</label>
        <input type="time" id="f-sleep-end">
      </div>
      <div class="field">
        <label>備註</label>
        <input type="text" id="f-note" placeholder="選填">
      </div>
    `;
  } else if (type === 'diaper') {
    title.textContent = '🧷 記錄換尿布';
    body.innerHTML = `
      <div class="field">
        <label>時間</label>
        <input type="time" id="f-time" value="${now}">
      </div>
      <div class="field">
        <label>類型</label>
        <div class="radio-group" id="f-diaper-type">
          <div class="radio-option" data-val="小便">💧 小便</div>
          <div class="radio-option" data-val="大便">💩 大便</div>
          <div class="radio-option selected" data-val="兩者">💧💩 兩者</div>
        </div>
      </div>
      <div class="field">
        <label>備註</label>
        <input type="text" id="f-note" placeholder="選填">
      </div>
    `;
  } else if (type === 'temp') {
    title.textContent = '🌡️ 記錄體溫';
    body.innerHTML = `
      <div class="field">
        <label>時間</label>
        <input type="time" id="f-time" value="${now}">
      </div>
      <div class="field">
        <label>體溫 (°C)</label>
        <input type="number" id="f-temp" step="0.1" placeholder="例：36.8" inputmode="decimal">
      </div>
      <div class="field">
        <label>備註</label>
        <input type="text" id="f-note" placeholder="選填">
      </div>
    `;
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
  const note = ($('#f-note') && $('#f-note').value.trim()) || '';
  let sheetName, row;

  if (currentForm === 'milk') {
    const time = $('#f-time').value;
    const type = document.querySelector('#f-milk-type .selected')?.dataset.val || '母奶';
    const ml = $('#f-ml').value || '0';
    sheetName = '餵奶';
    row = [today, time, type, parseInt(ml), note];
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
    sheetName = '睡覺';
    row = [today, start, end, dur, note];
  } else if (currentForm === 'diaper') {
    const time = $('#f-time').value;
    const type = document.querySelector('#f-diaper-type .selected')?.dataset.val || '小便';
    sheetName = '換尿布';
    row = [today, time, type, note];
  } else if (currentForm === 'temp') {
    const time = $('#f-time').value;
    const temp = $('#f-temp').value || '36.5';
    sheetName = '體溫';
    row = [today, time, parseFloat(temp), note];
  }

  const res = await apiCall({ action: 'add', sheet: sheetName, row });

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
