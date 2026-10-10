// 大家的團購（規格 0.6、0.6「改成像愛+1 的購物方式」）：
//   #/shop                     開放中的團購（只有一個就直接進商城）
//   #/shop/<團購ID>            商城：商品大圖格子
//   #/shop/<團購ID>/p/<商品ID> 商品頁：照片左右滑、規格、數量、加入購物車
//   #/shop/<團購ID>/cart       購物車＋結帳（名字、取貨場次、付款方式）
//   #/shop/orders              我的訂單：全部／未付款／待取貨／已完成
// 下方固定分頁列：商城／購物車／我的訂單。購物車存在這支手機（每個團購一台）。
// 結帳送 mode＝add：同一個人在同一次團購已經有訂單，就加進原本那張。規則都在伺服器（apps-script/Shop.gs）。
// 另外提供：行事曆上方的「🛒 團購」按鈕（有開放中的團購才出現）、活動頁「這場可以取團購」、查我的報名的「🛒 我的團購」。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const NAME_KEY = 'shumeizi:mine-name'; // 和查我的報名同一個（記住這支手機的人）
  const CART_KEY = 'shumeizi:cart:';
  const LAST_KEY = 'shumeizi:shop-last'; // 最後逛的團購（分頁列的商城、購物車用）
  const SOURCES = window.SITE.sources || [];
  const SOURCE_ICON = { 朋友介紹: '👫', '官方 LINE': '💬', 官網: '🌐', Instagram: '📷', Facebook: '📘', 其他: '✨', 不確定: '🤔' };
  let shopCache = null; // { at, data }
  let root = null;
  let token = 0;
  // 結帳表單（換團購時清掉）
  const form = { groupId: '', pickupId: '', pay: '現場', last5: '', name: '', known: undefined, source: '', referrer: '', sourceNote: '', existing: null };

  const money = (n) => `${Number(n || 0).toLocaleString('zh-TW')} 元`;
  const pickupText = (p) => `${Fmt.shortDate(p.date)}${p.startTime ? ' ' + p.startTime : ''}　${p.location || p.name}`;
  const photoUrl = (id) => Api.fileUrl(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 無痕模式 */ } }
  };
  const savedName = () => store.get(NAME_KEY) || '';
  const saveName = (n) => store.set(NAME_KEY, n);

  // ---------- 購物車（這支手機） ----------

  function cartOf(gid) {
    try { const v = JSON.parse(store.get(CART_KEY + gid) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveCart(gid, lines) { store.set(CART_KEY + gid, JSON.stringify(lines.filter((l) => l.qty > 0))); }
  /** 購物車裡還在賣的品項：[{ id, option, qty, it, price, name }] */
  function cartLines(g) {
    return cartOf(g.id).map((l) => {
      const it = g.items.find((x) => x.id === l.id);
      if (!it) return null;
      const op = it.options ? it.options.options.find((o) => o.name === l.option) : null;
      if (it.options && !op) return null;
      return { id: l.id, option: op ? op.name : '', qty: Number(l.qty) || 0, it, price: op && op.price !== null ? op.price : it.price, name: it.name + (op ? `（${op.name}）` : '') };
    }).filter((l) => l && l.qty > 0);
  }
  const cartCount = (g) => cartLines(g).reduce((n, l) => n + l.qty, 0);
  const cartTotal = (g) => cartLines(g).reduce((n, l) => n + l.qty * l.price, 0);
  /** 這個商品在購物車裡（各規格加總） */
  const inCart = (g, id) => cartOf(g.id).filter((l) => l.id === id).reduce((n, l) => n + (Number(l.qty) || 0), 0);

  /** 這個商品最多還能放幾份：限量剩下的、每人上限，扣掉購物車裡的 */
  function room(g, it) {
    let max = 99;
    if (it.left !== null) max = Math.min(max, it.left);
    if (it.perPerson !== null) max = Math.min(max, it.perPerson);
    return Math.max(max - inCart(g, it.id), 0);
  }

  /** 商品價格：有規格而且價格不一樣時寫「25 元起」 */
  function priceText(it) {
    if (!it.options) return money(it.price);
    const ps = it.options.options.map((o) => (o.price !== null ? o.price : it.price));
    const min = Math.min.apply(null, ps);
    return Math.max.apply(null, ps) === min ? money(min) : `${money(min)}起`;
  }

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

  // ---------- 路由 ----------

  /** path：''、'<團購ID>'、'<團購ID>/p/<商品ID>'、'<團購ID>/cart'、'orders' */
  async function show(path) {
    root = document.getElementById('view-shop');
    const t = ++token;
    const parts = String(path || '').split('/').map(decodeURIComponent);
    if (parts[0] === 'orders') return showOrders(t);
    root.innerHTML = '<h1 class="page-title">🛒 團購</h1><p class="panel-empty">讀取中⋯</p>';
    let data;
    try { data = await loadShop(!parts[1]); } catch (err) {
      if (t !== token) return;
      root.innerHTML = `<h1 class="page-title">🛒 團購</h1><div class="notice notice-error" role="alert"><p>${esc(err.message || '讀取失敗，請稍後再試')}</p></div>${back()}`;
      return;
    }
    if (t !== token) return;
    const gid = parts[0];
    const g = gid ? data.groups.find((x) => x.id === gid) : (data.groups.length === 1 ? data.groups[0] : null);
    if (!g) return renderList(data, gid);
    if (g.link) return renderLinkGroup(g, data.now); // 賣貨便：只放按鈕連過去
    store.set(LAST_KEY, g.id);
    if (form.groupId !== g.id) Object.assign(form, { groupId: g.id, pickupId: g.pickups.length === 1 ? g.pickups[0].id : '', pay: '現場', last5: '', existing: null });
    if (parts[1] === 'p') {
      const it = g.items.find((x) => x.id === parts[2]);
      return it ? renderProduct(g, it, data.now) : renderStore(g, data.now);
    }
    if (parts[1] === 'cart') return renderCart(g, data.now);
    renderStore(g, data.now);
  }

  function back() {
    return '<a class="btn btn-block back-bottom" href="#/">‹ 回行事曆</a>';
  }

  /** 下方固定分頁列：商城／購物車（件數）／我的訂單 */
  function tabbar(active, g) {
    const gid = g ? g.id : store.get(LAST_KEY) || '';
    const n = g ? cartCount(g) : 0;
    const tab = (key, href, icon, label, badge) => `<a class="shop-tab${active === key ? ' is-active' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}><span class="shop-tab-icon" aria-hidden="true">${icon}${badge ? `<b class="shop-tab-badge">${badge}</b>` : ''}</span><span>${label}</span></a>`;
    return `<nav class="shop-tabbar" aria-label="團購">
      ${tab('store', gid ? `#/shop/${encodeURIComponent(gid)}` : '#/shop', '🏪', '商城')}
      ${tab('cart', gid ? `#/shop/${encodeURIComponent(gid)}/cart` : '#/shop', '🛒', '購物車', n)}
      ${tab('orders', '#/shop/orders', '📋', '我的訂單')}
    </nav>`;
  }

  function renderList(data, missing) {
    root.innerHTML = `
      <div class="shop-page">
      <h1 class="page-title">🛒 團購</h1>
      ${missing ? '<div class="notice"><p>這次團購已經結束或找不到了，看看其他的 😊</p></div>' : ''}
      ${data.groups.length ? `<ul class="shop-group-list">${data.groups.map((g) => `
        <li><a class="shop-group-card" href="#/shop/${encodeURIComponent(g.id)}">
          ${g.cover ? `<img class="shop-group-cover" src="${esc(photoUrl(g.cover))}" alt="" loading="lazy">` : ''}
          <span class="shop-group-name">${esc(g.name)}</span>
          <span class="badge ${g.closed ? 'badge-full' : 'badge-ok'}">${g.closed ? '已截止' : '開放中'}</span>
          <span class="shop-group-meta">${esc(g.deadline)} 截止・${g.link ? '🛒 在賣貨便下單' : g.pickups.length ? '取貨 ' + g.pickups.map((p) => esc(Fmt.shortDate(p.date))).join('、') : '線上訂購'}</span>
        </a></li>`).join('')}</ul>` : '<div class="notice"><p>目前沒有開放中的團購，下次開團會通知大家 😊</p></div>'}
      ${back()}
      </div>
      ${tabbar('store', null)}`;
  }

  /** 賣貨便的團購：封面、說明、截止時間、「到賣貨便下單」（下單、付款、取貨都在賣貨便） */
  function renderLinkGroup(g, now) {
    const left = g.closed ? '' : countdown(g.deadline, now);
    root.innerHTML = `
      <h1 class="page-title">🛒 ${esc(g.name)}</h1>
      <p class="shop-deadline${g.closed ? ' is-closed' : ''}">${g.closed ? `⏰ 已經截止了（${esc(g.deadline)}）` : `⏰ ${esc(g.deadline)} 截止${left ? `・<strong>${left}</strong>` : ''}`}</p>
      ${g.cover ? `<button type="button" class="shop-cover" data-cover aria-label="放大看封面"><img src="${esc(photoUrl(g.cover))}" alt="${esc(g.name)}"></button>` : ''}
      ${g.description ? `<p class="shop-desc">${Fmt.linkText(g.description)}</p>` : ''}
      ${g.closed ? '' : `<a class="btn btn-primary btn-block shop-myship" href="${esc(g.link)}" target="_blank" rel="noopener">🛒 到賣貨便下單</a>
      <p class="hint">會打開 7-ELEVEN 賣貨便，下單、付款、選 7-11 取貨都在那邊完成。</p>`}
      ${back()}`;
    const c = root.querySelector('[data-cover]');
    if (c) c.addEventListener('click', () => Modal.image(photoUrl(g.cover), g.name));
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

  /** 截止時間那一行 */
  function deadlineLine(g, now) {
    const left = g.closed ? '' : countdown(g.deadline, now);
    return `<p class="shop-deadline${g.closed ? ' is-closed' : ''}">${g.closed ? `⏰ 已經截止了（${esc(g.deadline)}），要改訂單請找小編` : `⏰ ${esc(g.deadline)} 截止${left ? `・<strong>${left}</strong>` : ''}`}</p>`;
  }

  // ---------- 商城：商品大圖格子 ----------

  function renderStore(g, now) {
    root.innerHTML = `
      <div class="shop-page">
      ${g.cover ? `<img class="shop-banner" src="${esc(photoUrl(g.cover))}" alt="">` : ''}
      <h1 class="page-title">🛒 ${esc(g.name)}</h1>
      ${deadlineLine(g, now)}
      ${g.description ? `<p class="shop-desc">${Fmt.linkText(g.description)}</p>` : ''}
      ${g.pickups.length ? `<p class="shop-pickup-note">📦 取貨：${g.pickups.map((p) => esc(pickupText(p))).join('、')}</p>` : ''}
      <ul class="shop-grid">${g.items.map((it) => {
        const soldOut = it.left === 0;
        return `<li><a class="shop-tile${soldOut ? ' is-soldout' : ''}" href="#/shop/${encodeURIComponent(g.id)}/p/${encodeURIComponent(it.id)}">
          <span class="shop-tile-img">${it.photo ? `<img src="${esc(photoUrl(it.photo))}" alt="" loading="lazy">` : '<span class="shop-noimg" aria-hidden="true">🌿</span>'}${soldOut ? '<span class="shop-tile-flag">已售完</span>' : it.left !== null && it.left <= 5 ? `<span class="shop-tile-flag is-few">剩 ${it.left}</span>` : ''}</span>
          <span class="shop-tile-name">${esc(it.name)}</span>
          <span class="shop-tile-price">${priceText(it)}${it.unit ? `<small>／${esc(it.unit)}</small>` : ''}</span>
          <span class="shop-tile-meta">已售出 ${it.sold}${it.options ? `・${it.options.options.length} 種${esc(it.options.label)}` : ''}</span>
        </a></li>`;
      }).join('')}</ul>
      ${cartCount(g) ? `<a class="btn btn-primary btn-block shop-go-cart" href="#/shop/${encodeURIComponent(g.id)}/cart">🛒 去結帳（${cartCount(g)} 件・${money(cartTotal(g))}）</a>` : ''}
      ${back()}
      </div>
      ${tabbar('store', g)}`;
  }

  // ---------- 商品頁 ----------

  function renderProduct(g, it, now, pick) {
    const st = pick || { option: it.options && it.options.options.length === 1 ? it.options.options[0].name : '', qty: 1, flash: '' };
    const photos = it.photos && it.photos.length ? it.photos : [it.photo].filter(Boolean);
    const op = it.options ? it.options.options.find((o) => o.name === st.option) : null;
    const price = op && op.price !== null ? op.price : it.price;
    const max = room(g, it);
    const qty = Math.min(st.qty, Math.max(max, 1));
    const soldOut = it.left === 0;
    root.innerHTML = `
      <div class="shop-page shop-product">
      <a class="back-link" href="#/shop/${encodeURIComponent(g.id)}">‹ ${esc(g.name)}</a>
      ${photos.length ? `<div class="shop-gallery">
        <div class="shop-gallery-track" data-track>${photos.map((p, i) => `<button type="button" class="shop-gallery-slide" data-zoom="${esc(photoUrl(p))}" aria-label="放大看第 ${i + 1} 張"><img src="${esc(photoUrl(p))}" alt="${esc(it.name)}" ${i ? 'loading="lazy"' : ''}></button>`).join('')}</div>
        ${photos.length > 1 ? `<div class="shop-gallery-dots" aria-hidden="true">${photos.map((p, i) => `<span${i ? '' : ' class="is-on"'}></span>`).join('')}</div>` : ''}
      </div>` : '<div class="shop-gallery shop-gallery-empty" aria-hidden="true">🌿</div>'}
      <h1 class="shop-product-name">${esc(it.name)}</h1>
      <p class="shop-product-price">${money(price)}${it.unit ? `<small>／${esc(it.unit)}</small>` : ''}</p>
      <p class="shop-product-meta">已售出 ${it.sold}${it.left !== null ? `・${soldOut ? '已售完' : '剩 ' + it.left + ' ' + esc(it.unit || '份')}` : ''}${it.perPerson !== null ? `・每人最多 ${it.perPerson}` : ''}</p>
      ${deadlineLine(g, now)}
      ${it.description ? `<p class="shop-desc">${Fmt.linkText(it.description)}</p>` : ''}
      ${it.options ? `<div class="shop-opt"><p class="shop-opt-label">${esc(it.options.label)}</p><div class="pos-chips">${it.options.options.map((o) => `<label class="pos-chip${st.option === o.name ? ' is-checked' : ''}"><input type="radio" name="opt" value="${esc(o.name)}" data-opt${st.option === o.name ? ' checked' : ''}>${esc(o.name)}${o.price !== null && o.price !== it.price ? `<small>${money(o.price)}</small>` : ''}</label>`).join('')}</div></div>` : ''}
      ${st.flash}
      <div class="shop-buybar">
        <div class="shop-stepper" role="group" aria-label="數量">
          <button type="button" class="btn shop-step-btn" data-minus${qty <= 1 ? ' disabled' : ''} aria-label="少一個">－</button>
          <span class="shop-step-n" aria-live="polite">${qty}</span>
          <button type="button" class="btn shop-step-btn" data-plus${qty >= max ? ' disabled' : ''} aria-label="多一個">＋</button>
        </div>
        <button type="button" class="btn btn-primary shop-add" data-add${g.closed || soldOut || !max ? ' disabled' : ''}>${g.closed ? '已截止' : soldOut ? '已售完' : !max ? '已達上限' : `加入購物車<small>${money(price * qty)}</small>`}</button>
      </div>
      </div>
      ${tabbar('store', g)}`;
    const redraw = (patch) => renderProduct(g, it, now, Object.assign({}, st, { qty }, patch));
    root.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => Modal.image(b.dataset.zoom, it.name)));
    const track = root.querySelector('[data-track]');
    if (track && photos.length > 1) {
      track.addEventListener('scroll', () => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        root.querySelectorAll('.shop-gallery-dots span').forEach((d, k) => d.classList.toggle('is-on', k === i));
      }, { passive: true });
    }
    root.querySelectorAll('[data-opt]').forEach((r) => r.addEventListener('change', () => redraw({ option: r.value, flash: '' })));
    root.querySelector('[data-minus]').addEventListener('click', () => redraw({ qty: Math.max(qty - 1, 1), flash: '' }));
    root.querySelector('[data-plus]').addEventListener('click', () => redraw({ qty: qty + 1, flash: '' }));
    root.querySelector('[data-add]').addEventListener('click', () => {
      if (it.options && !st.option) { redraw({ flash: `<div class="form-error" role="alert">請先選${esc(it.options.label)}</div>` }); return; }
      const lines = cartOf(g.id);
      const hit = lines.find((l) => l.id === it.id && (l.option || '') === (st.option || ''));
      if (hit) hit.qty = (Number(hit.qty) || 0) + qty; else lines.push({ id: it.id, option: st.option || '', qty });
      saveCart(g.id, lines);
      redraw({ qty: 1, flash: `<div class="notice notice-success shop-added" role="status"><p>✅ 已加入購物車（${esc(it.name)}${st.option ? '・' + esc(st.option) : ''} × ${qty}）</p><p><a class="btn btn-small btn-primary" href="#/shop/${encodeURIComponent(g.id)}/cart">去結帳</a> <a class="btn btn-small" href="#/shop/${encodeURIComponent(g.id)}">繼續逛</a></p></div>` });
      const added = root.querySelector('.shop-added');
      if (added) added.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    if (!pick) window.scrollTo(0, 0);
  }

  // ---------- 購物車＋結帳 ----------

  function sourceHtml() {
    if (!SOURCES.length || form.known !== false) return '';
    return `<div class="shop-source">
      <p class="source-q">🌱 第一次來？怎麼認識${esc(window.SITE.org)}的？</p>
      <div class="source-chips">${SOURCES.map((s) => `<label class="pos-chip${form.source === s ? ' is-checked' : ''}"><input type="radio" name="src" value="${esc(s)}" data-src${form.source === s ? ' checked' : ''}>${SOURCE_ICON[s] || ''} ${esc(s)}</label>`).join('')}</div>
      ${form.source === '朋友介紹' ? `<input class="input source-extra" data-referrer maxlength="20" value="${esc(form.referrer)}" placeholder="介紹人是誰？（名字）">` : ''}
      ${form.source === '其他' ? `<input class="input source-extra" data-source-note maxlength="50" value="${esc(form.sourceNote)}" placeholder="說一下在哪裡知道的（選填）">` : ''}
    </div>`;
  }

  function renderCart(g, now) {
    if (!form.name) form.name = savedName();
    const lines = cartLines(g);
    const closed = g.closed;
    let step = 0;
    const n = () => ++step;
    root.innerHTML = `
      <div class="shop-page">
      <a class="back-link" href="#/shop/${encodeURIComponent(g.id)}">‹ 繼續逛</a>
      <h1 class="page-title">🛒 購物車</h1>
      <p class="muted">${esc(g.name)}</p>
      ${deadlineLine(g, now)}
      ${lines.length ? `<form class="shop-order-form" novalidate>
        <section class="shop-step">
          <h2><span class="step">${n()}</span>確認商品</h2>
          <ul class="shop-cart">${lines.map((l, i) => {
            const max = room(g, l.it) + l.qty;
            return `<li class="shop-cart-row">
              <a class="shop-cart-img" href="#/shop/${encodeURIComponent(g.id)}/p/${encodeURIComponent(l.id)}">${l.it.photo ? `<img src="${esc(photoUrl(l.it.photo))}" alt="" loading="lazy">` : '<span class="shop-noimg" aria-hidden="true">🌿</span>'}</a>
              <div class="shop-cart-body">
                <strong>${esc(l.name)}</strong>
                <span class="shop-cart-price">${money(l.price)} × ${l.qty} ＝ <b>${money(l.price * l.qty)}</b></span>
                <div class="shop-stepper shop-stepper-sm" role="group" aria-label="${esc(l.name)} 的數量">
                  <button type="button" class="btn shop-step-btn" data-cart-minus="${i}"${closed ? ' disabled' : ''} aria-label="少一個">－</button>
                  <span class="shop-step-n">${l.qty}</span>
                  <button type="button" class="btn shop-step-btn" data-cart-plus="${i}"${closed || l.qty >= max ? ' disabled' : ''} aria-label="多一個">＋</button>
                  <button type="button" class="link-btn shop-cart-del" data-cart-del="${i}">刪除</button>
                </div>
              </div>
            </li>`;
          }).join('')}</ul>
        </section>
        ${g.pickups.length ? `<section class="shop-step">
          <h2><span class="step">${n()}</span>在哪一場取貨</h2>
          <div class="shop-pickups">${g.pickups.map((p) => `<label class="choice${form.pickupId === p.id ? ' is-checked' : ''}"><input type="radio" name="pickup" value="${esc(p.id)}"${form.pickupId === p.id ? ' checked' : ''}${closed ? ' disabled' : ''}>
            <span class="choice-main">${esc(Fmt.shortDate(p.date))}${p.startTime ? ' ' + esc(p.startTime) : ''}</span><span class="choice-sub">📍 ${esc(p.location || p.name)}</span></label>`).join('')}</div>
        </section>` : ''}
        <section class="shop-step">
          <h2><span class="step">${n()}</span>你的名字</h2>
          <input class="input" data-name maxlength="20" autocomplete="name" placeholder="例：王小明" value="${esc(form.name)}"${closed ? ' disabled' : ''}>
          <div class="suggestions" data-suggestions></div>
          ${form.existing ? `<div class="notice shop-existing"><p>✏️ <strong>${esc(form.name)}</strong> 這次團購已經有一張訂單（${form.existing.items.map((x) => esc(x.name) + '×' + x.qty).join('、')}），這次的東西會<strong>加進原本那張</strong>。</p></div>` : ''}
          ${sourceHtml()}
        </section>
        <section class="shop-step">
          <h2><span class="step">${n()}</span>怎麼付款</h2>
          <div class="segmented">${[['現場', g.pickups.length ? '💵 取貨時付現' : '💵 付現'], ['轉帳', '🏦 轉帳']].map(([v, l]) => `<label class="segment${form.pay === v ? ' is-checked' : ''}"><input type="radio" name="pay" value="${v}"${form.pay === v ? ' checked' : ''}${closed ? ' disabled' : ''}>${l}</label>`).join('')}</div>
          ${form.pay === '轉帳' ? `<label class="form-row shop-last5"><span>轉帳後五碼（還沒轉可以先空著，之後在「我的訂單」補）</span><input class="input" data-last5 inputmode="numeric" maxlength="5" value="${esc(form.last5)}" placeholder="例：12345"></label>
            <p class="hint">${g.hasPayInfo ? '送出訂單後會顯示轉帳帳號。' : '轉帳帳號請問小編。'}</p>` : ''}
        </section>
        <div class="form-error" data-error role="alert" hidden></div>
        <div class="shop-total-bar">
          <span class="shop-total"><small>共 ${cartCount(g)} 件</small><strong>${money(cartTotal(g))}</strong></span>
          <button type="submit" class="btn btn-primary" data-submit${closed ? ' disabled' : ''}>送出訂單</button>
        </div>
      </form>` : `<div class="notice shop-empty"><p>購物車是空的</p><p><a class="btn btn-primary" href="#/shop/${encodeURIComponent(g.id)}">去逛逛 ›</a></p></div>`}
      </div>
      ${tabbar('cart', g)}`;
    if (lines.length) bindCart(g, now);
    if (form.name && lines.length && form.existing === null && form.known === undefined) lookupName(g, now);
  }

  function bindCart(g, now) {
    const f = root.querySelector('form');
    const redraw = () => { const y = window.scrollY; renderCart(g, now); window.scrollTo(0, y); };
    const setQty = (i, delta) => {
      const l = cartLines(g)[i];
      const all = cartOf(g.id);
      const hit = all.find((x) => x.id === l.id && (x.option || '') === l.option);
      if (hit) hit.qty = delta === null ? 0 : Math.max((Number(hit.qty) || 0) + delta, 0);
      saveCart(g.id, all);
      redraw();
    };
    f.querySelectorAll('[data-cart-plus]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.cartPlus), 1)));
    f.querySelectorAll('[data-cart-minus]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.cartMinus), -1)));
    f.querySelectorAll('[data-cart-del]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.cartDel), null)));
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
    nameInput.addEventListener('change', () => lookupName(g, now));
    f.querySelector('[data-suggestions]').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-suggest]');
      if (!b) return;
      form.name = b.dataset.suggest;
      form.known = true;
      lookupName(g, now);
    });
    f.addEventListener('submit', (ev) => { ev.preventDefault(); submit(g, now); });
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

  /** 打好名字：是不是名單上的人（第一次來要選管道）、這次團購有沒有訂過（有的話這次會加進去） */
  async function lookupName(g, now) {
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
      form.existing = o || null;
      if (o) {
        form.known = true;
        if (o.pickupId) form.pickupId = o.pickupId;
        form.pay = o.pay;
        form.last5 = o.last5 || '';
      }
      if (root.querySelector('.shop-order-form')) { const y = window.scrollY; renderCart(g, now); window.scrollTo(0, y); }
    } catch (e) { /* 查不到就照一般下單，伺服器會再檢查 */ }
  }

  function problem(g) {
    if (!cartCount(g)) return '購物車是空的';
    if (g.pickups.length && !form.pickupId) return '請選在哪一場取貨';
    if (form.name.replace(/[\s　]+/g, '').length < 2) return '請填你的名字';
    if (SOURCES.length && form.known === false && !form.source) return '第一次來的朋友，請選怎麼認識我們的（不知道選「不確定」）';
    if (form.known === false && form.source === '朋友介紹' && !form.referrer.trim()) return '請填介紹人是誰';
    if (form.pay === '轉帳' && form.last5 && !/^\d{5}$/.test(form.last5)) return '轉帳末五碼要是 5 個數字';
    return '';
  }

  async function submit(g, now) {
    const box = root.querySelector('[data-error]');
    const p = problem(g);
    if (p) { box.textContent = p; box.hidden = false; box.scrollIntoView({ block: 'center' }); return; }
    box.hidden = true;
    Busy.show('送出訂單中⋯', '請不要關閉畫面');
    try {
      const name = form.name.replace(/[\s　]+/g, '');
      const res = await Api.shopOrder({
        groupId: g.id, name, mode: 'add', pickupId: form.pickupId, pay: form.pay, last5: form.pay === '轉帳' ? form.last5 : '',
        items: cartLines(g).map((l) => ({ id: l.id, option: l.option, qty: l.qty })),
        source: form.known === false ? form.source : '', referrer: form.known === false && form.source === '朋友介紹' ? form.referrer.trim() : '',
        sourceNote: form.known === false && form.source === '其他' ? form.sourceNote.trim() : ''
      });
      Busy.hide();
      saveName(name);
      saveCart(g.id, []);
      shopCache = null;
      form.existing = res.order;
      form.known = true;
      done(g, res);
    } catch (err) {
      Busy.hide();
      if (err.code === 'VALIDATION' && err.details && err.details.some((d) => /怎麼認識/.test(d.message))) form.known = false;
      const msg = `<strong>${esc(err.message || '送出失敗，請稍後再試')}</strong>${(err.details || []).map((d) => '<br>' + esc(d.message)).join('')}`;
      const data = await loadShop(true).catch(() => null);
      renderCart(data ? data.groups.find((x) => x.id === g.id) || g : g, data ? data.now : now);
      const b = root.querySelector('[data-error]');
      if (b) { b.innerHTML = msg; b.hidden = false; b.scrollIntoView({ block: 'center' }); }
    }
  }

  /** 送出成功：訂單內容、金額、取貨場次、轉帳資訊、加到手機行事曆 */
  function done(g, res) {
    const o = res.order;
    const p = o.pickup || g.pickups.find((x) => x.id === o.pickupId);
    root.innerHTML = `
      <div class="shop-page">
      <h1 class="page-title">🛒 ${esc(g.name)}</h1>
      <div class="notice notice-success notice-big" role="status">
        <p><strong>✅ ${res.merged ? '加進你原本的訂單了！' : res.updated ? '訂單更新好了！' : '訂好了！'}</strong></p>
        <p>${esc(o.name)}：${o.items.map((it) => esc(it.name) + ' × ' + it.qty).join('、')}</p>
        <p>💰 共 <strong>${money(o.total)}</strong>（${o.pay === '轉帳' ? '轉帳' : p ? '取貨時付現' : '付現'}）</p>
        ${p ? `<p>📦 ${esc(pickupText(p))} 取貨</p>` : ''}
        ${p ? `<div class="addcal-row">${AddCal.button({ name: '取團購：' + g.name, location: p.location, start: p.date, end: p.date, startTime: p.startTime, endTime: p.endTime || '', dutyId: p.id, date: p.date }, '加到手機行事曆（取貨那天）')}</div>` : ''}
      </div>
      ${o.pay === '轉帳' ? `<div class="notice shop-payinfo"><p><strong>🏦 轉帳資訊</strong></p><p>${esc(o.payInfo || '請問小編轉帳帳號').replace(/\n/g, '<br>')}</p><p class="muted">${o.last5 ? `已填末五碼 ${esc(o.last5)}` : '轉好後，到「我的訂單」填轉帳末五碼，小編才對得到帳 🙏'}</p></div>` : ''}
      <p class="hint">截止前（${esc(g.deadline)}）都可以到「我的訂單」改數量或取消。</p>
      <a class="btn btn-block btn-primary" href="#/shop/orders">📋 看我的訂單</a>
      <a class="btn btn-block" href="#/shop/${encodeURIComponent(g.id)}">繼續逛</a>
      </div>
      ${tabbar('cart', g)}`;
    window.scrollTo(0, 0);
  }

  // ---------- 我的訂單 ----------

  const ORDER_TABS = [['all', '全部'], ['unpaid', '未付款'], ['topick', '待取貨'], ['done', '已完成']];
  const ordersState = { tab: 'all', data: null };

  /** 訂單狀態：已完成（取貨了）／待取貨（付了還沒取）／未付款 */
  function orderStatus(o) {
    if (o.picked) return { label: '已完成', cls: 'badge-full' };
    if (o.paid) return { label: '待取貨', cls: 'badge-ok' };
    return { label: '未付款', cls: 'badge-notice' };
  }
  const inTab = (o, tab) => tab === 'all' || (tab === 'unpaid' ? !o.paid && !o.picked : tab === 'topick' ? !o.picked : o.picked);

  async function showOrders(t) {
    const name = savedName();
    if (!name) return renderOrdersAsk('');
    root.innerHTML = '<div class="shop-page"><h1 class="page-title">📋 我的訂單</h1><p class="panel-empty">讀取中⋯</p></div>' + tabbar('orders', null);
    try {
      ordersState.data = await Api.shopMyOrders(name, true);
    } catch (err) {
      if (t !== token) return;
      return renderOrdersAsk(name, err.message);
    }
    if (t !== token) return;
    renderOrders();
  }

  function renderOrdersAsk(name, error) {
    root.innerHTML = `
      <div class="shop-page">
      <h1 class="page-title">📋 我的訂單</h1>
      ${error ? `<div class="notice notice-error" role="alert"><p>${esc(error)}</p></div>` : ''}
      <form class="mine-form" data-ask novalidate>
        <label class="field-label" for="shop-orders-name">你的名字（和下單時寫的一樣）</label>
        <div class="mine-row"><input id="shop-orders-name" class="input" autocomplete="name" placeholder="例如：王小明" value="${esc(name)}"><button type="submit" class="btn btn-primary">查詢</button></div>
      </form>
      </div>
      ${tabbar('orders', null)}`;
    root.querySelector('[data-ask]').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = root.querySelector('#shop-orders-name').value.replace(/[\s　]+/g, '');
      if (v.length < 2) return;
      saveName(v);
      showOrders(++token);
    });
  }

  function renderOrders(flash) {
    const d = ordersState.data;
    const list = d.orders.filter((o) => inTab(o, ordersState.tab));
    const unpaid = d.orders.filter((o) => !o.paid && !o.picked).reduce((n, o) => n + o.total, 0);
    const toPick = d.orders.filter((o) => !o.picked).length;
    root.innerHTML = `
      <div class="shop-page">
      <h1 class="page-title">📋 我的訂單</h1>
      <p class="muted">${esc(d.name)}・<button type="button" class="link-btn" data-switch>不是我？換名字</button></p>
      ${flash || ''}
      <div class="shop-order-tabs" role="tablist">${ORDER_TABS.map(([k, l]) => { const c = d.orders.filter((o) => inTab(o, k)).length; return `<button type="button" role="tab" class="shop-order-tab${ordersState.tab === k ? ' is-active' : ''}" aria-selected="${ordersState.tab === k}" data-otab="${k}">${l}${c ? `<b>${c}</b>` : ''}</button>`; }).join('')}</div>
      ${list.length ? `<ul class="shop-ocards">${list.map((o) => {
        const s = orderStatus(o);
        const first = o.items[0] || {};
        return `<li class="shop-ocard">
          <div class="shop-ocard-head"><strong>${esc(o.groupName || '團購')}</strong><span class="badge ${s.cls}">${s.label}</span></div>
          <div class="shop-ocard-main">
            <span class="shop-ocard-img">${first.photo ? `<img src="${esc(photoUrl(first.photo))}" alt="" loading="lazy">` : '<span class="shop-noimg" aria-hidden="true">🌿</span>'}</span>
            <div class="shop-ocard-items">${o.items.map((it) => `<p><span>${esc(it.name)}</span><span>${money(it.price)} × ${it.qty}</span></p>`).join('')}</div>
          </div>
          <p class="shop-ocard-meta">${o.pickup ? '📦 ' + esc(pickupText(o.pickup)) + ' 取貨・' : ''}${o.pay === '轉帳' ? `轉帳${o.last5 ? '（末五碼 ' + esc(o.last5) + '）' : '・還沒填末五碼'}` : '付現'}${o.paid ? '・✅ 已付款' : ''}</p>
          <p class="shop-ocard-total">應付總額 <b>${money(o.total)}</b></p>
          ${o.pay === '轉帳' && o.payInfo && !o.paid ? `<p class="shop-payinfo-small">🏦 ${esc(o.payInfo).replace(/\n/g, '<br>')}</p>` : ''}
          ${o.picked ? '' : `<div class="shop-order-actions">
            ${o.closed ? '<span class="muted">已截止，要改請找小編</span>' : `<button type="button" class="btn btn-small" data-edit="${esc(o.id)}">改數量</button><button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${esc(o.id)}">取消</button>`}
            ${o.pay === '轉帳' && !o.paid ? `<button type="button" class="btn btn-small" data-l5="${esc(o.id)}">${o.last5 ? '改末五碼' : '填轉帳末五碼'}</button>` : ''}
          </div>`}
        </li>`;
      }).join('')}</ul>` : `<div class="notice shop-empty"><p>${ordersState.tab === 'all' ? '最近 90 天沒有團購訂單' : '這裡沒有訂單'}</p></div>`}
      </div>
      <div class="shop-sumbar"><span>待取貨 <b>${toPick}</b> 張</span><span>待付總額 <b>${money(unpaid)}</b></span></div>
      ${tabbar('orders', null)}`;
    root.querySelectorAll('[data-otab]').forEach((b) => b.addEventListener('click', () => { ordersState.tab = b.dataset.otab; renderOrders(); }));
    root.querySelector('[data-switch]').addEventListener('click', () => renderOrdersAsk(''));
    const find = (id) => d.orders.find((x) => x.id === id);
    root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancelOrder(find(b.dataset.cancel))));
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editOrder(find(b.dataset.edit))));
    root.querySelectorAll('[data-l5]').forEach((b) => b.addEventListener('click', () => last5Order(find(b.dataset.l5))));
  }

  const reloadOrders = async (flash) => {
    try { ordersState.data = await Api.shopMyOrders(ordersState.data.name, true); } catch (e) { /* 用舊的 */ }
    renderOrders(flash);
  };

  async function cancelOrder(o) {
    const ok = await Confirm.open({ title: '取消這張團購訂單？', rows: [['團購', o.groupName], ['品項', o.items.map((it) => it.name + '×' + it.qty).join('、')], ['金額', money(o.total)]], confirmText: '確定取消', danger: true,
      note: o.pay === '轉帳' && o.last5 ? '已經轉帳的話，取消後請跟小編說，小編會退款給你。' : '' });
    if (!ok) return;
    Busy.show('取消中⋯');
    try {
      await Api.shopCancel(o.id, ordersState.data.name);
      Busy.hide();
      shopCache = null;
      reloadOrders(`<div class="notice notice-success" role="status"><p>已取消「${esc(o.groupName)}」的訂單${o.pay === '轉帳' && o.last5 ? '，記得跟小編說要退款喔' : ''}。</p></div>`);
    } catch (e) { Busy.hide(); renderOrders(`<div class="notice notice-error" role="alert"><p>${esc(e.message || '取消失敗')}</p></div>`); }
  }

  /** 改數量：每一樣可以加減；送出＝整張換成新的數量 */
  function editOrder(o) {
    const qty = o.items.map((it) => it.qty);
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">改數量</h2>
        <p class="modal-note">${esc(o.groupName)}</p>
        <ul class="shop-cart">${o.items.map((it, i) => `<li class="shop-cart-row"><div class="shop-cart-body"><strong>${esc(it.name)}</strong><span class="shop-cart-price">${money(it.price)}</span>
          <div class="shop-stepper shop-stepper-sm"><button type="button" class="btn shop-step-btn" data-m="${i}" aria-label="少一個">－</button><span class="shop-step-n" data-n="${i}">${it.qty}</span><button type="button" class="btn shop-step-btn" data-p="${i}" aria-label="多一個">＋</button></div></div></li>`).join('')}</ul>
        <p class="hint">要加別的商品，到商城加入購物車再結帳，會加進這張。</p>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions"><button type="submit" class="btn btn-block btn-primary">存檔</button><button type="button" class="btn btn-block" data-close>返回</button></div>
      </form>`);
    const f = m.el.querySelector('form');
    const draw = () => f.querySelectorAll('[data-n]').forEach((x) => { x.textContent = qty[Number(x.dataset.n)]; });
    f.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.m); qty[i] = Math.max(qty[i] - 1, 0); draw(); }));
    f.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.p); qty[i] = Math.min(qty[i] + 1, 99); draw(); }));
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = f.querySelector('[data-error]');
      if (!qty.some(Boolean)) { box.textContent = '全部都是 0 的話，請用「取消」'; box.hidden = false; return; }
      m.el.setAttribute('data-locked', '');
      Busy.show('存檔中⋯');
      try {
        await Api.shopOrder({ groupId: o.groupId, name: ordersState.data.name, pickupId: o.pickupId, pay: o.pay, last5: o.last5,
          items: o.items.map((it, i) => ({ id: it.id, option: it.option || '', qty: qty[i] })) });
        Busy.hide();
        m.close();
        shopCache = null;
        reloadOrders('<div class="notice notice-success" role="status"><p>數量改好了 😊</p></div>');
      } catch (e) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        box.innerHTML = `<strong>${esc(e.message || '存檔失敗')}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  function last5Order(o) {
    const m = Modal.open(`
      <form class="modal-form" novalidate>
        <h2 class="modal-title">填轉帳末五碼</h2>
        <p class="modal-note">${esc(o.groupName)}・${money(o.total)}</p>
        <input class="input" name="last5" inputmode="numeric" maxlength="5" value="${esc(o.last5 || '')}" placeholder="轉帳帳號末五碼" aria-label="轉帳末五碼">
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions"><button type="submit" class="btn btn-block btn-primary">存檔</button><button type="button" class="btn btn-block" data-close>返回</button></div>
      </form>`);
    const f = m.el.querySelector('form');
    f.elements.last5.focus();
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = f.elements.last5.value.replace(/\D/g, '');
      const box = f.querySelector('[data-error]');
      if (!/^\d{5}$/.test(v)) { box.textContent = '要 5 個數字'; box.hidden = false; return; }
      Busy.show('存檔中⋯');
      try {
        await Api.shopSetLast5(o.id, ordersState.data.name, v);
        Busy.hide();
        m.close();
        reloadOrders('<div class="notice notice-success" role="status"><p>末五碼存好了，謝謝 😊</p></div>');
      } catch (e) { Busy.hide(); box.textContent = e.message || '存檔失敗'; box.hidden = false; }
    });
  }

  // ---------- 查我的報名：🛒 我的團購（簡短版，詳細到「我的訂單」） ----------

  async function mineSection(box, name) {
    if (!box || !Fmt.feature('shop')) return;
    let data;
    try { data = await Api.shopMyOrders(name); } catch (e) { box.innerHTML = ''; return; }
    if (!data.orders.length) { box.innerHTML = ''; return; }
    saveName(data.name);
    box.innerHTML = `
      <h2 class="mine-title">🛒 ${esc(data.name)} 的團購（${data.orders.length} 張）</h2>
      <ul class="shop-orders">${data.orders.map((o) => `
        <li class="shop-order">
          <div class="shop-order-head"><strong>${esc(o.groupName)}</strong><span>${money(o.total)}</span></div>
          <p>${o.items.map((it) => esc(it.name) + ' × ' + it.qty).join('、')}</p>
          <p class="muted">${o.pickup ? '📦 ' + esc(pickupText(o.pickup)) + ' 取貨・' : ''}${o.pay === '轉帳' ? `轉帳${o.last5 ? '（末五碼 ' + esc(o.last5) + '）' : '・還沒填末五碼'}` : '付現'}${o.paid ? '・✅ 已付款' : ''}</p>
        </li>`).join('')}</ul>
      <a class="btn btn-block shop-mine-btn" href="#/shop/orders"><span class="shop-mine-icon" aria-hidden="true">📋</span><span class="shop-mine-text"><strong>我的訂單</strong><small>改數量、取消、補轉帳末五碼</small></span><span class="shop-mine-go" aria-hidden="true">›</span></a>`;
  }

  window.ShopPage = { show, checkButton, dutyNote, mineSection };
})();
