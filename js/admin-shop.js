// 管理後台：🛒 團購（#/admin/shop…，規格 0.6）。總管理者、植素（植素園工作坊）帳號可以改，唯讀只能看。
//   #/admin/shop            團購列表＋商品庫
//   #/admin/shop/new        開團（?from=ID：另存成新團購）
//   #/admin/shop/edit/ID    修改團購
//   #/admin/shop/g/ID       一次團購：總覽、📦 備貨清單、✅ 取貨名單（打勾已取貨、已付款）、幫人下單
// 規則都在伺服器（apps-script/Shop.gs），這裡只是畫面。
(function () {
  'use strict';

  const esc = Fmt.esc;
  const state = { tab: 'groups', pickup: '', q: '' }; // 列表的分頁、取貨名單選的場次、搜尋

  function canEdit() {
    const r = Api.adminWho().role;
    return r === '總管理者' || r === '植素';
  }

  const money = (n) => `${Number(n || 0).toLocaleString('zh-TW')} 元`;
  const itemsText = (items) => items.map((it) => `${it.name}×${it.qty}`).join('、');
  const pickupText = (p) => p ? `${Fmt.shortDate(p.date)}${p.startTime ? ' ' + p.startTime : ''}　${p.location || p.name}` : '（場次已拿掉）';

  function show(body, guard, sub) {
    const m = String(sub || '').match(/^shop\/(new|edit\/([^?]+)|g\/([^?]+))(?:\?from=(.+))?/);
    if (m && m[1] === 'new') return showForm(body, guard, '', m[4] ? decodeURIComponent(m[4]) : '');
    if (m && m[2]) return showForm(body, guard, decodeURIComponent(m[2]), '');
    if (m && m[3]) return showGroup(body, guard, decodeURIComponent(m[3]));
    return showList(body, guard);
  }

  // ---------- 列表：團購＋商品庫 ----------

  function showList(body, guard) {
    AdminPage.swr('shop', () => Api.admin('adminShop', {}, true), (data, stale) => renderList(body, guard, data, stale), body);
  }

  function renderList(body, guard, data, stale) {
    const edit = canEdit();
    const groupsHtml = data.groups.length ? `<ul class="shop-group-list">${data.groups.map((g) => `
      <li><a class="shop-group-card" href="#/admin/shop/g/${encodeURIComponent(g.id)}">
        <span class="shop-group-name">${esc(g.name)}</span>
        <span class="badge ${g.status === '結束' ? 'badge-full' : g.closed ? 'badge-notice' : 'badge-ok'}">${g.status === '結束' ? '已結束' : g.closed ? '已截止' : '開放中'}</span>
        <span class="shop-group-meta">截止 ${esc(g.deadline)}・${g.orders} 張訂單・${money(g.total)}<br>取貨：${g.pickups.map((p) => esc(Fmt.shortDate(p.date))).join('、') || '—'}</span>
      </a></li>`).join('')}</ul>` : '<p class="panel-empty">還沒有團購。先到「📦 商品庫」建好商品，再按「＋ 開團」。</p>';
    const productsHtml = data.products.length ? `<ul class="shop-product-list">${data.products.map((p) => `
      <li><button type="button" class="shop-product-row${p.active ? '' : ' is-inactive'}" data-product="${esc(p.id)}"${edit ? '' : ' disabled'}>
        ${p.photo ? `<img src="${esc(Api.fileUrl(p.photo))}" alt="" loading="lazy">` : '<span class="shop-noimg">🌿</span>'}
        <span><strong>${esc(p.name)}</strong><small>${money(p.price)}${p.unit ? '／' + esc(p.unit) : ''}${p.active ? '' : '・已停用'}</small></span>
      </button></li>`).join('')}</ul>` : '<p class="panel-empty">商品庫是空的，按「＋ 新增商品」。</p>';
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      <div class="seg shop-tabs">${[['groups', '🛒 團購'], ['products', '📦 商品庫']].map(([v, l]) => `<label class="seg-item"><input type="radio" name="shoptab" value="${v}"${state.tab === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      ${state.tab === 'groups' ? `
        ${edit ? '<div class="admin-actions"><a class="btn btn-primary" href="#/admin/shop/new">＋ 開團</a></div>' : ''}
        ${groupsHtml}` : `
        ${edit ? '<div class="admin-actions"><button type="button" class="btn btn-primary" data-new-product>＋ 新增商品</button></div>' : ''}
        ${productsHtml}
        <p class="hint">停用的商品不能再加進新的團購，已經開的團購不受影響。</p>`}`;
    body.querySelectorAll('input[name=shoptab]').forEach((r) => r.addEventListener('change', () => { state.tab = r.value; renderList(body, guard, data, false); }));
    const np = body.querySelector('[data-new-product]');
    if (np) np.addEventListener('click', () => editProduct(null, guard, () => showList(body, guard)));
    body.querySelectorAll('[data-product]').forEach((b) => b.addEventListener('click', () => {
      editProduct(data.products.find((p) => p.id === b.dataset.product), guard, () => showList(body, guard));
    }));
  }

  /** 照片縮小成長邊 1200px 的 JPEG，回傳 base64（不含 data: 開頭） */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('這張照片讀不出來，請換 jpg 或 png')); };
      img.src = url;
    });
  }

  function editProduct(p, guard, after) {
    const v = p || { name: '', price: '', unit: '', description: '', photo: '', active: true, order: 0 };
    let photo = v.photo || '';
    const m = Modal.open(`
      <form class="modal-form admin-form" novalidate>
        <h2 class="modal-title">${p ? '修改商品' : '新增商品'}</h2>
        <label class="form-row"><span>名稱</span><input class="input" name="name" maxlength="40" value="${esc(v.name)}" placeholder="例：手工豆腐"></label>
        <div class="shop-two">
          <label class="form-row"><span>價格（元）</span><input class="input" name="price" inputmode="numeric" maxlength="6" value="${esc(v.price)}" placeholder="例：60"></label>
          <label class="form-row"><span>單位</span><input class="input" name="unit" maxlength="6" value="${esc(v.unit)}" placeholder="例：盒、罐、包"></label>
        </div>
        <label class="form-row"><span>說明（選填）</span><textarea class="input textarea" name="description" rows="3" maxlength="300" placeholder="例：當天現做，冷藏 3 天">${esc(v.description)}</textarea></label>
        <div class="form-row"><span>照片（選填）</span>
          <div class="shop-photo" data-photo-box></div>
          <label class="btn btn-small">📷 選照片<input type="file" accept="image/*" hidden data-photo></label>
        </div>
        <label class="form-row"><span>排序（小的在前）</span><input class="input" name="order" inputmode="numeric" maxlength="4" value="${esc(v.order || 0)}"></label>
        ${p ? `<label class="check"><input type="checkbox" name="active"${v.active ? ' checked' : ''}> 啟用（取消勾選＝停用）</label>` : ''}
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const box = f.querySelector('[data-error]');
    const drawPhoto = () => {
      f.querySelector('[data-photo-box]').innerHTML = photo ? `<img src="${esc(Api.fileUrl(photo))}" alt=""><button type="button" class="link-btn" data-photo-del>拿掉照片</button>` : '<span class="muted">還沒有照片</span>';
      const del = f.querySelector('[data-photo-del]');
      if (del) del.addEventListener('click', () => { photo = ''; drawPhoto(); });
    };
    drawPhoto();
    f.querySelector('[data-photo]').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      Busy.show('上傳中⋯');
      try {
        const data = await shrinkImage(file);
        photo = (await Api.admin('adminUploadFile', { mime: 'image/jpeg', name: file.name, data })).id;
        Busy.hide();
        drawPhoto();
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); guard(e); return; }
        box.textContent = e.message || '上傳失敗';
        box.hidden = false;
      }
    });
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopSaveProduct', { product: {
          id: p ? p.id : '', name: f.elements.name.value, price: f.elements.price.value.trim(), unit: f.elements.unit.value,
          description: f.elements.description.value, photo, order: f.elements.order.value.trim(), active: f.elements.active ? f.elements.active.checked : true
        } });
        Busy.hide();
        m.close();
        AdminPage.clearMemo();
        after();
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); guard(e); return; }
        box.innerHTML = `<strong>${esc(e.message)}</strong>${(e.details || []).map((d) => '<br>' + esc(d.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  // ---------- 開團、修改團購 ----------

  async function showForm(body, guard, id, fromId) {
    if (!canEdit()) { body.innerHTML = '<p class="panel-empty">這個帳號只能看，不能開團。</p>'; return; }
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let base;
    let detail = null;
    try {
      base = await Api.admin('adminShop', {}, true);
      if (id || fromId) detail = await Api.admin('adminShopGroup', { id: id || fromId }, true);
    } catch (e) { guard(e, body); return; }
    const g = detail ? detail.group : null;
    const v = {
      name: g ? (id ? g.name : g.name + '（新）') : '', description: g ? g.description : '', deadline: g && id ? g.deadline : '',
      pickups: g && id ? g.pickupIds : [], payInfo: g ? g.payInfo : '', status: g && id ? g.status : '開放',
      items: g ? g.itemSettings : []
    };
    const setting = (pid) => v.items.find((x) => x.id === pid);
    const products = base.products.filter((p) => p.active || setting(p.id));
    // 取貨場次：植素園工作坊的出攤排前面，再來是其他活動；已經選過但不在 180 天內的也列出來
    const duties = base.duties.slice().sort((a, b) => ((b.category === '植素') - (a.category === '植素')) || (a.date < b.date ? -1 : 1));
    (g && g.pickups || []).forEach((p) => { if (!duties.some((d) => d.id === p.id)) duties.push({ id: p.id, name: p.name, date: p.date, startTime: p.startTime, location: p.location, category: p.category }); });
    body.innerHTML = `
      <p><a href="#/admin/shop">‹ 團購</a></p>
      <h2>${id ? '修改團購' : '開團'}</h2>
      <form class="admin-form shop-form" novalidate>
        <fieldset class="form-block"><legend>基本資料</legend>
          <label class="form-row"><span>名稱</span><input class="input" name="name" maxlength="40" value="${esc(v.name)}" placeholder="例：十月植素園團購"></label>
          <label class="form-row"><span>說明（選填，大家看得到）</span><textarea class="input textarea" name="description" rows="3" maxlength="500" placeholder="例：這次有新鮮的手工豆腐和果醬 🌿">${esc(v.description)}</textarea></label>
          <label class="form-row"><span>截止時間（過了就不能下單、改單）</span><input class="input" type="datetime-local" name="deadline" value="${esc(v.deadline.replace(' ', 'T'))}"></label>
          <label class="form-row"><span>付款說明（轉帳帳號等；只在下單後、我的團購顯示給轉帳的人）</span><textarea class="input textarea" name="payInfo" rows="3" maxlength="300" placeholder="例：郵局 700 帳號 0000000-0000000，戶名 ○○○；轉好請填末五碼">${esc(v.payInfo)}</textarea></label>
          ${id ? `<div class="form-row"><span>狀態</span><div class="seg">${['開放', '結束'].map((s) => `<label class="seg-item"><input type="radio" name="status" value="${s}"${v.status === s ? ' checked' : ''}><span>${s === '結束' ? '結束（大家看不到了）' : '開放'}</span></label>`).join('')}</div></div>` : ''}
        </fieldset>
        <fieldset class="form-block"><legend>取貨場次（在哪幾場可以取貨）</legend>
          ${duties.length ? `<div class="shop-pick-list">${duties.map((d) => { const on = v.pickups.indexOf(d.id) !== -1; const other = d.category !== '植素'; return `
            <label class="shop-pick${other ? ' is-other' : ''}"${other && !on ? ' hidden' : ''}><input type="checkbox" name="pickup" value="${esc(d.id)}"${on ? ' checked' : ''}>
              <span class="shop-pick-text"><span class="cat-tag cat-${esc(d.category)}">${esc(Fmt.catLabel(d.category))}</span><b>${esc(Fmt.shortDate(d.date))}${d.startTime ? ' ' + esc(d.startTime) : ''}</b> ${esc(d.name)}${d.location ? `<small>📍 ${esc(d.location)}</small>` : ''}</span></label>`; }).join('')}</div>
            ${duties.some((d) => d.category !== '植素') ? `<button type="button" class="link-btn" data-show-other>也列出其他活動（${duties.filter((d) => d.category !== '植素').length}）</button>` : ''}`
            : '<p class="muted">今天起半年內沒有活動，先到「活動管理」新增植素園出攤。</p>'}
        </fieldset>
        <fieldset class="form-block"><legend>這次賣的商品</legend>
          ${products.length ? `<div class="shop-item-list">${products.map((p) => { const s = setting(p.id); return `
            <div class="shop-item-set${s ? ' is-on' : ''}" data-item="${esc(p.id)}">
              <label class="check"><input type="checkbox" data-item-on${s ? ' checked' : ''}> <strong>${esc(p.name)}</strong><small>${money(p.price)}${p.unit ? '／' + esc(p.unit) : ''}</small></label>
              <div class="shop-three"${s ? '' : ' hidden'}>
                <label><span>這次價格</span><input class="input" data-k="price" inputmode="numeric" value="${esc(s && s.price !== '' ? s.price : '')}" placeholder="${esc(p.price)}"></label>
                <label><span>限量</span><input class="input" data-k="limit" inputmode="numeric" value="${esc(s ? s.limit : '')}"></label>
                <label><span>每人最多</span><input class="input" data-k="perPerson" inputmode="numeric" value="${esc(s ? s.perPerson : '')}"></label>
                <small class="shop-three-hint">價格空白＝照商品庫的價格；限量、每人最多空白＝不限</small>
              </div>
            </div>`; }).join('')}</div>` : '<p class="muted">商品庫是空的，先到「📦 商品庫」新增商品。</p>'}
        </fieldset>
        <div class="form-error" data-error hidden></div>
        <div class="admin-actions">
          <button type="submit" class="btn btn-primary">${id ? '存檔' : '開團'}</button>
          <a class="btn" href="${id ? '#/admin/shop/g/' + encodeURIComponent(id) : '#/admin/shop'}">返回</a>
        </div>
      </form>`;
    const f = body.querySelector('form');
    const so = f.querySelector('[data-show-other]');
    if (so) so.addEventListener('click', () => { f.querySelectorAll('.shop-pick.is-other').forEach((x) => { x.hidden = false; }); so.remove(); });
    f.querySelectorAll('[data-item-on]').forEach((c) => c.addEventListener('change', () => {
      const box = c.closest('[data-item]');
      box.classList.toggle('is-on', c.checked);
      box.querySelector('.shop-three').hidden = !c.checked;
    }));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = f.querySelector('[data-error]');
      const group = {
        id, name: f.elements.name.value, description: f.elements.description.value, deadline: f.elements.deadline.value,
        payInfo: f.elements.payInfo.value, status: f.querySelector('input[name=status]:checked') ? f.querySelector('input[name=status]:checked').value : '開放',
        pickups: [...f.querySelectorAll('input[name=pickup]:checked')].map((x) => x.value),
        items: [...f.querySelectorAll('[data-item]')].filter((x) => x.querySelector('[data-item-on]').checked).map((x) => ({
          id: x.dataset.item, price: x.querySelector('[data-k=price]').value.trim(), limit: x.querySelector('[data-k=limit]').value.trim(), perPerson: x.querySelector('[data-k=perPerson]').value.trim()
        }))
      };
      Busy.show('存檔中⋯');
      try {
        const res = await Api.admin('adminShopSaveGroup', { group });
        Busy.hide();
        AdminPage.clearMemo();
        flash = res.warnings.length ? AdminPage.notice('error', '已存檔，請注意', res.warnings.join('；')) : AdminPage.notice('success', id ? '已存檔' : '開團了 🎉', group.name);
        location.hash = '#/admin/shop/g/' + encodeURIComponent(res.id);
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { guard(e); return; }
        box.innerHTML = `<strong>${esc(e.message)}</strong>${(e.details || []).map((d) => '<br>' + esc(d.message)).join('')}`;
        box.hidden = false;
        box.scrollIntoView({ block: 'center' });
      }
    });
  }

  // ---------- 一次團購：總覽、備貨清單、取貨名單 ----------

  let flash = '';

  function showGroup(body, guard, id) {
    AdminPage.swr('shop:' + id, () => Api.admin('adminShopGroup', { id }, true), (data, stale) => renderGroup(body, guard, data, stale), body);
  }

  function prepText(d) {
    return [`🛒 ${d.group.name}　備貨清單`].concat(d.prep.map((p) => [
      '', `📦 ${pickupText(p.pickup)}（${p.orders} 張訂單，${money(p.total)}）`
    ].concat(p.items.length ? p.items.map((it) => `・${it.name} × ${it.qty}${it.unit ? ' ' + it.unit : ''}`) : ['・還沒有人訂']).join('\n'))).join('\n');
  }

  function pickText(d, pickupId) {
    const list = d.orders.filter((o) => o.status !== '已取消' && o.pickupId === pickupId);
    const p = d.group.pickups.find((x) => x.id === pickupId);
    return [`✅ ${d.group.name}　取貨名單`, pickupText(p), ''].concat(list.map((o, i) =>
      `${i + 1}. ${o.name}：${itemsText(o.items)}｜${money(o.total)}｜${o.pay === '轉帳' ? '轉帳' + (o.last5 ? '（' + o.last5 + '）' : '') : '現場付'}${o.paid ? '・已付' : ''}`)).join('\n');
  }

  async function copy(text, btn) {
    try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = '已複製 ✓'; setTimeout(() => { btn.textContent = t; }, 1500); } catch (e) { window.prompt('請複製下面的文字', text); }
  }

  function renderGroup(body, guard, d, stale) {
    const g = d.group;
    const edit = canEdit();
    if (!state.pickup || !g.pickups.some((p) => p.id === state.pickup)) state.pickup = g.pickups[0] ? g.pickups[0].id : '';
    const s = d.summary;
    const q = state.q.trim();
    const list = d.orders.filter((o) => o.pickupId === state.pickup && (!q || o.name.indexOf(q) !== -1))
      .sort((a, b) => (a.status === '已取消') - (b.status === '已取消') || (a.picked - b.picked) || (a.name < b.name ? -1 : 1));
    const orphan = d.orders.filter((o) => o.status !== '已取消' && !g.pickups.some((p) => p.id === o.pickupId));
    body.innerHTML = `
      ${AdminPage.staleNote(stale)}
      ${flash}
      <p><a href="#/admin/shop">‹ 團購</a></p>
      <h2 class="shop-title">${esc(g.name)}<span class="badge ${g.status === '結束' ? 'badge-full' : g.closed ? 'badge-notice' : 'badge-ok'}">${g.status === '結束' ? '已結束' : g.closed ? '已截止' : '開放中'}</span></h2>
      <p class="muted">截止 ${esc(g.deadline)}${g.description ? '<br>' + esc(g.description) : ''}</p>
      ${edit ? `<div class="admin-actions">
        <a class="btn" href="#/admin/shop/edit/${encodeURIComponent(g.id)}">✏️ 修改團購</a>
        <a class="btn" href="#/admin/shop/new?from=${encodeURIComponent(g.id)}">另存成新團購</a>
        <button type="button" class="btn" data-admin-order>＋ 幫人下單</button>
        ${s.orders ? '' : '<button type="button" class="btn btn-quiet-danger" data-delete>刪除這次團購</button>'}
      </div>` : ''}

      <div class="stat-cards shop-stats">
        <div class="stat-card"><span class="stat-label">訂單</span><span class="stat-num">${s.orders}</span><span class="stat-hint">已取貨 ${s.picked} 張</span></div>
        <div class="stat-card"><span class="stat-label">總金額</span><span class="stat-num">${Number(s.total).toLocaleString('zh-TW')}</span><span class="stat-hint">已付 ${money(s.paid)}<br>未付 ${money(s.unpaid)}</span></div>
      </div>
      <ul class="shop-sold">${g.items.map((it) => `<li><span>${esc(it.name)}</span><strong>${it.sold}${it.unit ? ' ' + esc(it.unit) : ''}</strong>${it.limit !== null ? `<small>${it.left ? `剩 ${it.left}` : '已售完'}／限量 ${it.limit}</small>` : ''}</li>`).join('')}</ul>

      <section class="stats-section">
        <h3 class="admin-sub">📦 備貨清單<span class="h2-sub">每一場要帶幾份</span></h3>
        ${d.prep.map((p) => `<div class="shop-prep">
          <p class="shop-prep-head"><strong>${esc(pickupText(p.pickup))}</strong><span>${p.orders} 張・${money(p.total)}</span></p>
          ${p.items.length ? `<ul>${p.items.map((it) => `<li>${esc(it.name)}<strong>× ${it.qty}${it.unit ? ' ' + esc(it.unit) : ''}</strong></li>`).join('')}</ul>` : '<p class="muted">還沒有人訂</p>'}
        </div>`).join('')}
        <button type="button" class="btn btn-small" data-copy-prep>📋 複製備貨清單</button>
      </section>

      <section class="stats-section">
        <h3 class="admin-sub">✅ 取貨名單</h3>
        ${g.pickups.length > 1 ? `<div class="seg shop-pickup-seg">${g.pickups.map((p) => `<label class="seg-item"><input type="radio" name="pk" value="${esc(p.id)}"${p.id === state.pickup ? ' checked' : ''}><span>${esc(Fmt.shortDate(p.date))}</span></label>`).join('')}</div>` : ''}
        <p class="muted">${esc(pickupText(g.pickups.find((p) => p.id === state.pickup)))}</p>
        <input class="input" type="search" data-q placeholder="🔍 找名字" value="${esc(state.q)}">
        ${list.length ? `<ul class="shop-orders">${list.map((o) => `
          <li class="shop-order${o.status === '已取消' ? ' is-cancelled' : o.picked ? ' is-picked' : ''}">
            <div class="shop-order-head"><strong>${esc(o.name)}</strong><span>${money(o.total)}</span></div>
            <p>${esc(itemsText(o.items))}</p>
            <p class="muted">${o.pay === '轉帳' ? `轉帳${o.last5 ? '・末五碼 ' + esc(o.last5) : '・還沒填末五碼'}` : '取貨付現'}${o.note ? '・' + esc(o.note) : ''}${o.status === '已取消' ? '・已取消' : ''}</p>
            ${o.status === '已取消' ? (edit ? `<button type="button" class="btn btn-small" data-restore="${esc(o.id)}">恢復這張訂單</button>` : '') : `
            <div class="shop-order-actions">
              <label class="check"><input type="checkbox" data-picked="${esc(o.id)}"${o.picked ? ' checked' : ''}${edit ? '' : ' disabled'}> 已取貨</label>
              <label class="check"><input type="checkbox" data-paid="${esc(o.id)}"${o.paid ? ' checked' : ''}${edit ? '' : ' disabled'}> 已付款</label>
              ${edit ? `<button type="button" class="link-btn" data-edit-order="${esc(o.id)}">改單</button><button type="button" class="link-btn" data-note="${esc(o.id)}">備註</button><button type="button" class="link-btn" data-cancel="${esc(o.id)}">取消</button>` : ''}
            </div>`}
          </li>`).join('')}</ul>` : '<p class="panel-empty">這一場還沒有訂單</p>'}
        ${state.pickup ? '<button type="button" class="btn btn-small" data-copy-pick>📋 複製這場的取貨名單</button>' : ''}
        ${orphan.length ? `<div class="notice notice-error"><p>有 ${orphan.length} 張訂單的取貨場次已經拿掉了：${orphan.map((o) => esc(o.name)).join('、')}，請幫他們「改單」換場次。</p></div>` : ''}
      </section>`;
    flash = '';
    const reload = () => { AdminPage.clearMemo(); showGroup(body, guard, g.id); };
    const set = async (orderId, change, label) => {
      Busy.show(label + '⋯');
      try { await Api.admin('adminShopOrderSet', Object.assign({ orderId }, change)); Busy.hide(); reload(); } catch (e) {
        Busy.hide();
        if (!guard(e)) { flash = AdminPage.notice('error', e.message, (e.details || []).map((x) => x.message).join('；')); reload(); }
      }
    };
    body.querySelectorAll('input[name=pk]').forEach((r) => r.addEventListener('change', () => { state.pickup = r.value; renderGroup(body, guard, d, false); }));
    const qi = body.querySelector('[data-q]');
    qi.addEventListener('input', () => { state.q = qi.value; renderGroup(body, guard, d, false); const n = body.querySelector('[data-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    body.querySelector('[data-copy-prep]').addEventListener('click', (ev) => copy(prepText(d), ev.target));
    const cp = body.querySelector('[data-copy-pick]');
    if (cp) cp.addEventListener('click', (ev) => copy(pickText(d, state.pickup), ev.target));
    body.querySelectorAll('[data-picked]').forEach((c) => c.addEventListener('change', () => set(c.dataset.picked, { picked: c.checked }, '存檔中')));
    body.querySelectorAll('[data-paid]').forEach((c) => c.addEventListener('change', () => set(c.dataset.paid, { paid: c.checked }, '存檔中')));
    body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => set(b.dataset.restore, { cancel: false }, '恢復中')));
    body.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      const o = d.orders.find((x) => x.id === b.dataset.cancel);
      const ok = await Confirm.open({ title: '取消這張訂單？', rows: [['姓名', o.name], ['品項', itemsText(o.items)], ['金額', money(o.total)]], confirmText: '確定取消', danger: true,
        note: o.pay === '轉帳' && o.last5 ? '這張已經轉帳了，記得退款給他。' : '' });
      if (ok) set(o.id, { cancel: true }, '取消中');
    }));
    body.querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', () => {
      const o = d.orders.find((x) => x.id === b.dataset.note);
      const v = window.prompt('備註（只有後台看得到，最多 100 字）', o.note || '');
      if (v !== null) set(o.id, { note: v }, '存檔中');
    }));
    body.querySelectorAll('[data-edit-order]').forEach((b) => b.addEventListener('click', () => orderForm(d, d.orders.find((x) => x.id === b.dataset.editOrder), guard, reload)));
    const ao = body.querySelector('[data-admin-order]');
    if (ao) ao.addEventListener('click', () => orderForm(d, null, guard, reload));
    const del = body.querySelector('[data-delete]');
    if (del) del.addEventListener('click', async () => {
      const ok = await Confirm.open({ title: '刪除這次團購？', rows: [['名稱', g.name]], confirmText: '確定刪除', danger: true });
      if (!ok) return;
      Busy.show('刪除中⋯');
      try { await Api.admin('adminShopDeleteGroup', { id: g.id }); Busy.hide(); AdminPage.clearMemo(); location.hash = '#/admin/shop'; } catch (e) { Busy.hide(); if (!guard(e)) { flash = AdminPage.notice('error', e.message); reload(); } }
    });
  }

  /** 管理者幫人下單、改單（不受截止限制；限量、每人上限照樣檢查） */
  function orderForm(d, o, guard, after) {
    const g = d.group;
    const qty = (id) => { const it = o && o.items.find((x) => x.id === id); return it ? it.qty : 0; };
    const m = Modal.open(`
      <form class="modal-form admin-form" novalidate>
        <h2 class="modal-title">${o ? '改單：' + esc(o.name) : '幫人下單'}</h2>
        ${o ? '' : `<label class="form-row"><span>名字</span><input class="input" name="name" maxlength="20" autocomplete="off"></label>
        <label class="form-row"><span>第一次來的話：怎麼認識的？（名單上有的人不用選）</span><select class="input" name="source"><option value="">（名單上有，不用選）</option>${(window.SITE.sources || []).map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
        <label class="form-row" data-ref hidden><span>介紹人</span><input class="input" name="referrer" maxlength="20"></label>`}
        <label class="form-row"><span>取貨場次</span><select class="input" name="pickup">${g.pickups.map((p) => `<option value="${esc(p.id)}"${o && o.pickupId === p.id ? ' selected' : ''}>${esc(pickupText(p))}</option>`).join('')}</select></label>
        <div class="form-row"><span>數量</span><div class="shop-qty-list">${g.items.map((it) => `<label class="shop-qty-row"><span>${esc(it.name)}<small>${money(it.price)}${it.left !== null ? `・剩 ${it.left + qty(it.id)}` : ''}</small></span><input class="input" type="number" min="0" max="99" data-qty="${esc(it.id)}" value="${qty(it.id)}"></label>`).join('')}</div></div>
        <div class="form-row"><span>付款</span><div class="seg">${[['現場', '取貨付現'], ['轉帳', '轉帳']].map(([v, l]) => `<label class="seg-item"><input type="radio" name="pay" value="${v}"${(o ? o.pay : '現場') === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
        <label class="form-row"><span>轉帳末五碼（選填）</span><input class="input" name="last5" inputmode="numeric" maxlength="5" value="${esc(o ? o.last5 : '')}"></label>
        <label class="form-row"><span>備註（只有後台看得到）</span><input class="input" name="note" maxlength="100" value="${esc(o ? o.note : '')}" placeholder="例：電話訂的"></label>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">${o ? '存檔' : '下單'}</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    if (f.elements.source) f.elements.source.addEventListener('change', () => { f.querySelector('[data-ref]').hidden = f.elements.source.value !== '朋友介紹'; });
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const box = f.querySelector('[data-error]');
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopOrder', {
          groupId: g.id, orderId: o ? o.id : '', name: o ? o.name : f.elements.name.value,
          source: f.elements.source ? f.elements.source.value : '', referrer: f.elements.referrer ? f.elements.referrer.value : '',
          pickupId: f.elements.pickup.value, items: [...f.querySelectorAll('[data-qty]')].map((x) => ({ id: x.dataset.qty, qty: x.value || 0 })),
          pay: f.querySelector('input[name=pay]:checked').value, last5: f.elements.last5.value.trim(), note: f.elements.note.value
        });
        Busy.hide();
        m.close();
        after();
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); guard(e); return; }
        box.innerHTML = `<strong>${esc(e.message)}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  window.ShopAdminPage = { show };
})();
