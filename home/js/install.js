// 「📲 把書槑子加到手機主畫面」（2026/10/14，規格：官網＋行事曆合成一個 App）
//   公開官網：連到 App 版（行事曆網站的 home/?install=1），在那裡加，才和行事曆、推播是同一個 App。
//   App 版：已經從主畫面打開就藏起來；在瀏覽器裡就跳出說明（Android 可以直接按按鈕安裝）。
(function () {
  'use strict';
  var CFG = window.SITE_CONFIG || {};
  if (!CFG.APP) return;
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-install]'));
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (standalone) { links.forEach(function (a) { a.hidden = true; }); return; }

  var deferred = null; // Android Chrome：可以直接跳出安裝視窗
  window.addEventListener('beforeinstallprompt', function (ev) { ev.preventDefault(); deferred = ev; });

  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var android = /Android/.test(ua);
  var inApp = /Line\/|FBAN|FBAV|Instagram/.test(ua); // LINE、FB、IG 裡面的瀏覽器不能加到主畫面

  function steps() {
    if (inApp) return '<p><strong>先換用' + (ios ? ' Safari ' : ' Chrome ') + '打開這一頁</strong>（在 LINE、FB、IG 裡面沒辦法加）：按右上或右下的「⋯」→「用' + (ios ? ' Safari ' : '瀏覽器') + '開啟」，再按一次「📲 把書槑子加到手機主畫面」。</p>';
    if (ios) return '<ol><li>按 Safari 下面的「<strong>分享</strong>」（方框加箭頭）<br><span class="muted">新版 iPhone：先按網址旁邊的「⋯」→「分享」</span></li><li>往下找「<strong>加入主畫面</strong>」</li><li>按右上角「<strong>新增</strong>」</li></ol>';
    if (android) return deferred
      ? '<p><button type="button" class="btn btn-primary" data-install-go>📲 加到主畫面</button></p>'
      : '<ol><li>按 Chrome 右上角的「<strong>⋮</strong>」</li><li>選「<strong>加到主畫面</strong>」或「<strong>安裝應用程式</strong>」</li><li>按「<strong>新增</strong>」／「<strong>安裝</strong>」</li></ol>';
    return '<p>請用<strong>手機</strong>打開這個網址再加：<br><code>' + location.origin + location.pathname.replace(/[^/]*$/, '') + '</code></p>';
  }

  function show() {
    var box = document.createElement('div');
    box.className = 'install-modal';
    box.innerHTML = '<div class="install-card" role="dialog" aria-modal="true" aria-labelledby="install-title">' +
      '<h2 id="install-title">📲 把書槑子加到手機主畫面</h2>' +
      '<p>加了以後，手機桌面會多一個「<strong>書槑子青年坊</strong>」，點一下就打開官網，活動行事曆、報名、團購都在裡面；也能收到活動提醒 🔔</p>' +
      steps() +
      '<p class="muted"><a href="../#/help/faq-home-which">看圖解教學 ›</a></p>' +
      '<p><button type="button" class="btn" data-install-close>知道了</button></p></div>';
    document.body.appendChild(box);
    var close = function () { box.remove(); };
    box.addEventListener('click', function (ev) {
      if (ev.target === box || ev.target.closest('[data-install-close]')) close();
      if (ev.target.closest('[data-install-go]') && deferred) { deferred.prompt(); deferred = null; close(); }
    });
    document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  links.forEach(function (a) {
    a.href = './?install=1';
    a.addEventListener('click', function (ev) { ev.preventDefault(); show(); });
  });
  if (/[?&]install=1/.test(location.search)) setTimeout(show, 600);
})();
