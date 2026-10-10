// 大家的團購（#/shop、#/shop/<團購ID>，規格 0.6）：商品卡片（縮圖點了放大）、＋／－選數量、選取貨場次、填名字、付款方式、即時算金額。
// 同一個人同一次團購只有一張訂單：打了名字會先找他原本的訂單帶進來，再送出＝修改。規則都在伺服器（apps-script/Shop.gs）。
// 另外提供：行事曆上方的「🛒 團購」按鈕（有開放中的團購才出現）、活動頁「這場可以取團購」、查我的報名的「🛒 我的團購」。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const NAME_KEY = 'shumeizi:mine-name'; // 和查我的報名同一個（記住這支手機的人）
  const SOURCES = window.SITE.sources || [];
  const SOURCE_ICON = { 朋友介紹: '👫', '官方 LINE': '💬', 官網: '🌐', Instagram: '📷', Facebook: '📘', 其他: '✨', 不確定: '🤔' };
  let shopCache = null; // { at, data }
  let root = null;
  let token = 0;
  const form = { groupId: '', qty: {}, pickupId: '', pay: '現場', last5: '', name: '', known: undefined, source: '', referrer: '', sourceNote: '', existing: null };

  const money = (n) => `${Number(n || 0).toLocaleString('zh-TW')} 元`;
  const pickupText = (p) => `${Fmt.shortDate(p.date)}${p.startTime ? ' ' + p.startTime : ''}　${p.location || p.name}`;

  function savedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } }
  function saveName(n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 無痕模式 */ } }

  /** 開放中的團購（30 秒內讀過的直接用） */
  async function loadShop(force) {
    if (!force && shopCache && Date.now() - shopCache.at < 30000) return shopCache.data;
    const data = await Api.getShop();
    shopCache = { at: Date.now(), data };
    return data;
  }

  /** 行事曆上方的「🛒 團購」：有還沒截止的團購才出現 */
  async function checkButton() {
    const btn = document.getElementById('shop-link');
    if (!btn || !Fmt.feature('shop')) return;
    try {
      const data = await loadShop();
      const open = data.groups.filter((g) => !g.closed);
      btn.hidden = !open.length;
      if (open.length) btn.textContent = open.length === 1 ? `🛒 團購：${open[0].name}` : `🛒 團購（${open.length}）`;
    } catch (e) { /* 讀不到就不顯示 */ }
  }

  /** 活動頁：這場是某個團購的取貨場次 → 寫「這場可以取團購」 */
  async function dutyNote(el, dutyId) {
    if (!el || !Fmt.feature('shop')) return;
    try {
      const data = await loadShop();
      const list = data.groups.filter((g) => g.pickups.some((p) => p.id === dutyId));
      el.innerHTML = list.map((g) => `<a class="notice shop-duty-note" href="#/shop/${encodeURIComponent(g.id)}"><strong>🛒 這場可以取團購：${esc(g.name)}</strong><span>${g.closed ? '已經截止了，看看就好' : `${esc(g.deadline)} 截止，點我下單`} ›</span></a>`).join('');
    } catch (e) { /* 讀不到就不顯示 */ }
  }

  // ---------- 團購頁 ----------

  async function show(groupId) {
    root = document.getElementById('view-shop');
    const t = ++token;
    root.innerHTML = '<h1 class="page-title">🛒 團購</h1><p class="panel-empty">讀取中⋯</p>';
    let data;
    try { data = await loadShop(true); } catch (err) {
      if (t !== token) return;
      root.innerHTML = `<h1 class="page-title">🛒 團購</h1><div class="notice notice-error" role="alert"><p>${esc(err.message || '讀取失敗，請稍後再試')}</p></div>${back()}`;
      return;
    }
    if (t !== token) return;
    const g = groupId ? data.groups.find((x) => x.id === groupId) : (data.groups.length === 1 ? data.groups[0] : null);
    if (!g) return renderList(data, groupId);
    if (g.link) return renderLinkGroup(g, data.now); // 賣貨便：只放按鈕連過去
    if (form.groupId !== g.id) Object.assign(form, { groupId: g.id, qty: {}, pickupId: g.pickups.length === 1 ? g.pickups[0].id : '', pay: '現場', last5: '', existing: null });
    if (!form.name) form.name = savedName();
    renderGroup(g, data.now);
    if (form.name && form.existing === null) lookupName(g);
  }

  function back() {
    return '<a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>';
  }

  function renderList(data, missing) {
    root.innerHTML = `
      <h1 class="page-title">🛒 團購</h1>
      ${missing ? '<div class="notice"><p>這次團購已經結束或找不到了，看看其他的 😊</p></div>' : ''}
      ${data.groups.length ? `<ul class="shop-group-list">${data.groups.map((g) => `
        <li><a class="shop-group-card" href="#/shop/${encodeURIComponent(g.id)}">
          <span class="shop-group-name">${esc(g.name)}</span>
          <span class="badge ${g.closed ? 'badge-full' : 'badge-ok'}">${g.closed ? '已截止' : '開放中'}</span>
          <span class="shop-group-meta">${esc(g.deadline)} 截止・${g.link ? '🛒 在賣貨便下單' : g.pickups.length ? '取貨 ' + g.pickups.map((p) => esc(Fmt.shortDate(p.date))).join('、') : '線上訂購'}</span>
        </a></li>`).join('')}</ul>` : '<div class="notice"><p>目前沒有開放中的團購，下次開團會通知大家 😊</p></div>'}
      ${back()}`;
  }

  /** 賣貨便的團購：封面、說明、截止時間、「到賣貨便下單」（下單、付款、取貨都在賣貨便） */
  function renderLinkGroup(g, now) {
    const left = g.closed ? '' : countdown(g.deadline, now);
    root.innerHTML = `
      <h1 class="page-title">🛒 ${esc(g.name)}</h1>
      <p class="shop-deadline${g.closed ? ' is-closed' : ''}">${g.closed ? `⏰ 已經截止了（${esc(g.deadline)}）` : `⏰ ${esc(g.deadline)} 截止${left ? `・<strong>${left}</strong>` : ''}`}</p>
      ${g.cover ? `<button type="button" class="shop-cover" data-cover aria-label="放大看封面"><img src="${esc(Api.fileUrl(g.cover))}" alt="${esc(g.name)}"></button>` : ''}
      ${g.description ? `<p class="shop-desc">${Fmt.linkText(g.description)}</p>` : ''}
      ${g.closed ? '' : `<a class="btn btn-primary btn-block shop-myship" href="${esc(g.link)}" target="_blank" rel="noopener">🛒 到賣貨便下單</a>
      <p class="hint">會打開 7-ELEVEN 賣貨便，下單、付款、選 7-11 取貨都在那邊完成。</p>`}
      ${back()}`;
    const c = root.querySelector('[data-cover]');
    if (c) c.addEventListener('click', () => Modal.image(Api.fileUrl(g.cover), g.name));
  }

  /** 截止倒數：「還有 2 天 5 小時」 */
  function countdown(deadline, now) {
    const a = new Date(deadline.replace(' ', 'T') + ':00+08:00').getTime();
    const b = new Date(now.replace(' ', 'T') + ':00+08:00').getTime();
    const min = Math.floor((a - b) / 60000);
    if (min <= 0) return '';
    const d = Math.floor(min / 1440);
    const h = Math.floor((min % 1440) / 60);
    return d ? `還有 ${d} 天 ${h} 小時` : h ? `還有 ${h} 小時 ${min % 60} 分` : `只剩 ${min} 分鐘！`;
  }

  function total(g) {
    return g.items.reduce((n, it) => n + (form.qty[it.id] || 0) * it.price, 0);
  }

  /** 這個商品最多還能選幾份（限量扣掉別人的；自己原本訂的份數加回來）、每人上限 */
  function maxOf(it) {
    const mine = form.existing ? ((form.existing.items.find((x) => x.id === it.id) || {}).qty || 0) : 0;
    let max = 99;
    if (it.left !== null) max = Math.min(max, it.left + mine);
    if (it.perPerson !== null) max = Math.min(max, it.perPerson);
    return max;
  }

  function sourceHtml() {
    if (!SOURCES.length || form.known !== false) return '';
    return `<div class="shop-source">
      <p class="source-q">🌱 第一次來？怎麼認識${esc(window.SITE.org)}的？</p>
      <div class="source-chips">${SOURCES.map((s) => `<label class="pos-chip${form.source === s ? ' is-checked' : ''}"><input type="radio" name="src" value="${esc(s)}" data-src${form.source === s ? ' checked' : ''}>${SOURCE_ICON[s] || ''} ${esc(s)}</label>`).join('')}</div>
      ${form.source === '朋友介紹' ? `<input class="input source-extra" data-referrer maxlength="20" value="${esc(form.referrer)}" placeholder="介紹人是誰？（名字）">` : ''}
      ${form.source === '其他' ? `<input class="input source-extra" data-source-note maxlength="50" value="${esc(form.sourceNote)}" placeholder="說一下在哪裡知道的（選填）">` : ''}
    </div>`;
  }

  function renderGroup(g, now) {
    const closed = g.closed;
    const left = closed ? '' : countdown(g.deadline, now);
    root.innerHTML = `
      <h1 class="page-title">🛒 ${esc(g.name)}</h1>
      <p class="shop-deadline${closed ? ' is-closed' : ''}">${closed ? `⏰ 已經截止了（${esc(g.deadline)}），要改訂單請找小編` : `⏰ ${esc(g.deadline)} 截止${left ? `・<strong>${left}</strong>` : ''}`}</p>
      ${g.description ? `<p class="shop-desc">${esc(g.description).replace(/\n/g, '<br>')}</p>` : ''}
      <div id="shop-flash"></div>
      <form class="shop-order-form" novalidate>
        <section class="shop-step">
          <h2><span class="step">1</span>選商品<small>點照片可以放大</small></h2>
          <ul class="shop-cards">${g.items.map((it) => {
            const max = maxOf(it);
            const n = form.qty[it.id] || 0;
            const soldOut = it.left === 0 && !n && max === 0;
            return `<li class="shop-card${n ? ' is-on' : ''}${soldOut ? ' is-soldout' : ''}">
              ${it.photo ? `<button type="button" class="shop-thumb shop-card-img" data-zoom="${esc(Api.fileUrl(it.photo))}" data-cap="${esc(it.name)}" aria-label="放大看${esc(it.name)}的照片"><img src="${esc(Api.fileUrl(it.photo))}" alt="" loading="lazy"></button>` : '<span class="shop-thumb shop-noimg shop-card-img" aria-hidden="true">🌿</span>'}
              <div class="shop-card-body">
                <strong class="shop-card-name">${esc(it.name)}</strong>
                <span class="shop-card-price">${money(it.price)}${it.unit ? `<small>／${esc(it.unit)}</small>` : ''}</span>
                ${it.description ? `<span class="shop-card-desc">${esc(it.description)}</span>` : ''}
                <span class="shop-card-left">${soldOut ? '已售完' : [it.left !== null ? `剩 ${it.left} ${esc(it.unit || '份')}` : '', it.perPerson !== null ? `每人最多 ${it.perPerson}` : ''].filter(Boolean).join('・')}</span>
              </div>
              <div class="shop-stepper" role="group" aria-label="${esc(it.name)} 的數量">
                <button type="button" class="btn shop-step-btn" data-minus="${esc(it.id)}"${closed || !n ? ' disabled' : ''} aria-label="少一個">－</button>
                <span class="shop-step-n" aria-live="polite">${n}</span>
                <button type="button" class="btn shop-step-btn" data-plus="${esc(it.id)}"${closed || n >= max ? ' disabled' : ''} aria-label="多一個">＋</button>
              </div>
            </li>`;
          }).join('')}</ul>
        </section>
        ${g.pickups.length ? `<section class="shop-step">
          <h2><span class="step">2</span>在哪一場取貨</h2>
          <div class="shop-pickups">${g.pickups.map((p) => `<label class="choice${form.pickupId === p.id ? ' is-checked' : ''}"><input type="radio" name="pickup" value="${esc(p.id)}"${form.pickupId === p.id ? ' checked' : ''}${closed ? ' disabled' : ''}>
            <span class="choice-main">${esc(Fmt.shortDate(p.date))}${p.startTime ? ' ' + esc(p.startTime) : ''}</span><span class="choice-sub">📍 ${esc(p.location || p.name)}</span></label>`).join('')}</div>
        </section>` : ''}
        <section class="shop-step">
          <h2><span class="step">${g.pickups.length ? 3 : 2}</span>你的名字</h2>
          <input class="input" data-name maxlength="20" autocomplete="name" placeholder="例：王小明" value="${esc(form.name)}"${closed ? ' disabled' : ''}>
          <div class="suggestions" data-suggestions></div>
          ${form.existing ? `<div class="notice shop-existing"><p>✏️ <strong>${esc(form.name)}</strong> 已經訂過這次團購了，下面是原本的內容；改好送出就會更新那一張。</p></div>` : ''}
          ${sourceHtml()}
        </section>
        <section class="shop-step">
          <h2><span class="step">${g.pickups.length ? 4 : 3}</span>怎麼付款</h2>
          <div class="segmented">${[['現場', g.pickups.length ? '💵 取貨時付現' : '💵 付現'], ['轉帳', '🏦 轉帳']].map(([v, l]) => `<label class="segment${form.pay === v ? ' is-checked' : ''}"><input type="radio" name="pay" value="${v}"${form.pay === v ? ' checked' : ''}${closed ? ' disabled' : ''}>${l}</label>`).join('')}</div>
          ${form.pay === '轉帳' ? `<label class="form-row shop-last5"><span>轉帳後五碼（還沒轉可以先空著，之後在「查我的報名」補）</span><input class="input" data-last5 inputmode="numeric" maxlength="5" value="${esc(form.last5)}" placeholder="例：12345"></label>
            <p class="hint">${g.hasPayInfo ? '送出訂單後會顯示轉帳帳號。' : '轉帳帳號請問小編。'}</p>` : ''}
        </section>
        <div class="form-error" data-error role="alert" hidden></div>
        <div class="shop-total-bar">
          <span class="shop-total"><small>共 ${Object.values(form.qty).filter(Boolean).length} 樣</small><strong>${money(total(g))}</strong></span>
          <button type="submit" class="btn btn-primary" data-submit${closed ? ' disabled' : ''}>${form.existing ? '更新訂單' : '送出訂單'}</button>
        </div>
      </form>
      <a class="help-inline" href="#/mine">🔍 查我的團購（改單、取消、補末五碼）</a>
      ${back()}`;
    bind(g, now);
  }

  function bind(g, now) {
    const f = root.querySelector('form');
    const redraw = () => {
      const y = window.scrollY;
      renderGroup(g, now);
      window.scrollTo(0, y);
    };
    f.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => Modal.image(b.dataset.zoom, b.dataset.cap)));
    f.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.plus; form.qty[id] = (form.qty[id] || 0) + 1; redraw(); }));
    f.querySelectorAll('[data-minus]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.minus; form.qty[id] = Math.max((form.qty[id] || 0) - 1, 0); redraw(); }));
    f.querySelectorAll('input[name=pickup]').forEach((r) => r.addEventListener('change', () => { form.pickupId = r.value; redraw(); }));
    f.querySelectorAll('input[name=pay]').forEach((r) => r.addEventListener('change', () => { form.pay = r.value; redraw(); }));
    f.querySelectorAll('[data-src]').forEach((r) => r.addEventListener('change', () => { form.source = r.value; redraw(); const x = root.querySelector('[data-referrer], [data-source-note]'); if (x) x.focus(); }));
    const ref = f.querySelector('[data-referrer]');
    if (ref) ref.addEventListener('input', () => { form.referrer = ref.value; });
    const note = f.querySelector('[data-source-note]');
    if (note) note.addEventListener('input', () => { form.sourceNote = note.value; });
    const l5 = f.querySelector('[data-last5]');
    if (l5) l5.addEventListener('input', () => { form.last5 = l5.value.replace(/\D/g, ''); });
    const nameInput = f.querySelector('[data-name]');
    let timer = null;
    nameInput.addEventListener('input', () => {
      form.name = nameInput.value.trim();
      form.known = undefined;
      form.existing = null;
      clearTimeout(timer);
      timer = setTimeout(() => suggest(form.name), 300);
    });
    nameInput.addEventListener('change', () => lookupName(g));
    f.querySelector('[data-suggestions]').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-suggest]');
      if (!b) return;
      form.name = b.dataset.suggest;
      form.known = true;
      lookupName(g);
    });
    f.addEventListener('submit', (ev) => { ev.preventDefault(); submit(g); });
  }

  async function suggest(q) {
    const box = root && root.querySelector('[data-suggestions]');
    if (!box) return;
    if (!q) { box.innerHTML = ''; return; }
    try {
      const res = await Api.searchMembers(q);
      if (form.name !== q) return;
      box.innerHTML = res.members.slice(0, 8).filter((m) => m.name !== q).map((m) => `<button type="button" class="suggestion" data-suggest="${esc(m.name)}">${esc(m.name)}</button>`).join('');
    } catch (e) { /* 提示不到也沒關係 */ }
  }

  /** 打好名字：是不是名單上的人（第一次來要選管道）、有沒有訂過這次團購（有的話帶進來改） */
  async function lookupName(g) {
    const name = form.name.replace(/[\s　]+/g, '');
    if (name.length < 2) return;
    const t = token;
    try {
      const [members, mine] = await Promise.all([
        form.known === true ? Promise.resolve(null) : Api.searchMembers(name).catch(() => null),
        Api.shopMyOrders(name).catch(() => null)
      ]);
      if (t !== token || form.name.replace(/[\s　]+/g, '') !== name) return;
      if (members) form.known = members.members.some((m) => m.name === name || m.alias === name);
      const o = mine && mine.orders.find((x) => x.groupId === g.id);
      if (o) {
        form.known = true;
        form.existing = o;
        form.qty = {};
        o.items.forEach((it) => { form.qty[it.id] = it.qty; });
        form.pickupId = o.pickupId;
        form.pay = o.pay;
        form.last5 = o.last5 || '';
      } else form.existing = null;
      const data = await loadShop();
      const fresh = data.groups.find((x) => x.id === g.id) || g;
      renderGroup(fresh, data.now);
    } catch (e) { /* 查不到就照一般下單，伺服器會再檢查 */ }
  }

  function problem(g) {
    if (!total(g)) return '請至少選一樣商品（按＋）';
    if (g.pickups.length && !form.pickupId) return '請選在哪一場取貨';
    if (form.name.replace(/[\s　]+/g, '').length < 2) return '請填你的名字';
    if (SOURCES.length && form.known === false && !form.source) return '第一次來的朋友，請選怎麼認識我們的（不知道選「不確定」）';
    if (form.known === false && form.source === '朋友介紹' && !form.referrer.trim()) return '請填介紹人是誰';
    if (form.pay === '轉帳' && form.last5 && !/^\d{5}$/.test(form.last5)) return '轉帳末五碼要是 5 個數字';
    return '';
  }

  async function submit(g) {
    const box = root.querySelector('[data-error]');
    const p = problem(g);
    if (p) { box.textContent = p; box.hidden = false; return; }
    box.hidden = true;
    Busy.show('送出訂單中⋯', '請不要關閉畫面');
    try {
      const name = form.name.replace(/[\s　]+/g, '');
      const res = await Api.shopOrder({
        groupId: g.id, name, pickupId: form.pickupId, pay: form.pay, last5: form.pay === '轉帳' ? form.last5 : '',
        items: g.items.map((it) => ({ id: it.id, qty: form.qty[it.id] || 0 })),
        source: form.known === false ? form.source : '', referrer: form.known === false && form.source === '朋友介紹' ? form.referrer.trim() : '',
        sourceNote: form.known === false && form.source === '其他' ? form.sourceNote.trim() : ''
      });
      Busy.hide();
      saveName(name);
      shopCache = null;
      form.existing = res.order;
      form.known = true;
      done(g, res);
    } catch (err) {
      Busy.hide();
      if (err.code === 'VALIDATION' && err.details && err.details.some((d) => /怎麼認識/.test(d.message))) { form.known = false; }
      box.innerHTML = `<strong>${esc(err.message || '送出失敗，請稍後再試')}</strong>${(err.details || []).map((d) => '<br>' + esc(d.message)).join('')}`;
      box.hidden = false;
      if (form.known === false) { const data = await loadShop(true).catch(() => null); if (data) { renderGroup(data.groups.find((x) => x.id === g.id) || g, data.now); const b = root.querySelector('[data-error]'); b.innerHTML = box.innerHTML; b.hidden = false; } }
    }
  }

  /** 送出成功：訂單內容、金額、取貨場次、轉帳資訊、加到手機行事曆 */
  function done(g, res) {
    const o = res.order;
    const p = o.pickup || g.pickups.find((x) => x.id === o.pickupId);
    root.innerHTML = `
      <h1 class="page-title">🛒 ${esc(g.name)}</h1>
      <div class="notice notice-success notice-big" role="status">
        <p><strong>✅ ${res.updated ? '訂單更新好了！' : '訂好了！'}</strong></p>
        <p>${esc(o.name)}：${o.items.map((it) => esc(it.name) + ' × ' + it.qty).join('、')}</p>
        <p>💰 共 <strong>${money(o.total)}</strong>（${o.pay === '轉帳' ? '轉帳' : p ? '取貨時付現' : '付現'}）</p>
        ${p ? `<p>📦 ${esc(pickupText(p))} 取貨</p>` : ''}
        ${p ? `<div class="addcal-row">${AddCal.button({ name: '取團購：' + g.name, location: p.location, start: p.date, end: p.date, startTime: p.startTime, endTime: p.endTime || '', dutyId: p.id, date: p.date }, '加到手機行事曆（取貨那天）')}</div>` : ''}
      </div>
      ${o.pay === '轉帳' ? `<div class="notice shop-payinfo"><p><strong>🏦 轉帳資訊</strong></p><p>${esc(o.payInfo || '請問小編轉帳帳號').replace(/\n/g, '<br>')}</p><p class="muted">${o.last5 ? `已填末五碼 ${esc(o.last5)}` : '轉好後，到「查我的報名」填轉帳末五碼，小編才對得到帳 🙏'}</p></div>` : ''}
      <p class="hint">截止前（${esc(g.deadline)}）都可以到「查我的報名」改單或取消。</p>
      <a class="btn btn-block" href="#/mine">🔍 查我的報名、我的團購</a>
      <a class="btn btn-block" href="#/shop/${encodeURIComponent(g.id)}">再看一次團購</a>
      ${back()}`;
    window.scrollTo(0, 0);
  }

  // ---------- 查我的報名：🛒 我的團購 ----------

  /** 在 box 裡列出這個人的團購訂單（截止前可以改、取消；轉帳的可以補末五碼） */
  async function mineSection(box, name) {
    if (!box || !Fmt.feature('shop')) return;
    let data;
    try { data = await Api.shopMyOrders(name); } catch (e) { box.innerHTML = ''; return; }
    const draw = (flash) => {
      if (!data.orders.length) { box.innerHTML = flash || ''; return; }
      box.innerHTML = `${flash || ''}
        <h2 class="mine-title">🛒 ${esc(data.name)} 的團購（${data.orders.length} 張）</h2>
        <ul class="shop-orders">${data.orders.map((o) => `
          <li class="shop-order">
            <div class="shop-order-head"><strong>${esc(o.groupName)}</strong><span>${money(o.total)}</span></div>
            <p>${o.items.map((it) => esc(it.name) + ' × ' + it.qty).join('、')}</p>
            <p class="muted">${o.pickup ? '📦 ' + esc(pickupText(o.pickup)) + ' 取貨・' : o.pickupDate ? '📦 ' + esc(Fmt.shortDate(o.pickupDate)) + ' 取貨・' : ''}${o.pay === '轉帳' ? `轉帳${o.last5 ? '（末五碼 ' + esc(o.last5) + '）' : '・還沒填末五碼'}` : '取貨時付現'}${o.paid ? '・✅ 已付款' : ''}</p>
            ${o.pay === '轉帳' && o.payInfo && !o.paid ? `<p class="shop-payinfo-small">🏦 ${esc(o.payInfo).replace(/\n/g, '<br>')}</p>` : ''}
            <div class="shop-order-actions">
              ${o.closed ? '<span class="muted">已截止，要改請找小編</span>' : `<a class="btn btn-small" href="#/shop/${encodeURIComponent(o.groupId)}">改單</a><button type="button" class="btn btn-small btn-quiet-danger" data-shop-cancel="${esc(o.id)}">取消</button>`}
              ${o.pay === '轉帳' && !o.paid ? `<button type="button" class="btn btn-small" data-shop-last5="${esc(o.id)}">${o.last5 ? '改末五碼' : '填轉帳末五碼'}</button>` : ''}
            </div>
            ${o.pay === '轉帳' && !o.paid ? `<form class="shop-last5-form" data-last5-form="${esc(o.id)}" hidden novalidate>
              <input class="input" name="last5" inputmode="numeric" maxlength="5" value="${esc(o.last5 || '')}" placeholder="轉帳帳號末五碼" aria-label="轉帳末五碼">
              <button type="submit" class="btn btn-small btn-primary">存檔</button>
            </form>` : ''}
          </li>`).join('')}</ul>`;
      box.querySelectorAll('[data-shop-cancel]').forEach((b) => b.addEventListener('click', async () => {
        const o = data.orders.find((x) => x.id === b.dataset.shopCancel);
        const ok = await Confirm.open({ title: '取消這張團購訂單？', rows: [['團購', o.groupName], ['品項', o.items.map((it) => it.name + '×' + it.qty).join('、')], ['金額', money(o.total)]], confirmText: '確定取消', danger: true,
          note: o.pay === '轉帳' && o.last5 ? '已經轉帳的話，取消後請跟小編說，小編會退款給你。' : '' });
        if (!ok) return;
        Busy.show('取消中⋯');
        try {
          await Api.shopCancel(o.id, data.name);
          Busy.hide();
          shopCache = null;
          data.orders = data.orders.filter((x) => x.id !== o.id);
          draw(`<div class="notice notice-success" role="status"><p>已取消「${esc(o.groupName)}」的訂單${o.pay === '轉帳' && o.last5 ? '，記得跟小編說要退款喔' : ''}。</p></div>`);
        } catch (e) { Busy.hide(); draw(`<div class="notice notice-error" role="alert"><p>${esc(e.message || '取消失敗')}</p></div>`); }
      }));
      box.querySelectorAll('[data-shop-last5]').forEach((b) => b.addEventListener('click', () => {
        const f = box.querySelector(`[data-last5-form="${b.dataset.shopLast5}"]`);
        f.hidden = false;
        f.elements.last5.focus();
      }));
      box.querySelectorAll('[data-last5-form]').forEach((f) => f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const o = data.orders.find((x) => x.id === f.dataset.last5Form);
        const v = f.elements.last5.value.replace(/\D/g, '');
        if (!/^\d{5}$/.test(v)) { f.elements.last5.setCustomValidity('要 5 個數字'); f.elements.last5.reportValidity(); f.elements.last5.setCustomValidity(''); return; }
        Busy.show('存檔中⋯');
        try {
          const r = await Api.shopSetLast5(o.id, data.name, v.trim());
          Busy.hide();
          o.last5 = r.last5;
          draw('<div class="notice notice-success" role="status"><p>末五碼存好了，謝謝 😊</p></div>');
        } catch (e) { Busy.hide(); draw(`<div class="notice notice-error" role="alert"><p>${esc(e.message || '存檔失敗')}</p></div>`); }
      }));
    };
    draw();
  }

  window.ShopPage = { show, checkButton, dutyNote, mineSection };
})();
