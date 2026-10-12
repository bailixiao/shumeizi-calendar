// 管理後台：團購庫存的報表與工具（規格 0.6「照植素園成本表單加的功能」）。
//   #/admin/shop/report        進銷存報表（選期間；加權平均成本、毛利、毛利率；下載 CSV）
//   #/admin/shop/stall         出攤銷售統計表：選一場活動
//   #/admin/shop/stall/<ID>    那場的售前、預購、現場、營業額、售後應有／實際（盤盈盤虧）
//   #/admin/shop/import        匯入 Excel（貼上「1-產品代號」「2-日報表」）
// 規則都在伺服器（apps-script/Stock.gs），這裡只是畫面。
window.AdminStock = (function () {
  'use strict';

  const esc = Fmt.esc;
  const money = (n) => `${Number(n || 0).toLocaleString('zh-TW')}`;
  const canEdit = () => { const r = Api.adminWho().role; return r === '總管理者' || r === '植素'; };
  const back = '<a class="btn back-btn" href="#/admin/shop">‹ 回團購</a>';

  /** 下載 CSV（加 BOM，Excel 打開中文才不會亂碼） */
  function downloadCsv(name, rows) {
    const csv = rows.map((r) => r.map((v) => { const s = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- 進銷存報表 ----------

  const repState = { from: '', to: '' };

  async function report(body, guard) {
    const today = Fmt.toDateStr ? Fmt.toDateStr(new Date()) : new Date().toISOString().slice(0, 10);
    if (!repState.from) { repState.from = today.slice(0, 4) + '-01-01'; repState.to = today; }
    body.innerHTML = `${back}<h2>📊 進銷存報表</h2><p class="panel-empty">計算中⋯</p>`;
    let d;
    try { d = await Api.admin('adminShopStockReport', { from: repState.from, to: repState.to }, true); } catch (e) { guard(e, body); return; }
    const cell = (o, withPrice) => `<td class="num">${o.qty}</td>${withPrice ? `<td class="num">${money(o.price)}</td>` : ''}<td class="num">${money(o.amount)}</td>`;
    body.innerHTML = `
      ${back}
      <h2>📊 進銷存報表</h2>
      <form class="stock-range" novalidate>
        <label>從 <input class="input" type="date" name="from" value="${esc(d.from)}"></label>
        <label>到 <input class="input" type="date" name="to" value="${esc(d.to)}"></label>
        <button type="submit" class="btn btn-primary">查詢</button>
        <button type="button" class="btn" data-csv>⬇️ 下載 Excel（CSV）</button>
      </form>
      <div class="stat-cards stock-sum">
        <div class="stat-card"><span class="stat-label">銷貨金額</span><span class="stat-num">${money(d.total.sale.amount)}</span><span class="stat-hint">${d.total.sale.qty} 件</span></div>
        <div class="stat-card"><span class="stat-label">銷貨成本</span><span class="stat-num">${money(d.total.saleCost.amount)}</span><span class="stat-hint">用平均成本算</span></div>
        <div class="stat-card"><span class="stat-label">毛利</span><span class="stat-num">${money(d.profit)}</span><span class="stat-hint">毛利率 ${Math.round(d.margin * 1000) / 10}%</span></div>
        <div class="stat-card"><span class="stat-label">期末存貨</span><span class="stat-num">${money(d.total.end.amount)}</span><span class="stat-hint">${d.total.end.qty} 件</span></div>
      </div>
      ${d.rows.length ? `<div class="stock-table-wrap"><table class="stock-table">
        <thead>
          <tr><th rowspan="2">代號</th><th rowspan="2">品項</th><th colspan="3">期初存貨</th><th colspan="3">本期進貨</th><th colspan="2">其他：加</th><th colspan="2">其他：減</th><th colspan="3">本期銷貨（平均成本）</th><th colspan="3">本期銷貨（售價）</th><th colspan="3">期末存貨</th></tr>
          <tr><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>金額</th><th>數量</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th></tr>
        </thead>
        <tbody>${d.rows.map((r) => `<tr><td>${esc(r.code)}</td><td class="name">${esc(r.name)}</td>${cell(r.open, true)}${cell(r.buy, true)}${cell(r.add)}${cell(r.sub)}${cell(r.saleCost, true)}${cell(r.sale, true)}${cell(r.end, true)}</tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>合計</td><td class="num">${d.total.open.qty}</td><td></td><td class="num">${money(d.total.open.amount)}</td><td class="num">${d.total.buy.qty}</td><td></td><td class="num">${money(d.total.buy.amount)}</td><td class="num">${d.total.add.qty}</td><td class="num">${money(d.total.add.amount)}</td><td class="num">${d.total.sub.qty}</td><td class="num">${money(d.total.sub.amount)}</td><td class="num">${d.total.saleCost.qty}</td><td></td><td class="num">${money(d.total.saleCost.amount)}</td><td class="num">${d.total.sale.qty}</td><td></td><td class="num">${money(d.total.sale.amount)}</td><td class="num">${d.total.end.qty}</td><td></td><td class="num">${money(d.total.end.amount)}</td></tr></tfoot>
      </table></div>` : '<p class="panel-empty">這段期間沒有進出紀錄。</p>'}
      <p class="hint">平均成本＝（期初金額＋進貨金額＋其他加金額－其他減金額）÷（期初數量＋進貨數量＋其他加數量－其他減數量），和「植素園成本表單」一樣。毛利只是賣商品賺的，不含攤位費、包材等費用。</p>`;
    const f = body.querySelector('form');
    f.addEventListener('submit', (ev) => { ev.preventDefault(); repState.from = f.elements.from.value; repState.to = f.elements.to.value; report(body, guard); });
    body.querySelector('[data-csv]').addEventListener('click', () => {
      const head = [['產品代號', '品項', '期初數量', '期初單價', '期初金額', '進貨數量', '進貨單價', '進貨金額', '其他加數量', '其他加金額', '其他減數量', '其他減金額', '銷貨數量', '平均成本', '銷貨成本', '銷貨售價單價', '銷貨售價金額', '期末數量', '期末單價', '期末金額']];
      const rows = d.rows.map((r) => [r.code, r.name, r.open.qty, r.open.price, r.open.amount, r.buy.qty, r.buy.price, r.buy.amount, r.add.qty, r.add.amount, r.sub.qty, r.sub.amount, r.saleCost.qty, r.saleCost.price, r.saleCost.amount, r.sale.price, r.sale.amount, r.end.qty, r.end.price, r.end.amount]);
      const foot = [['', '合計', d.total.open.qty, '', d.total.open.amount, d.total.buy.qty, '', d.total.buy.amount, d.total.add.qty, d.total.add.amount, d.total.sub.qty, d.total.sub.amount, d.total.saleCost.qty, '', d.total.saleCost.amount, '', d.total.sale.amount, d.total.end.qty, '', d.total.end.amount],
        [], ['', '毛利', d.profit], ['', '毛利率', Math.round(d.margin * 1000) / 10 + '%']];
      downloadCsv(`植素園進銷存_${d.from}_${d.to}.csv`, head.concat(rows, foot));
    });
  }

  // ---------- 出攤銷售統計表 ----------

  async function stall(body, guard, dutyId) {
    body.innerHTML = `${back}<h2>🧾 出攤銷售統計表</h2><p class="panel-empty">載入中⋯</p>`;
    let d;
    try { d = await Api.admin('adminShopStall', { dutyId: dutyId || '' }, true); } catch (e) { guard(e, body); return; }
    if (!dutyId) {
      body.innerHTML = `
        ${back}
        <h2>🧾 出攤銷售統計表</h2>
        <p class="hint">選一場出攤（前 4 個月到後 1 個月的活動，植素園的在前面）：</p>
        ${d.duties.length ? `<ul class="shop-group-list">${d.duties.map((x) => `<li><a class="shop-group-card" href="#/admin/shop/stall/${encodeURIComponent(x.id)}">
          <span class="shop-group-name">${esc(Fmt.shortDate(x.date))} ${esc(x.name)}</span>
          <span class="shop-group-meta">${esc(Fmt.catLabel(x.category))}${x.location ? '・' + esc(x.location) : ''}${x.date > d.today ? '・還沒到' : ''}</span></a></li>`).join('')}</ul>` : '<p class="panel-empty">最近沒有活動。</p>'}`;
      return;
    }
    const edit = canEdit();
    const st = d.rows.map((r) => ({ onsite: r.onsite ? String(r.onsite) : '', price: String(r.price), actual: r.actual === null ? '' : String(r.actual), note: r.note }));
    const draw = (flash) => {
      const calc = d.rows.map((r, i) => {
        const on = Number(st[i].onsite) || 0;
        const price = Number(st[i].price) || 0;
        return { expected: r.before - r.pre - on, revenue: (r.revenue - r.onsite * r.price) + on * price, on };
      });
      body.innerHTML = `
        ${back}
        <h2>🧾 出攤銷售統計表</h2>
        ${flash || ''}
        <dl class="detail-info">
          <div><dt>日期</dt><dd>${esc(Fmt.rocDate(d.duty.date))}${d.duty.startTime ? ' ' + esc(d.duty.startTime) : ''}</dd></div>
          <div><dt>地點</dt><dd>${esc(d.duty.location || '—')}</dd></div>
          <div><dt>事由</dt><dd>${esc(d.duty.name)}</dd></div>
        </dl>
        <form class="stall-form" novalidate>
          <div class="stock-table-wrap"><table class="stock-table stall-table">
            <thead><tr><th rowspan="2">代號</th><th rowspan="2">品名</th><th rowspan="2">售前<br>數量</th><th colspan="2">銷售數量</th><th rowspan="2">單價</th><th rowspan="2">營業額</th><th rowspan="2">售後<br>應有</th><th rowspan="2">售後<br>實際</th><th rowspan="2">備註</th></tr>
              <tr><th>預購</th><th>現場</th></tr></thead>
            <tbody>${d.rows.map((r, i) => `<tr>
              <td>${esc(r.code)}</td><td class="name">${esc(r.name)}</td><td class="num">${r.before}</td><td class="num">${r.pre || ''}</td>
              <td><input class="input stall-in" inputmode="numeric" data-k="onsite" data-i="${i}" value="${esc(st[i].onsite)}"${edit ? '' : ' disabled'}></td>
              <td><input class="input stall-in" inputmode="numeric" data-k="price" data-i="${i}" value="${esc(st[i].price)}"${edit ? '' : ' disabled'}></td>
              <td class="num" data-rev="${i}">${money(calc[i].revenue)}</td>
              <td class="num" data-exp="${i}">${calc[i].expected}</td>
              <td><input class="input stall-in${st[i].actual !== '' && Number(st[i].actual) !== calc[i].expected ? ' is-diff' : ''}" inputmode="numeric" data-k="actual" data-i="${i}" value="${esc(st[i].actual)}" placeholder="點完填"${edit ? '' : ' disabled'}></td>
              <td><input class="input stall-note" data-k="note" data-i="${i}" maxlength="100" value="${esc(st[i].note)}"${edit ? '' : ' disabled'}></td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td></td><td>合計</td><td></td><td class="num">${d.total.pre}</td><td class="num" data-tot-on>${calc.reduce((n, c) => n + c.on, 0)}</td><td></td><td class="num" data-tot-rev>${money(calc.reduce((n, c) => n + c.revenue, 0))}</td><td colspan="3"></td></tr></tfoot>
          </table></div>
          <p class="hint">預購＝這場取貨、已打勾「已取貨」的團購訂單（自動帶入）。現場＝這次現場賣幾個。「售後實際」是收攤時點的數量：和應有不一樣，存檔時會自動記盤盈或盤虧；空白＝不盤點。同一場再存一次，會把上次的現場、盤點換掉。</p>
          ${edit ? '<div class="admin-actions"><button type="submit" class="btn btn-primary">存檔</button></div>' : ''}
          <div class="admin-actions"><button type="button" class="btn" data-csv>⬇️ 下載 Excel（CSV）</button><a class="btn" href="#/admin/shop/stall">換一場</a></div>
        </form>`;
      const f = body.querySelector('form');
      f.querySelectorAll('[data-k]').forEach((x) => x.addEventListener('input', () => {
        st[Number(x.dataset.i)][x.dataset.k] = x.value;
        if (x.dataset.k === 'note') return;
        // 只更新算出來的格子，不重畫（打字游標才不會跑掉）
        const i = Number(x.dataset.i);
        const r = d.rows[i];
        const on = Number(st[i].onsite) || 0;
        const exp = r.before - r.pre - on;
        f.querySelector(`[data-exp="${i}"]`).textContent = exp;
        f.querySelector(`[data-rev="${i}"]`).textContent = money((r.revenue - r.onsite * r.price) + on * (Number(st[i].price) || 0));
        const act = f.querySelector(`[data-k="actual"][data-i="${i}"]`);
        act.classList.toggle('is-diff', st[i].actual !== '' && Number(st[i].actual) !== exp);
        let ton = 0, trev = 0;
        d.rows.forEach((y, k) => { const o = Number(st[k].onsite) || 0; ton += o; trev += (y.revenue - y.onsite * y.price) + o * (Number(st[k].price) || 0); });
        f.querySelector('[data-tot-on]').textContent = ton;
        f.querySelector('[data-tot-rev]').textContent = money(trev);
      }));
      f.querySelector('[data-csv]').addEventListener('click', () => {
        const head = [[`【植素園】日銷售統計表`, '', '日期', d.duty.date, '', '地點', d.duty.location, '', '事由', d.duty.name], ['產品代號', '品名規格', '售前數量', '預購', '現場', '單價', '營業額', '售後應有數量', '售後實際數量', '備註']];
        const rows = d.rows.map((r, i) => { const on = Number(st[i].onsite) || 0; const price = Number(st[i].price) || 0; return [r.code, r.name, r.before, r.pre, on, price, (r.revenue - r.onsite * r.price) + on * price, r.before - r.pre - on, st[i].actual, st[i].note]; });
        downloadCsv(`植素園出攤銷售_${d.duty.date}.csv`, head.concat(rows));
      });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        Busy.show('存檔中⋯');
        try {
          await Api.admin('adminShopStallSave', { dutyId, rows: d.rows.map((r, i) => ({ id: r.id, onsite: st[i].onsite || 0, price: st[i].price, actual: st[i].actual, note: st[i].note })) });
          Busy.hide();
          AdminPage.clearMemo();
          d = await Api.admin('adminShopStall', { dutyId }, true);
          d.rows.forEach((r, i) => { st[i] = { onsite: r.onsite ? String(r.onsite) : '', price: String(r.price), actual: r.actual === null ? '' : String(r.actual), note: r.note }; });
          draw(AdminPage.notice('success', '存好了', '現場賣的記成「售出」，盤點的差記成盤盈、盤虧。'));
        } catch (e) {
          Busy.hide();
          if (e.code === 'UNAUTHORIZED') { guard(e); return; }
          draw(AdminPage.notice('error', e.message || '存檔失敗', (e.details || []).map((x) => x.message).join('；')));
        }
      });
    };
    draw();
  }

  // ---------- 匯入 Excel ----------

  /** 貼上的格子（Tab 分隔）→ 二維陣列；略過表頭 */
  function parseTsv(text, headWord) {
    return String(text || '').split(/\r?\n/).map((l) => l.split('\t').map((c) => c.trim())).filter((r) => r.some(Boolean) && r[0] !== headWord);
  }

  function importPage(body, guard) {
    if (!canEdit()) { body.innerHTML = `${back}<p class="panel-empty">這個帳號只能看。</p>`; return; }
    body.innerHTML = `
      ${back}
      <h2>📥 匯入 Excel（植素園成本表單）</h2>
      <form class="admin-form" novalidate>
        <fieldset class="form-block"><legend>1. 產品代號（選填）</legend>
          <p class="hint">在 Excel 的「1-產品代號」選 A、B 兩欄（產品代號、品名規格）的格子，複製，貼在下面。</p>
          <textarea class="input textarea" name="products" rows="5" placeholder="A001	肉骨茶-XX克"></textarea>
        </fieldset>
        <fieldset class="form-block"><legend>2. 日報表</legend>
          <p class="hint">在「2-日報表」選 A～I 欄（日期、分類、產品代號、品名規格、單位、數量、單價、金額、備註）有資料的格子，複製，貼在下面。民國日期（114/10/20）會自動換算；分類：初存、進貨、銷貨、其他：加、其他：減。</p>
          <textarea class="input textarea" name="rows" rows="8" placeholder="114/10/20	初存	A001	肉骨茶-XX克	包	6	100	600"></textarea>
        </fieldset>
        <p class="hint" data-preview></p>
        <div class="form-error" data-error hidden></div>
        <div class="admin-actions"><button type="submit" class="btn btn-primary">匯入</button><a class="btn" href="#/admin/shop">返回</a></div>
      </form>`;
    const f = body.querySelector('form');
    const read = () => ({
      products: parseTsv(f.elements.products.value, '產品代號').filter((r) => r[0] && r[1]).map((r) => ({ code: r[0], name: r[1] })),
      rows: parseTsv(f.elements.rows.value, '日期').map((r) => ({ date: r[0], kind: r[1], code: r[2], name: r[3], unit: r[4], qty: r[5], price: r[6], amount: r[7], note: r[8] || '' }))
        .filter((r) => r.code && r.date && !/^#/.test(r.name || ''))
    });
    const preview = () => { const v = read(); f.querySelector('[data-preview]').textContent = v.products.length || v.rows.length ? `看到 ${v.products.length} 個產品代號、${v.rows.length} 列日報表。` : ''; };
    f.elements.products.addEventListener('input', preview);
    f.elements.rows.addEventListener('input', preview);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = read();
      const box = f.querySelector('[data-error]');
      if (!v.products.length && !v.rows.length) { box.textContent = '請先貼上 Excel 的格子'; box.hidden = false; return; }
      Busy.show('匯入中⋯');
      try {
        const r = await Api.admin('adminShopStockImport', v);
        Busy.hide();
        AdminPage.clearMemo();
        body.innerHTML = `${back}<h2>📥 匯入 Excel</h2>${AdminPage.notice('success', '匯入好了', `${r.records} 筆進出紀錄、新增 ${r.created.length} 樣商品`)}
          ${r.created.length ? `<p>新增的商品：${esc(r.created.join('、'))}</p>` : ''}
          ${r.skipped.length ? `<details><summary>跳過 ${r.skipped.length} 列（已經匯入過、或格子不完整）</summary><p class="muted">${esc(r.skipped.join('、'))}</p></details>` : ''}
          <div class="admin-actions"><a class="btn btn-primary" href="#/admin/shop">看庫存</a><a class="btn" href="#/admin/shop/report">看進銷存報表</a></div>`;
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { guard(e); return; }
        box.textContent = e.message || '匯入失敗';
        box.hidden = false;
      }
    });
  }

  // ---------- 記帳 ----------

  const ledState = { from: '', to: '' };

  /** 照片縮小成 jpg（base64），收據用 */
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
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

  async function ledger(body, guard) {
    const today = Fmt.toDateStr(new Date());
    if (!ledState.from) { ledState.from = today.slice(0, 8) + '01'; ledState.to = today; }
    body.innerHTML = `${back}<h2>💰 記帳</h2><p class="panel-empty">載入中⋯</p>`;
    let d;
    try { d = await Api.admin('adminShopLedger', { from: ledState.from, to: ledState.to }, true); } catch (e) { guard(e, body); return; }
    const edit = canEdit();
    const reload = () => { AdminPage.clearMemo(); ledger(body, guard); };
    body.innerHTML = `
      ${back}
      <h2>💰 記帳</h2>
      <p class="hint">記跟商品無關的錢：攤位費、包材、印刷、運費⋯（支出），佈施、利息⋯（收入）。商品的進貨、賣出在「庫存」記。</p>
      ${edit ? '<div class="stock-actions ledger-actions"><button type="button" class="btn stock-btn is-out" data-new="支出">➖ 記一筆支出</button><button type="button" class="btn stock-btn is-in" data-new="收入">➕ 記一筆收入</button></div>' : ''}
      <form class="stock-range" novalidate>
        <label>從 <input class="input" type="date" name="from" value="${esc(d.from)}"></label>
        <label>到 <input class="input" type="date" name="to" value="${esc(d.to)}"></label>
        <button type="submit" class="btn btn-primary">查詢</button>
        <button type="button" class="btn" data-csv>⬇️ 下載 Excel（CSV）</button>
      </form>
      <div class="stat-cards stock-sum">
        <div class="stat-card"><span class="stat-label">商品毛利</span><span class="stat-num">${money(d.profit)}</span><span class="stat-hint">銷貨 ${money(d.sales)}－成本 ${money(d.salesCost)}</span></div>
        <div class="stat-card"><span class="stat-label">其他收入</span><span class="stat-num">${money(d.income)}</span><span class="stat-hint">佈施、利息⋯</span></div>
        <div class="stat-card"><span class="stat-label">支出</span><span class="stat-num">${money(d.expense)}</span><span class="stat-hint">攤位費、包材⋯</span></div>
        <div class="stat-card ledger-net${d.net < 0 ? ' is-neg' : ''}"><span class="stat-label">淨利</span><span class="stat-num">${money(d.net)}</span><span class="stat-hint">毛利＋收入－支出</span></div>
      </div>
      ${d.categories.length ? `<div class="ledger-cats">${d.categories.map((c) => `<span class="ledger-cat ${c.type === '收入' ? 'is-in' : 'is-out'}">${esc(c.category)} <b>${c.type === '收入' ? '+' : '−'}${money(c.amount)}</b></span>`).join('')}</div>` : ''}
      ${d.entries.length ? `<ul class="stock-recs">${d.entries.map((e) => `
        <li class="stock-rec">
          <span class="stock-rec-type ${e.type === '收入' ? 'is-in' : 'is-out'}">${e.type === '收入' ? '收' : '支'}</span>
          <div class="stock-rec-main">
            <p><strong>${esc(e.category)}</strong><span class="stock-rec-qty ${e.type === '收入' ? 'is-in' : 'is-out'}">${e.type === '收入' ? '+' : '−'}${money(e.amount)}</span></p>
            <p class="muted">${esc(e.date)}${e.by ? '・' + esc(e.by) : ''}</p>
            ${e.note ? `<p class="stock-rec-note">${esc(e.note)}</p>` : ''}
            ${e.receipt ? `<button type="button" class="btn btn-small" data-receipt="${esc(e.receipt)}">🧾 看收據</button>` : ''}
          </div>
          ${edit ? `<span class="ledger-acts"><button type="button" class="btn btn-small" data-edit="${esc(e.id)}">修改</button><button type="button" class="btn btn-small btn-quiet-danger" data-del="${esc(e.id)}">刪除</button></span>` : ''}
        </li>`).join('')}</ul>` : '<p class="panel-empty">這段期間還沒有記帳。</p>'}
      <p class="hint">淨利＝商品毛利（進銷存報表同一段期間）＋其他收入－支出。</p>`;
    const f = body.querySelector('form.stock-range');
    f.addEventListener('submit', (ev) => { ev.preventDefault(); ledState.from = f.elements.from.value; ledState.to = f.elements.to.value; ledger(body, guard); });
    body.querySelector('[data-csv]').addEventListener('click', () => {
      const rows = [['日期', '收入／支出', '類別', '金額', '備註', '記錄的人']].concat(d.entries.slice().reverse().map((e) => [e.date, e.type, e.category, e.type === '收入' ? e.amount : -e.amount, e.note, e.by]),
        [[], ['', '商品毛利', '', d.profit], ['', '其他收入', '', d.income], ['', '支出', '', -d.expense], ['', '淨利', '', d.net]]);
      downloadCsv(`植素園記帳_${d.from}_${d.to}.csv`, rows);
    });
    body.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', () => Modal.image(Api.fileUrl(b.dataset.receipt), '收據')));
    body.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => entryForm(null, b.dataset.new, d, guard, reload)));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { const e = d.entries.find((x) => x.id === b.dataset.edit); entryForm(e, e.type, d, guard, reload); }));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const e = d.entries.find((x) => x.id === b.dataset.del);
      if (!(await Confirm.open({ title: '刪除這筆？', rows: [['日期', e.date], [e.type, `${e.category} ${money(e.amount)} 元`]], confirmText: '刪除', danger: true }))) return;
      Busy.show('刪除中⋯');
      try { await Api.admin('adminShopLedgerDelete', { id: e.id }); Busy.hide(); reload(); } catch (err) { Busy.hide(); if (!guard(err)) alert(err.message || '刪除失敗'); }
    }));
  }

  /** 記一筆／修改：日期、收入／支出、類別、金額、備註、收據照片 */
  function entryForm(e, type, d, guard, after) {
    const v = e || { date: d.today, type, category: '', amount: '', note: '', receipt: '' };
    let receipt = v.receipt || '';
    let kind = v.type;
    const m = Modal.open(`
      <form class="modal-form admin-form" novalidate>
        <h2 class="modal-title">${e ? '修改' : '記一筆'}</h2>
        <div class="seg">${['支出', '收入'].map((t) => `<label class="seg-item"><input type="radio" name="type" value="${t}"${kind === t ? ' checked' : ''}><span>${t === '支出' ? '➖ 支出' : '➕ 收入'}</span></label>`).join('')}</div>
        <label class="form-row"><span>日期</span><input class="input" type="date" name="date" max="${esc(d.today)}" value="${esc(v.date)}"></label>
        <div class="form-row"><span>類別</span><div class="pos-chips" data-cats></div><input class="input" name="category" maxlength="20" value="${esc(v.category)}" placeholder="選上面的，或自己打"></div>
        <label class="form-row"><span>金額（元）</span><input class="input" name="amount" inputmode="numeric" maxlength="7" value="${esc(v.amount)}" placeholder="例：300"></label>
        <label class="form-row"><span>備註（選填）</span><input class="input" name="note" maxlength="200" value="${esc(v.note)}" placeholder="例：宏宗聖堂出攤攤位費"></label>
        <div class="form-row"><span>收據照片（選填）</span><div data-receipt-box></div><label class="btn btn-small">📷 拍照／選照片<input type="file" accept="image/*" hidden data-file></label></div>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const box = f.querySelector('[data-error]');
    const drawCats = () => {
      f.querySelector('[data-cats]').innerHTML = (d.categoryOptions[kind] || []).map((c) => `<button type="button" class="pos-chip${f.elements.category.value === c ? ' is-checked' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      f.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { f.elements.category.value = b.dataset.cat; drawCats(); }));
    };
    const drawReceipt = () => {
      f.querySelector('[data-receipt-box]').innerHTML = receipt ? `<button type="button" class="shop-thumb shop-thumb-big" data-zoom><img src="${esc(Api.fileUrl(receipt))}" alt="收據"></button><button type="button" class="link-btn" data-receipt-del>拿掉照片</button>` : '<span class="muted">還沒有照片</span>';
      const z = f.querySelector('[data-zoom]');
      if (z) z.addEventListener('click', () => Modal.image(Api.fileUrl(receipt), '收據'));
      const del = f.querySelector('[data-receipt-del]');
      if (del) del.addEventListener('click', () => { receipt = ''; drawReceipt(); });
    };
    drawCats();
    drawReceipt();
    f.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => { kind = r.value; drawCats(); }));
    f.elements.category.addEventListener('input', drawCats);
    f.querySelector('[data-file]').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      Busy.show('上傳中⋯');
      try {
        receipt = (await Api.admin('adminUploadFile', { mime: 'image/jpeg', name: file.name, data: await shrinkImage(file) })).id;
        Busy.hide();
        drawReceipt();
      } catch (err) {
        Busy.hide();
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        box.textContent = err.message || '上傳失敗';
        box.hidden = false;
      }
    });
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      m.el.setAttribute('data-locked', '');
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopLedgerSave', { entry: { id: e ? e.id : '', date: f.elements.date.value, type: kind, category: f.elements.category.value.trim(), amount: f.elements.amount.value.trim(), note: f.elements.note.value, receipt } });
        Busy.hide();
        m.close();
        after();
      } catch (err) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        box.innerHTML = `<strong>${esc(err.message)}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  return { report, stall, importPage, ledger };
})();
