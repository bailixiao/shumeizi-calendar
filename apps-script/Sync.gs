/**
 * 搬家到 Cloudflare 與之後的同步（規格第 3 節）。
 *   - exportToWorker：把試算表的資料（和指令碼屬性）整個複製到 Cloudflare。測試期間可以重複執行（會覆蓋 Cloudflare 上的測試資料）。
 *   - switchToWorker：正式切換。再複製一次最新資料、讓 Cloudflare 開始送推播、這裡停止接受寫入（舊網頁按報名會請他重新整理）、
 *     刪掉這裡的推播與保溫排程、建立每 10 分鐘的同步排程。
 *   - syncFromWorker：（排程）向 Cloudflare 拿最新資料寫回試算表，並更新「統計」分頁。試算表從此是副本，改資料請用管理後台。
 *   - switchBackToGoogle：緊急退回 Google 版。
 *   驗證用同步密鑰 SYNC_KEY（第一次同步時用管理密碼自動產生、兩邊各存一份，不寫進程式碼）。
 *   總管理者密碼在後台改（只改 Cloudflare 那邊），所以 ADMIN_PASSWORD 不從這裡複製過去，免得被舊的蓋回去。
 */

var WORKER_URL = 'https://shumeizi-api.duty-calendar-worker.workers.dev/';
var SYNC_SKIP_PROPS = ['BACKUP_FOLDER_ID', 'BACKUP_LAST', 'MIGRATED', 'NEW_ADMIN_PASSWORD', 'SYNC_KEY', 'ADMIN_CURRENT_TOKEN', 'LEDGER_SHEET_ID', 'LEDGER_HELP_VERSION'];

function syncSheetDefs_() {
  // 帳號只存在 Cloudflare（含密碼雜湊），不在兩邊之間複製，避免覆蓋
  return Object.keys(SHEETS).map(function (k) { return SHEETS[k]; }).filter(function (d) { return d.headers.length && d !== SHEETS.ACCOUNTS; });
}

function workerPost_(payload) {
  var resp = UrlFetchApp.fetch(WORKER_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var json;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { throw new Error('Cloudflare 回應不正確（' + resp.getResponseCode() + '）'); }
  if (!json.ok) throw new Error('Cloudflare：' + json.error.message);
  return json.data;
}

/**
 * 同步密鑰：這裡還沒有就自動產生一組，用管理密碼交給 Cloudflare 存起來（只有第一次需要管理密碼對得上）。
 */
function syncKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (key) return key;
  key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  try {
    workerPost_({ action: 'setSyncKey', password: props.getProperty('ADMIN_PASSWORD'), key: key });
  } catch (e) {
    if (/密碼/.test(String(e.message))) {
      throw new Error('同步密鑰設定失敗：指令碼屬性的 ADMIN_PASSWORD 和現在後台登入用的總管理者密碼不一樣。' +
        '請到「專案設定 → 指令碼屬性」把 ADMIN_PASSWORD 改成現在後台登入用的密碼，再執行一次 setupLedgerSheet（只要第一次，之後同步就不用密碼了）。');
    }
    throw e;
  }
  props.setProperty('SYNC_KEY', key);
  return key;
}

/** 複製試算表資料到 Cloudflare（live = true 時 Cloudflare 開始負責推播） */
function exportToWorker(live) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = {};
  syncSheetDefs_().forEach(function (def) {
    var sh = ss.getSheetByName(def.name);
    if (!sh || sh.getLastRow() === 0) return;
    sheets[def.name] = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  });
  var all = PropertiesService.getScriptProperties().getProperties();
  var props = {};
  Object.keys(all).forEach(function (k) { if (SYNC_SKIP_PROPS.indexOf(k) === -1) props[k] = all[k]; });
  // 管理密碼已經在 Cloudflare 的話以那邊為準（後台改過密碼），不要蓋回舊的
  if (props.ADMIN_PASSWORD && PropertiesService.getScriptProperties().getProperty('SYNC_KEY')) delete props.ADMIN_PASSWORD;
  var res = workerPost_({ action: 'import', password: syncKey_(), sheets: sheets, props: props, live: live === true ? true : undefined });
  Logger.log('已複製到 Cloudflare：' + Object.keys(res.sheets).map(function (n) { return n + ' ' + res.sheets[n] + ' 列'; }).join('、') +
    (res.live ? '（已正式切換，Cloudflare 負責推播）' : '（測試中）'));
  return res;
}

/**
 * （備用）改總管理者密碼。平常請用後台「帳號 → 🔑 改總管理者密碼」。忘記密碼進不了後台時才用這個：
 *   1. 專案設定 → 指令碼屬性 → 新增 NEW_ADMIN_PASSWORD＝新密碼（至少 8 個字）
 *   2. 在編輯器選 changeAdminPassword 按「執行」
 * 改好後 ADMIN_PASSWORD 換成新的、NEW_ADMIN_PASSWORD 自動刪掉；所有後台登入要重新登入。
 */
function changeAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  var next = String(props.getProperty('NEW_ADMIN_PASSWORD') || '').trim();
  if (next.length < 8) throw new Error('請先在「專案設定 → 指令碼屬性」新增 NEW_ADMIN_PASSWORD（新密碼，至少 8 個字），再執行一次');
  var old = props.getProperty('ADMIN_PASSWORD');
  if (next === old) throw new Error('新密碼和原本的一樣');
  // 先改 Cloudflare（用舊密碼驗證、只改設定、不動資料），成功了才改這裡
  workerPost_({ action: 'import', password: syncKey_(), sheets: {}, props: { ADMIN_PASSWORD: next } });
  props.setProperty('ADMIN_PASSWORD', next);
  props.deleteProperty('NEW_ADMIN_PASSWORD');
  Logger.log('總管理者密碼改好了（Google、Cloudflare 都換成新的）。後台請用新密碼重新登入。');
}

/** 正式切換到 Cloudflare（前端網址同時改成 Cloudflare） */
function switchToWorker() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('MIGRATED', '1'); // 先停止這裡的寫入，再複製最後一次，避免漏掉
  exportToWorker(true);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['sendPushToday', 'sendPushTomorrow', 'keepWarm', 'syncFromWorker'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncFromWorker').timeBased().everyMinutes(10).create();
  Logger.log('已切換到 Cloudflare：試算表每 10 分鐘自動同步，改資料請用管理後台。');
}

/** （排程，每 10 分鐘）Cloudflare → 試算表 */
function syncFromWorker() {
  var props = PropertiesService.getScriptProperties();
  var data = workerPost_({ action: 'syncExport', password: syncKey_(), statsUpdatedAt: props.getProperty('STATS_UPDATED_AT') || '' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(data.sheets).forEach(function (name) {
    var rows = data.sheets[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
    var padded = rows.map(function (r) { var c = r.slice(); while (c.length < width) c.push(''); return c; });
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    if (sh.getMaxRows() < padded.length) sh.insertRowsAfter(sh.getMaxRows(), padded.length - sh.getMaxRows());
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(width, sh.getLastColumn() || 1)).clearContent();
    if (padded.length) {
      var range = sh.getRange(1, 1, padded.length, width);
      range.setNumberFormat('@');
      range.setValues(padded);
    }
  });
  SpreadsheetApp.flush();
  invalidateAllTables_();
  writeStatsSheet_(Number(todayString_().slice(0, 4)));
  ledgerSheetSync_(); // 植素園記帳 Google 試算表（LedgerSheet.gs）
}

/** 緊急退回 Google 版：先把 Cloudflare 的最新資料寫回試算表，再恢復這裡的寫入與排程（前端網址也要改回 Google） */
function switchBackToGoogle() {
  syncFromWorker();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('MIGRATED');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncFromWorker') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendPushToday').timeBased().everyDays(1).atHour(PUSH_HOURS.today).create();
  ScriptApp.newTrigger('sendPushTomorrow').timeBased().everyDays(1).atHour(PUSH_HOURS.tomorrow).create();
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  try { workerPost_({ action: 'import', password: syncKey_(), sheets: {}, live: false }); } catch (e) { /* Cloudflare 連不上也沒關係 */ }
  Logger.log('已退回 Google 版。');
}
