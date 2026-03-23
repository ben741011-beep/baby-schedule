/**
 * 寶寶作息表 — Google Apps Script
 * 
 * 使用步驟：
 * 1. 開啟你的 Google Sheet
 * 2. 選單 → 擴充功能 → Apps Script
 * 3. 把這段程式碼貼進去（取代原本的 function myFunction）
 * 4. 點「部署」→「新增部署」→ 類型選「網頁應用程式」
 *    - 執行身份：我自己
 *    - 存取權：所有人
 * 5. 點「部署」，複製那個 URL
 * 6. 把 URL 貼到網頁 app.js 裡的 SCRIPT_URL 變數
 * 
 * Sheet 需要有以下工作表 (會自動建立):
 *   - 「餵奶」: 日期 | 時間 | 類型(母奶/配方奶) | 奶量(ml) | 備註
 *   - 「睡覺」: 日期 | 開始時間 | 結束時間 | 時長(分鐘) | 備註
 *   - 「換尿布」: 日期 | 時間 | 類型(大便/小便/兩者) | 備註
 *   - 「體溫」: 日期 | 時間 | 體溫(°C) | 備註
 */

// ====== 處理 POST 請求 ======
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = data.action;

    if (action === 'add') {
      const sheet = getOrCreateSheet(ss, data.sheet, data.headers);
      sheet.appendRow(data.row);
      return jsonResponse({ status: 'ok', message: '已記錄！' });
    }

    if (action === 'getToday') {
      const result = {};
      const debug = {};
      // Accept dynamic sheet names from client
      const sheets = data.sheets || ['餵奶', '睡覺', '換尿布', '體溫', '擠奶'];
      const today = data.date || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

      sheets.forEach(name => {
        const sheet = ss.getSheetByName(name);
        if (!sheet) { result[name] = []; debug[name] = 'sheet not found'; return; }
        const allData = sheet.getDataRange().getValues();
        if (allData.length <= 1) { result[name] = []; debug[name] = 'no data rows'; return; }
        const headers = allData[0];
        // Debug: show raw first data row info
        const firstRow = allData[1];
        const rawDate = firstRow[0];
        let dateType = typeof rawDate;
        let dateStr = '';
        if (rawDate instanceof Date) {
          dateType = 'Date';
          dateStr = Utilities.formatDate(rawDate, 'Asia/Taipei', 'yyyy-MM-dd');
        } else {
          dateStr = String(rawDate);
        }
        debug[name] = { rowCount: allData.length - 1, rawDateType: dateType, rawDateStr: dateStr, compareTo: today, match: dateStr === today };

        const rows = allData.slice(1).filter(row => {
          const d = row[0];
          if (d instanceof Date) {
            return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd') === today;
          }
          return String(d) === today;
        });
        result[name] = rows.map(row => {
          const obj = {};
          headers.forEach((h, i) => obj[h] = row[i] instanceof Date ? Utilities.formatDate(row[i], 'Asia/Taipei', 'HH:mm') : row[i]);
          return obj;
        });
      });

      return jsonResponse({ status: 'ok', data: result, debug: debug });
    }

    if (action === 'update') {
      const sheet = ss.getSheetByName(data.sheet);
      if (sheet) {
        const allData = sheet.getDataRange().getValues();
        for (let i = allData.length - 1; i >= 1; i--) {
          const d = allData[i][0];
          const dateStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd') : String(d);
          const timeStr = allData[i][1] instanceof Date ? Utilities.formatDate(allData[i][1], 'Asia/Taipei', 'HH:mm') : String(allData[i][1]);
          if (dateStr === data.date && timeStr === data.time) {
            // Update specific columns
            if (data.updates) {
              Object.entries(data.updates).forEach(([colIdx, val]) => {
                sheet.getRange(i + 1, parseInt(colIdx) + 1).setValue(val);
              });
            }
            break;
          }
        }
      }
      return jsonResponse({ status: 'ok', message: '已更新！' });
    }

    if (action === 'delete') {
      const sheet = ss.getSheetByName(data.sheet);
      if (sheet) {
        const allData = sheet.getDataRange().getValues();
        // 從後往前刪，避免 index 偏移
        for (let i = allData.length - 1; i >= 1; i--) {
          const d = allData[i][0];
          const dateStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd') : String(d);
          const timeStr = allData[i][1] instanceof Date ? Utilities.formatDate(allData[i][1], 'Asia/Taipei', 'HH:mm') : String(allData[i][1]);
          if (dateStr === data.date && timeStr === data.time) {
            sheet.deleteRow(i + 1);
            break;
          }
        }
      }
      return jsonResponse({ status: 'ok', message: '已刪除！' });
    }

    return jsonResponse({ status: 'error', message: '未知操作' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

// ====== 處理 GET 請求（測試用）======
function doGet(e) {
  return jsonResponse({ status: 'ok', message: '寶寶作息表 API 運作中！' });
}

// ====== 工具函式 ======
function getOrCreateSheet(ss, name, customHeaders) {
  const defaultHeaders = {
    '餵奶': ['日期', '時間', '類型', '奶量(ml)', '備註'],
    '睡覺': ['日期', '開始時間', '結束時間', '時長(分鐘)', '備註'],
    '換尿布': ['日期', '時間', '類型', '備註'],
    '體溫': ['日期', '時間', '體溫(°C)', '備註'],
    '擠奶': ['日期', '時間', '側別', '奶量(ml)', '備註'],
  };
  const h = customHeaders || defaultHeaders[name];

  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (h) {
      sheet.getRange(1, 1, 1, h.length).setValues([h]);
      sheet.getRange(1, 1, 1, h.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  } else if (h) {
    // 自動修復：若現有表頭欄數不對，覆蓋為正確表頭
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (existing.length !== h.length || existing.join(',') !== h.join(',')) {
      sheet.getRange(1, 1, 1, h.length).setValues([h]);
      sheet.getRange(1, 1, 1, h.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
