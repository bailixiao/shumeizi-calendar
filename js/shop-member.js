// 植素園happy購的會員（規格 0.6.3，2026/11/4）：LINE／Google 登入、我的資料（姓名、手機、地址簿）。
//   #/shop/login?next=…  登入（送出訂單、看我的訂單前）
//   #/shop/me?next=…     我的資料（第一次登入先填姓名、手機）
// 登入憑證存在這支手機（180 天），每次呼叫團購的 API 由 api.js 帶上；驗證在 Worker（worker/src/member-auth.js）。
// LINE：LIFF（2026/11/4）。在 LINE 裡用 liff.line.me 的網址打開會直接登入；其他地方按「LINE 登入」轉到 LINE，
//   回來後 liff.init 處理（handleCallback），拿 LINE 簽好的 ID token 給 Worker 驗證（不需要 Channel secret）。
// Google：Google Identity Services 的按鈕。
// 在 LINE 內建的瀏覽器不能用 Google 登入（Google 的規定），只顯示 LINE 登入。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const KEY = 'zhisu-shop:member';
  const LINE_KEY = 'zhisu-shop:line-login';
  const cfg = window.SITE.shopLogin || {};
  const demo = !!(window.APP_CONFIG && window.APP_CONFIG.demoLogin);
  const enabled = !!window.SHOP_WEB && !!(cfg.googleClientId || cfg.liffId || demo);
  const inLine = /\bLine\//i.test(navigator.userAgent);
  const PROVIDER_LABEL = { LINE: 'LINE', Google: 'Google', 示範: '示範登入' };

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ } }
  };
  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 無痕模式 */ } }
  };

  let state = enabled ? ls.get(KEY) : null; // { token, member }
  if (state && !state.token) state = null;
  if (state) Api.setMemberToken(state.token);

  function save(s) {
    state = s;
    Api.setMemberToken(s ? s.token : '');
    ls.set(KEY, s);
  }
  const me = () => (state ? state.member : null);
  const loggedIn = () => !!state;

  /** 重新拿我的資料（憑證過期、會員不見了＝登出） */
  async function refresh() {
    if (!state) return null;
    try {
      const r = await Api.shopMe();
      save({ token: state.token, member: r.member });
    } catch (e) {
      if (e.code === 'LOGIN') save(null);
    }
    return me();
  }
  /** API 回「請先登入」：清掉這支手機的登入 */
  function onError(e) { if (e && e.code === 'LOGIN') save(null); }

  function go(hash) {
    if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = hash;
  }

  async function finish(payload, next) {
    Busy.show('登入中⋯');
    try {
      const r = await Api.shopLogin(payload);
      save({ token: r.token, member: r.member });
      Busy.hide();
      go(r.member.needProfile ? '#/shop/me?next=' + encodeURIComponent(next || '#/shop') : next || '#/shop');
    } catch (e) {
      Busy.hide();
      const box = document.querySelector('[data-login-error]');
      if (box) { box.textContent = e.message || '登入失敗，請再試一次'; box.hidden = false; } else alert(e.message || '登入失敗，請再試一次');
    }
  }

  // ---------- LINE（LIFF） ----------
  let liffReady = null;
  function loadLiff() {
    if (!liffReady) liffReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('LINE 登入載入失敗'));
      document.head.appendChild(s);
    }).then(() => window.liff.init({ liffId: cfg.liffId })).catch((e) => { liffReady = null; throw e; });
    return liffReady;
  }
  /** LIFF 已登入：拿 ID token 換我們的登入憑證 */
  async function liffFinish(next) {
    const idToken = window.liff.getIDToken();
    if (!idToken) return false;
    await finish({ provider: 'line', idToken }, next);
    if (state && !window.liff.isInClient()) { try { window.liff.logout(); } catch (e) { /* 下次重新拿新的 ID token */ } }
    return true;
  }

  /**
   * 打開網頁時：LINE 登入回來（網址帶 code、liffClientId）或從 liff.line.me 打開（帶 liff.state），
   * 先讓 LIFF 處理、換成登入憑證，網址清乾淨，回到原本的畫面。回傳 true＝已經換到別的畫面。
   */
  async function handleCallback() {
    if (!cfg.liffId) return false;
    const q = new URLSearchParams(location.search);
    const pending = ss.get(LINE_KEY);
    const fromLine = q.has('liffClientId') || q.has('liff.state') || (pending && q.has('code'));
    if (!fromLine && !(window.SHOP_WEB && /LIFF/i.test(navigator.userAgent))) return false;
    ss.set(LINE_KEY, null);
    const next = (pending && pending.next) || location.hash || '#/shop';
    try {
      await loadLiff();
    } catch (e) {
      return false;
    }
    if (location.search) history.replaceState(null, '', location.pathname + next);
    if (state || !window.liff.isLoggedIn()) return false; // 已經登入過、或按了取消
    return liffFinish(next);
  }

  async function lineLogin(next) {
    Busy.show('打開 LINE 登入⋯');
    try {
      await loadLiff();
    } catch (e) {
      Busy.hide();
      alert(e.message);
      return;
    }
    Busy.hide();
    if (window.liff.isLoggedIn()) { await liffFinish(next); return; }
    ss.set(LINE_KEY, { next });
    window.liff.login({ redirectUri: location.origin + location.pathname });
  }

  let gsi = null;
  function loadGsi() {
    if (!gsi) gsi = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gsi = null; reject(new Error('Google 登入載入失敗')); };
      document.head.appendChild(s);
    });
    return gsi;
  }

  /** 登入按鈕（LINE、Google、示範） */
  function loginBox(why) {
    return `<div class="shop-login" data-login>
      ${why ? `<p class="shop-login-why">${why}</p>` : ''}
      ${cfg.liffId ? '<button type="button" class="btn btn-block shop-login-line" data-login-line>LINE 登入</button>' : ''}
      ${cfg.googleClientId ? (inLine
        ? '<p class="hint">要用 Google 登入：按右上角「⋯」→「用預設瀏覽器開啟」，再登入。</p>'
        : '<div class="shop-login-google" data-login-google></div>') : ''}
      ${demo ? `<div class="shop-login-demo"><input class="input" data-demo-name maxlength="20" value="測試甲" aria-label="示範登入的名字"><button type="button" class="btn" data-login-demo>🧪 示範登入</button></div>` : ''}
      <p class="form-error" data-login-error hidden></p>
      <p class="hint">登入只用來記住你的收件資料、地址和訂單，不會在網頁上公開。</p>
    </div>`;
  }

  function bindLogin(el, next) {
    const box = el.querySelector('[data-login]');
    if (!box) return;
    const lb = box.querySelector('[data-login-line]');
    if (lb) lb.addEventListener('click', () => lineLogin(next));
    const db = box.querySelector('[data-login-demo]');
    if (db) db.addEventListener('click', () => finish({ provider: 'demo', name: box.querySelector('[data-demo-name]').value }, next));
    const gb = box.querySelector('[data-login-google]');
    if (gb) loadGsi().then(() => {
      window.google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (resp) => finish({ provider: 'google', credential: resp.credential }, next) });
      window.google.accounts.id.renderButton(gb, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: Math.min(gb.clientWidth || 320, 400) });
    }).catch((e) => { gb.innerHTML = `<p class="hint">${esc(e.message)}</p>`; });
  }

  /** #/shop/login */
  function renderLogin(root, next, tabbar) {
    root.innerHTML = `<div class="shop-page">
      <h1 class="page-title">👤 登入</h1>
      ${loginBox('登入之後就能送出訂單、看你所有的訂單，收件資料和地址也會幫你記起來，換手機一樣在。')}
      </div>${tabbar}`;
    bindLogin(root, next);
  }

  const addrRow = (a) => `<div class="shop-addr" data-addr="${esc(a.id || '')}">
    <div class="shop-two">
      <label><span>名稱</span><input class="input" data-k="label" maxlength="10" value="${esc(a.label || '')}" placeholder="例：家裡、公司"></label>
      <label class="check shop-addr-main"><input type="radio" name="addrMain"${a.main ? ' checked' : ''}> 預設</label>
    </div>
    <label><span>地址</span><input class="input" data-k="address" maxlength="120" autocomplete="street-address" value="${esc(a.address || '')}" placeholder="例：新竹市○○路○號○樓"></label>
    <div class="shop-two">
      <label><span>收件人（空白＝自己）</span><input class="input" data-k="name" maxlength="20" value="${esc(a.name || '')}"></label>
      <label><span>電話（空白＝自己的）</span><input class="input" data-k="phone" type="tel" inputmode="tel" maxlength="12" value="${esc(a.phone || '')}"></label>
    </div>
    <button type="button" class="btn btn-small btn-quiet-danger" data-del-addr>刪除這個地址</button>
  </div>`;

  /** #/shop/me：我的資料（第一次登入先填姓名、手機） */
  async function renderProfile(root, next, tabbar, flash) {
    if (!state) return renderLogin(root, '#/shop/me', tabbar);
    if (!flash) await refresh();
    const m = me();
    if (!m) return renderLogin(root, '#/shop/me', tabbar);
    root.innerHTML = `<div class="shop-page">
      <h1 class="page-title">👤 我的資料</h1>
      ${flash || ''}
      ${m.needProfile ? '<div class="notice"><p>👋 第一次登入，先填你的名字和手機，之後結帳會自動帶入。</p></div>' : ''}
      <form class="shop-profile" novalidate>
        <label class="form-row"><span>名字</span><input class="input" name="name" maxlength="20" autocomplete="name" value="${esc(m.name || m.displayName || '')}" placeholder="例：王小明"></label>
        <label class="form-row"><span>手機</span><input class="input" name="phone" type="tel" inputmode="tel" maxlength="12" autocomplete="tel" value="${esc(m.phone)}" placeholder="例：0912345678"></label>
        <p class="hint">手機只給小編聯絡用，網頁上不會顯示。以前用這支手機在這裡下的單，會自動接過來。</p>
        <h2 class="shop-profile-sub">🚚 宅配地址</h2>
        <div data-addrs>${m.addresses.map(addrRow).join('')}</div>
        <button type="button" class="btn btn-small" data-add-addr>＋ 新增地址</button>
        <p class="form-error" data-error hidden></p>
        <button type="submit" class="btn btn-block btn-primary">${m.needProfile ? '存好，繼續' : '儲存'}</button>
      </form>
      <p class="muted shop-profile-who">用 ${esc(PROVIDER_LABEL[m.provider] || m.provider)} 登入${m.displayName ? '（' + esc(m.displayName) + '）' : ''}・<button type="button" class="link-btn" data-logout>登出</button></p>
      </div>${tabbar}`;
    const f = root.querySelector('form');
    const list = f.querySelector('[data-addrs]');
    f.querySelector('[data-add-addr]').addEventListener('click', () => {
      if (list.children.length >= 10) return;
      list.insertAdjacentHTML('beforeend', addrRow({ main: !list.children.length }));
      list.lastElementChild.querySelector('[data-k=label]').focus();
    });
    list.addEventListener('click', (ev) => { const b = ev.target.closest('[data-del-addr]'); if (b) b.closest('[data-addr]').remove(); });
    root.querySelector('[data-logout]').addEventListener('click', () => { save(null); go('#/shop'); });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = f.querySelector('[data-error]');
      box.hidden = true;
      const addresses = [...list.querySelectorAll('[data-addr]')].map((x) => ({
        id: x.dataset.addr, label: x.querySelector('[data-k=label]').value.trim(), address: x.querySelector('[data-k=address]').value.trim(),
        name: x.querySelector('[data-k=name]').value.trim(), phone: x.querySelector('[data-k=phone]').value.trim(), main: x.querySelector('input[name=addrMain]').checked
      })).filter((a) => a.address);
      Busy.show('儲存中⋯');
      try {
        const r = await Api.shopSaveProfile({ name: f.elements.name.value, phone: f.elements.phone.value, addresses });
        save({ token: state.token, member: r.member });
        Busy.hide();
        const note = r.linked ? `<div class="notice notice-success" role="status"><p>✅ 存好了！以前的 ${r.linked} 張訂單也接過來了。</p></div>` : '<div class="notice notice-success" role="status"><p>✅ 存好了！</p></div>';
        if (next) go(next);
        else renderProfile(root, '', tabbar, note);
      } catch (e) {
        Busy.hide();
        onError(e);
        box.innerHTML = `<strong>${esc(e.message || '沒有存好')}</strong>${(e.details || []).map((d) => '<br>' + esc(d.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  /** 結帳後把新地址加進地址簿 */
  async function addAddress(a) {
    const m = me();
    if (!m || m.addresses.length >= 10 || m.addresses.some((x) => x.address === a.address)) return;
    try {
      const r = await Api.shopSaveProfile({ name: m.name, phone: m.phone, addresses: m.addresses.concat([Object.assign({ main: !m.addresses.length }, a)]) });
      save({ token: state.token, member: r.member });
    } catch (e) { onError(e); }
  }

  window.ShopMember = { enabled, me, loggedIn, refresh, onError, handleCallback, loginBox, bindLogin, renderLogin, renderProfile, addAddress };
})();
