// 植素園happy購：只有團購（js/shop.js 的網頁模式）。網址 #/shop…，其他的都回商城。
(function () {
  'use strict';

  /** 處理中遮罩（和行事曆 app.js 一樣） */
  window.Busy = {
    show(text, sub) {
      const el = document.getElementById('busy');
      el.querySelector('.busy-text').textContent = text;
      el.querySelector('.busy-sub').textContent = sub || '';
      el.hidden = false;
      document.querySelector('.app-main').inert = true;
    },
    hide() {
      document.getElementById('busy').hidden = true;
      document.querySelector('.app-main').inert = false;
    }
  };

  function route() {
    const m = location.hash.match(/^#\/shop\/?(.*)$/);
    if (!m) { location.replace('#/shop'); return; }
    ShopPage.show(m[1]);
  }
  window.addEventListener('hashchange', route);
  // LINE 登入回來（?code=&state=）先處理，再顯示畫面
  (window.ShopMember ? ShopMember.handleCallback().catch(() => false) : Promise.resolve(false)).then((done) => { if (!done) route(); });
})();
