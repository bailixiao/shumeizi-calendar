// 前端只放 API 網址，不放任何資料（規格第 3 節）。
// 搬家測試期間：網址加 ?api=cf 改用 Cloudflare 版（這台瀏覽器會記住），?api=gas 改回 Google 版。
(function () {
  const GAS = ''; // Google 版（備援）網址：階段 4 建好 Apps Script 後填入
  const CF = 'https://shumeizi-api.duty-calendar-worker.workers.dev/';
  const DEFAULT = 'cf'; // 2026/10/3 正式切換到 Cloudflare；緊急退回 Google 時改成 'gas'
  let choice = DEFAULT;
  try {
    const m = location.search.match(/[?&]api=(cf|gas)\b/);
    if (m) localStorage.setItem('shumeizi:api', m[1]);
    choice = localStorage.getItem('shumeizi:api') || DEFAULT;
  } catch (e) { /* 無痕模式等：用預設 */ }
  window.APP_CONFIG = { API_URL: choice === 'cf' ? CF : GAS, API_NAME: choice, TEST: choice !== DEFAULT };
})();
