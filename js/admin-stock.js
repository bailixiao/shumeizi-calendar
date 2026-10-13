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
    // 顯示：金額到個位數、單價到小數第二位（2026/10/13 使用者要的；計算照樣算到小數第二位）
    const m2 = (v) => Number(v || 0).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const c2 = (v) => (Number(v) || 0).toFixed(2); // CSV 的單價
    const c0 = (v) => Math.round(Number(v) || 0); // CSV 的金額
    const m0 = (v) => Math.round(Number(v) || 0).toLocaleString('zh-TW'); // 金額
    const today = Fmt.toDateStr ? Fmt.toDateStr(new Date()) : new Date().toISOString().slice(0, 10);
    if (!repState.from) { repState.from = today.slice(0, 4) + '-01-01'; repState.to = today; }
    body.innerHTML = `${back}<h2>📊 進銷存報表</h2><p class="panel-empty">計算中⋯</p>`;
    let d;
    try { d = await Api.admin('adminShopStockReport', { from: repState.from, to: repState.to }, true); } catch (e) { guard(e, body); return; }
    const cell = (o, withPrice) => `<td class="num">${o.qty}</td>${withPrice ? `<td class="num">${m2(o.price)}</td>` : ''}<td class="num">${m0(o.amount)}</td>`;
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
        <div class="stat-card"><span class="stat-label">銷貨金額</span><span class="stat-num">${m0(d.total.sale.amount)}</span><span class="stat-hint">${d.total.sale.qty} 件</span></div>
        <div class="stat-card"><span class="stat-label">銷貨成本</span><span class="stat-num">${m0(d.total.saleCost.amount)}</span><span class="stat-hint">用平均成本算</span></div>
        <div class="stat-card"><span class="stat-label">毛利</span><span class="stat-num">${m0(d.profit)}</span><span class="stat-hint">毛利率 ${Math.round(d.margin * 1000) / 10}%</span></div>
        <div class="stat-card"><span class="stat-label">期末存貨</span><span class="stat-num">${m0(d.total.end.amount)}</span><span class="stat-hint">${d.total.end.qty} 件</span></div>
      </div>
      ${d.rows.length ? `<div class="stock-table-wrap"><table class="stock-table">
        <thead>
          <tr><th rowspan="2">品項</th><th colspan="3">期初存貨</th><th colspan="3">本期進貨</th><th colspan="2">其他：加</th><th colspan="2">其他：減</th><th colspan="3">本期銷貨（平均成本）</th><th colspan="3">本期銷貨（售價）</th><th colspan="3">期末存貨</th></tr>
          <tr><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>金額</th><th>數量</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th><th>數量</th><th>單價</th><th>金額</th></tr>
        </thead>
        <tbody>${d.rows.map((r) => `<tr><td class="name"><small class="stock-code-sm">${esc(r.code)}</small>${esc(r.name)}</td>${cell(r.open, true)}${cell(r.buy, true)}${cell(r.add)}${cell(r.sub)}${cell(r.saleCost, true)}${cell(r.sale, true)}${cell(r.end, true)}</tr>`).join('')}</tbody>
        <tfoot><tr><td>合計</td><td class="num">${d.total.open.qty}</td><td></td><td class="num">${m0(d.total.open.amount)}</td><td class="num">${d.total.buy.qty}</td><td></td><td class="num">${m0(d.total.buy.amount)}</td><td class="num">${d.total.add.qty}</td><td class="num">${m0(d.total.add.amount)}</td><td class="num">${d.total.sub.qty}</td><td class="num">${m0(d.total.sub.amount)}</td><td class="num">${d.total.saleCost.qty}</td><td></td><td class="num">${m0(d.total.saleCost.amount)}</td><td class="num">${d.total.sale.qty}</td><td></td><td class="num">${m0(d.total.sale.amount)}</td><td class="num">${d.total.end.qty}</td><td></td><td class="num">${m0(d.total.end.amount)}</td></tr></tfoot>
      </table></div>` : '<p class="panel-empty">這段期間沒有進出紀錄。</p>'}
      <p class="hint">平均成本＝（期初金額＋進貨金額＋其他加金額－其他減金額）÷（期初數量＋進貨數量＋其他加數量－其他減數量），不先四捨五入；畫面上單價顯示到小數第二位、金額顯示到個位數（計算照樣算到小數第二位）；銷貨成本＝銷貨數量×平均成本，期末金額＝可賣的成本－銷貨成本，所以每一列「期初＋進貨＋其他加－其他減＝銷貨成本＋期末」都對得起來。毛利只是賣商品賺的，不含攤位費、包材等費用。</p>`;
    const f = body.querySelector('form');
    f.addEventListener('submit', (ev) => { ev.preventDefault(); repState.from = f.elements.from.value; repState.to = f.elements.to.value; report(body, guard); });
    body.querySelector('[data-csv]').addEventListener('click', () => {
      const head = [['產品代號', '品項', '期初數量', '期初單價', '期初金額', '進貨數量', '進貨單價', '進貨金額', '其他加數量', '其他加金額', '其他減數量', '其他減金額', '銷貨數量', '平均成本', '銷貨成本', '銷貨售價單價', '銷貨售價金額', '期末數量', '期末單價', '期末金額']];
      const rows = d.rows.map((r) => [r.code, r.name, r.open.qty, c2(r.open.price), c0(r.open.amount), r.buy.qty, c2(r.buy.price), c0(r.buy.amount), r.add.qty, c0(r.add.amount), r.sub.qty, c0(r.sub.amount), r.saleCost.qty, c2(r.saleCost.price), c0(r.saleCost.amount), c2(r.sale.price), c0(r.sale.amount), r.end.qty, c2(r.end.price), c0(r.end.amount)]);
      const foot = [['', '合計', d.total.open.qty, '', c0(d.total.open.amount), d.total.buy.qty, '', c0(d.total.buy.amount), d.total.add.qty, c0(d.total.add.amount), d.total.sub.qty, c0(d.total.sub.amount), d.total.saleCost.qty, '', c0(d.total.saleCost.amount), '', c0(d.total.sale.amount), d.total.end.qty, '', c0(d.total.end.amount)],
        [], ['', '毛利', c0(d.profit)], ['', '毛利率', Math.round(d.margin * 1000) / 10 + '%']];
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
          await Api.admin('adminShopStallSave', { dutyId, rows: d.rows.map((r, i) => ({ id: r.id, option: r.option || '', onsite: st[i].onsite || 0, price: st[i].price, actual: st[i].actual, note: st[i].note })) });
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

  // 記帳在 js/admin-ledger.js

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

  // ---------- 📋 盤點（#/admin/shop/count；年度結算 段 2） ----------

  const countState = { date: '' };

  async function count(body, guard, flash) {
    body.innerHTML = `${back}<h2>📋 盤點</h2><p class="panel-empty">載入中⋯</p>`;
    let d;
    try { d = await Api.admin('adminShopStockCount', { date: countState.date }, true); } catch (e) { guard(e, body); return; }
    countState.date = d.date;
    const edit = canEdit();
    const yearEnd = d.today.slice(0, 4) + '-12-31';
    const lastYearEnd = (Number(d.today.slice(0, 4)) - 1) + '-12-31';
    const input = d.rows.map((r) => (r.actual === null ? '' : String(r.actual)));
    body.innerHTML = `
      ${back}
      <h2>📋 盤點</h2>
      <p class="hint">點完實際有幾個填進去，存檔後差的會自動記「盤盈／盤虧」（成本用平均成本、備註寫「盤點」）。沒填的不動，可以先存一半、之後再補；同一天再存一次會換掉上次的。年底結帳前請盤點一次（盤點日選 12/31）。</p>
      ${flash || ''}
      <form class="stock-range" data-date novalidate>
        <label>盤點日 <input class="input" type="date" name="date" max="${esc(d.today)}" value="${esc(d.date)}"></label>
        <button type="submit" class="btn">換日期</button>
        ${d.today >= yearEnd ? `<button type="button" class="btn" data-day="${yearEnd}">今年 12/31</button>` : `<button type="button" class="btn" data-day="${lastYearEnd}">去年 12/31</button>`}
      </form>
      <p class="muted">已盤點 ${d.counted} / ${d.rows.length} 樣</p>
      ${d.rows.length ? `<form data-count novalidate><div class="stock-table-wrap"><table class="stock-table count-table">
        <thead><tr><th>品項</th><th>帳上</th><th>實際</th><th>差</th></tr></thead>
        <tbody>${d.rows.map((r, i) => `<tr class="${r.actual !== null ? 'is-counted' : ''}"><td class="name"><small class="stock-code-sm">${esc(r.code)}</small>${esc(r.name)}</td>
          <td class="num">${r.book}</td>
          <td><input class="input stall-in" inputmode="numeric" data-i="${i}" value="${esc(input[i])}" placeholder="${r.book}"${edit ? '' : ' disabled'}></td>
          <td class="num" data-diff="${i}"></td></tr>`).join('')}</tbody>
      </table></div>
      ${edit ? '<div class="form-error" data-error hidden></div><div class="admin-actions"><button type="submit" class="btn btn-primary">存檔（有填的）</button></div>' : ''}
      </form>` : '<p class="panel-empty">還沒有商品。</p>'}`;
    const df = body.querySelector('[data-date]');
    df.addEventListener('submit', (ev) => { ev.preventDefault(); countState.date = df.elements.date.value; count(body, guard); });
    body.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { countState.date = b.dataset.day; count(body, guard); }));
    const f = body.querySelector('[data-count]');
    if (!f) return;
    const drawDiff = (i) => {
      const v = input[i].trim();
      const el = f.querySelector(`[data-diff="${i}"]`);
      const diff = v === '' ? null : Number(v) - d.rows[i].book;
      el.textContent = diff === null || isNaN(diff) ? '' : diff > 0 ? '+' + diff : String(diff);
      el.className = 'num' + (diff ? ' is-diff' : '');
    };
    d.rows.forEach((r, i) => drawDiff(i));
    f.querySelectorAll('[data-i]').forEach((x) => x.addEventListener('input', () => { input[Number(x.dataset.i)] = x.value; drawDiff(Number(x.dataset.i)); }));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const rows = d.rows.map((r, i) => ({ id: r.id, option: r.option, actual: input[i].trim() })).filter((r) => r.actual !== '');
      const box = f.querySelector('[data-error]');
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopStockCountSave', { date: d.date, rows });
        Busy.hide();
        AdminPage.clearMemo();
        count(body, guard, AdminPage.notice('success', '盤點存好了', `${rows.length} 樣；差的已經記成盤盈／盤虧`));
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { guard(e); return; }
        box.innerHTML = `<strong>${esc(e.message)}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
        box.hidden = false;
      }
    });
  }

  // ---------- 📕 年度結帳（#/admin/shop/year；只有總管理者；年度結算 段 3） ----------

  const yearState = { year: 0, check: null, actual: { 零用金: '', 銀行存款: '' }, done: null };

  function yearClose(body, guard, flash) {
    if (Api.adminWho().role !== '總管理者') { body.innerHTML = `${back}<p class="panel-empty">年度結帳只有總管理者可以做。</p>`; return; }
    const thisYear = new Date().getFullYear();
    if (!yearState.year) yearState.year = new Date().getMonth() >= 10 ? thisYear : thisYear - 1; // 11 月以後預設今年
    const y = yearState.year;
    const c = yearState.check;
    const roc = y - 1911;
    const ok = (good, text) => `<li class="year-check ${good ? 'is-ok' : 'is-warn'}"><span>${good ? '✅' : '⚠️'}</span><div>${text}</div></li>`;
    const list = (arr) => arr.length ? `<small>${arr.slice(0, 8).map((o) => esc(o.name) + (o.total ? ' ' + money(o.total) + ' 元' : '')).join('、')}${arr.length > 8 ? ' ⋯' : ''}</small>` : '';
    const sheet = c && c.sheet;
    const bal = sheet ? sheet.balances : {};
    const diffOf = (a) => yearState.actual[a] === '' ? null : Math.round((Number(yearState.actual[a]) - (bal[a] || 0)) * 100) / 100;
    body.innerHTML = `
      ${back}
      <h2>📕 年度結帳</h2>
      <p class="hint">年底照順序做：先「📋 盤點」（盤點日選 12/31）→ 這裡「1. 對帳檢查」→ 有問題的處理好 →「2. 結帳」。結帳後那一年的進出貨、訂單、記帳都鎖住，帳存成 Excel／PDF 封存，並開好下一年的植素園記帳（期初餘額自動帶過去）。</p>
      ${flash || ''}
      <div class="stock-range">
        <label>年度 <select class="input" data-year>${[thisYear, thisYear - 1].map((v) => `<option value="${v}"${v === y ? ' selected' : ''}>${v - 1911} 年（${v}）</option>`).join('')}</select></label>
        <button type="button" class="btn btn-primary" data-check>1. 對帳檢查</button>
      </div>
      ${c ? `
        ${c.locked && c.locked >= y + '-12-31' ? `<div class="notice notice-success"><p><strong>✅ ${roc} 年已經結帳（鎖住）。</strong></p><p>要改那一年的帳，先解除結帳；改完要再結帳一次。</p><button type="button" class="btn btn-quiet-danger" data-unlock>解除 ${roc} 年結帳</button></div>` : ''}
        <h3 class="year-h">對帳檢查（${roc} 年）</h3>
        <ul class="year-checks">
          ${ok(c.count.yearEnd, c.count.yearEnd ? '12/31 盤點過了' : `還沒做年底盤點（12/31）${c.count.last ? '；最近一次盤點 ' + esc(c.count.last) : ''}。<a href="#/admin/shop/count">去盤點 ›</a>`)}
          ${ok(!c.unpaid.count, c.unpaid.count ? `還沒付款的訂單 ${c.unpaid.count} 張，共 ${money(c.unpaid.amount)} 元（年底沒收到的會算應收帳款）${list(c.unpaid.list)}` : '訂單都付款了')}
          ${ok(!c.unconfirmed.count, c.unconfirmed.count ? `還沒確認的訂單 ${c.unconfirmed.count} 張${list(c.unconfirmed.list)}` : '訂單都確認了')}
          ${ok(!c.unpicked.count, c.unpicked.count ? `還沒取貨的訂單 ${c.unpicked.count} 張${list(c.unpicked.list)}` : '訂單都取貨了')}
          ${ok(!c.negative.length, c.negative.length ? `庫存是負的：${c.negative.map((x) => esc(x.name) + ' ' + x.qty).join('、')}（請盤點或補記進貨）` : '沒有庫存是負的')}
          ${c.sheetError ? ok(false, '讀不到植素園記帳：' + esc(c.sheetError)) : ok(!sheet.bs.diff, sheet.bs.diff ? `資產負債表沒有平衡，差 ${money(sheet.bs.diff)} 元（請檢查期初餘額、手動記帳）` : `資產負債表平衡（資產 ${money(sheet.bs.assetTotal)} 元；本期結餘 ${money(sheet.bs.profit)} 元）`)}
        </ul>
        ${sheet ? `<h3 class="year-h">帳戶餘額對一下</h3>
          <div class="stock-table-wrap"><table class="stock-table year-bal"><thead><tr><th>帳戶</th><th>帳上</th><th>實際</th><th>差</th></tr></thead><tbody>
            ${['零用金', '銀行存款'].map((a) => `<tr><td class="name">${a}</td><td class="num">${money(bal[a] || 0)}</td><td><input class="input stall-in" inputmode="decimal" data-actual="${a}" value="${esc(yearState.actual[a])}" placeholder="${a === '零用金' ? '點一下現金' : '存摺餘額'}"></td><td class="num" data-bdiff="${a}">${diffOf(a) === null ? '' : diffOf(a) ? money(diffOf(a)) : '✅'}</td></tr>`).join('')}
            ${['應收帳款', '應付帳款'].map((a) => `<tr><td class="name">${a}</td><td class="num">${money(bal[a] || 0)}</td><td colspan="2" class="muted">${a === '應收帳款' ? '別人還欠的' : '還欠別人的'}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="hint">實際和帳上不一樣：到植素園記帳的「手動記帳」記一筆調整（例：零用金 -50、科目「其他損失」、摘要寫原因），再按一次對帳檢查。<a href="${esc(sheet.url)}" target="_blank" rel="noopener">打開 ${roc} 年植素園記帳 ›</a></p>` : ''}
        ${!(c.locked && c.locked >= y + '-12-31') ? `<div class="admin-actions"><button type="button" class="btn btn-primary" data-close-year>2. 結帳 ${roc} 年</button></div>` : ''}` : '<p class="muted">按「1. 對帳檢查」開始（要讀植素園記帳，大約 10～30 秒）。</p>'}
      ${yearState.done ? `<div class="notice notice-success"><p><strong>🎉 ${roc} 年結帳完成</strong></p>
        <p>封存：<a href="${esc(yearState.done.archive.xlsx)}" target="_blank" rel="noopener">Excel</a>・<a href="${esc(yearState.done.archive.pdf)}" target="_blank" rel="noopener">PDF</a>・<a href="${esc(yearState.done.archive.folder)}" target="_blank" rel="noopener">封存資料夾</a></p>
        <p>下一年：<a href="${esc(yearState.done.next.url)}" target="_blank" rel="noopener">${yearState.done.next.year - 1911} 年植素園記帳</a>（期初餘額已經帶過去）</p></div>` : ''}`;
    body.querySelector('[data-year]').addEventListener('change', (ev) => { yearState.year = Number(ev.target.value); yearState.check = null; yearState.done = null; yearClose(body, guard); });
    body.querySelector('[data-check]').addEventListener('click', async () => {
      Busy.show('對帳檢查中⋯（讀植素園記帳）');
      try { yearState.check = await Api.admin('adminYearCheck', { year: y }); Busy.hide(); yearClose(body, guard); } catch (e) { Busy.hide(); if (!guard(e)) yearClose(body, guard, AdminPage.notice('error', '對帳檢查失敗', e.message)); }
    });
    body.querySelectorAll('[data-actual]').forEach((x) => x.addEventListener('input', () => {
      yearState.actual[x.dataset.actual] = x.value.trim();
      const d = diffOf(x.dataset.actual);
      body.querySelector(`[data-bdiff="${x.dataset.actual}"]`).textContent = d === null ? '' : d ? money(d) : '✅';
    }));
    const cb = body.querySelector('[data-close-year]');
    if (cb) cb.addEventListener('click', async () => {
      const warn = c && (c.unpaid.count || c.unconfirmed.count || c.unpicked.count || c.negative.length || !c.count.yearEnd || c.sheetError || (sheet && sheet.bs.diff));
      if (!(await Confirm.open({ title: `結帳 ${roc} 年？`, rows: [['鎖住', `${roc} 年（含）以前的進出貨、訂單、記帳不能再改`], ['封存', '損益表、資產負債表、進銷存報表存成 Excel／PDF'], ['下一年', `開好 ${roc + 1} 年植素園記帳，帶入期初餘額`]], note: warn ? '⚠️ 對帳檢查還有沒處理好的項目，確定還是要結帳嗎？（之後可以解除結帳再改）' : '結帳要 1～2 分鐘，請不要關掉畫面。', confirmText: '結帳', danger: !!warn }))) return;
      Busy.show('結帳中⋯（大約 1～2 分鐘）');
      try {
        yearState.done = await Api.admin('adminYearClose', { year: y });
        yearState.check = Object.assign({}, yearState.check, { locked: y + '-12-31' });
        Busy.hide();
        yearClose(body, guard);
      } catch (e) { Busy.hide(); if (!guard(e)) yearClose(body, guard, AdminPage.notice('error', '結帳沒有完成', e.message)); }
    });
    const ub = body.querySelector('[data-unlock]');
    if (ub) ub.addEventListener('click', async () => {
      if (!(await Confirm.open({ title: `解除 ${roc} 年結帳？`, rows: [['之後', '那一年的帳可以再改；改完記得再結帳一次']], confirmText: '解除結帳', danger: true }))) return;
      Busy.show('解除中⋯');
      try {
        const r = await Api.admin('adminYearUnlock', { year: y });
        yearState.check = Object.assign({}, yearState.check, { locked: r.locked });
        yearState.done = null;
        Busy.hide();
        yearClose(body, guard, AdminPage.notice('success', `已解除 ${roc} 年結帳`, '改完記得再結帳一次'));
      } catch (e) { Busy.hide(); if (!guard(e)) yearClose(body, guard, AdminPage.notice('error', '解除失敗', e.message)); }
    });
  }

  // ---------- 🏷️ 買多優惠（#/admin/shop/promos；規格 0.6「買多優惠」） ----------

  async function promos(body, guard, flash) {
    body.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let d;
    try { d = await Api.admin('adminShop', {}, true); } catch (e) { guard(e, body); return; }
    const edit = canEdit();
    const nameOf = (id) => (d.products.find((p) => p.id === id) || {}).name || '（商品已刪除）';
    body.innerHTML = `
      ${back}
      <h2 class="section-title">🏷️ 買多優惠</h2>
      <p class="hint">例：一包 50 元、三包 100 元；或豆干、豆皮任選 3 件 100 元。同一個優惠的商品（不同口味也算）放一起數件數，購物車會自動算最划算的，湊不滿的照原價。</p>
      ${flash || ''}
      ${edit ? '<div class="admin-actions"><button type="button" class="btn btn-primary" data-new>＋ 新增優惠</button></div>' : ''}
      ${d.promos.length ? `<ul class="promo-list">${d.promos.map((p) => `
        <li class="promo-item${p.active ? '' : ' is-off'}">
          <button type="button" class="promo-main" data-edit="${esc(p.id)}"${edit ? '' : ' disabled'}>
            <strong>🏷️ ${esc(p.label)}</strong>
            <span>${p.tiers.map((t) => t.qty + ' 件 ' + money(t.price) + ' 元').join('・')}</span>
            <small>${p.productIds.map((id) => esc(nameOf(id))).join('、')}${p.active ? '' : '・已停用'}</small>
          </button>
        </li>`).join('')}</ul>` : '<p class="panel-empty">還沒有優惠。</p>'}`;
    const again = (msg) => { AdminPage.clearMemo(); promos(body, guard, msg ? AdminPage.notice('success', msg) : ''); };
    const nb = body.querySelector('[data-new]');
    if (nb) nb.addEventListener('click', () => promoForm(null, d, guard, again));
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => promoForm(d.promos.find((p) => p.id === b.dataset.edit), d, guard, again)));
  }

  function promoForm(p, d, guard, after) {
    const tiers = p ? p.tiers.slice() : [{ qty: '', price: '' }];
    const picked = new Set(p ? p.productIds : []);
    const products = d.products.filter((x) => x.active || picked.has(x.id));
    const tierRow = (t, i) => `<div class="promo-tier" data-tier="${i}"><input class="input" name="qty" inputmode="numeric" placeholder="3" value="${esc(t.qty)}" aria-label="件數"><span>件</span><input class="input" name="price" inputmode="numeric" placeholder="100" value="${esc(t.price)}" aria-label="總價"><span>元</span><button type="button" class="btn btn-small btn-quiet-danger" data-tier-del="${i}" aria-label="拿掉這段">✕</button></div>`;
    const m = Modal.open(`
      <h2 class="modal-title">${p ? '修改優惠' : '新增優惠'}</h2>
      <form class="admin-form" novalidate>
        <div class="form-row"><span>哪些商品（勾好幾樣＝任選一起算）</span>
          <div class="promo-products">${products.map((x) => `<label class="de-check"><input type="checkbox" name="pid" value="${esc(x.id)}"${picked.has(x.id) ? ' checked' : ''}> ${esc(x.code ? x.code + ' ' : '')}${esc(x.name)}<small>　${money(x.price)} 元${x.unit ? '／' + esc(x.unit) : ''}</small></label>`).join('') || '<p class="muted">還沒有商品</p>'}</div></div>
        <div class="form-row"><span>價格（幾件多少元，可以好幾段）</span><div data-tiers>${tiers.map(tierRow).join('')}</div>
          <button type="button" class="btn btn-small" data-tier-add>＋ 再加一段</button></div>
        <label class="form-row"><span>名稱（選填，空白自動寫「任選 3 件 100 元」）</span><input class="input" name="name" maxlength="30" value="${esc(p ? p.name : '')}" placeholder="例：豆干豆皮任選 3 包 100"></label>
        ${p ? `<label class="de-check"><input type="checkbox" name="active"${p.active ? ' checked' : ''}> 啟用中（取消勾選＝暫停這個優惠）</label>` : ''}
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          ${p ? '<button type="button" class="btn btn-block btn-quiet-danger" data-del>刪除這個優惠</button>' : ''}
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const box = m.el.querySelector('[data-tiers]');
    const err = m.el.querySelector('[data-error]');
    const read = () => [...box.querySelectorAll('[data-tier]')].map((r) => ({ qty: r.querySelector('[name=qty]').value.trim(), price: r.querySelector('[name=price]').value.trim() }));
    const drawTiers = (list) => {
      box.innerHTML = list.map(tierRow).join('');
      box.querySelectorAll('[data-tier-del]').forEach((b) => b.addEventListener('click', () => { const l = read(); l.splice(Number(b.dataset.tierDel), 1); drawTiers(l.length ? l : [{ qty: '', price: '' }]); }));
    };
    drawTiers(tiers);
    m.el.querySelector('[data-tier-add]').addEventListener('click', () => { const l = read(); if (l.length < 5) drawTiers(l.concat([{ qty: '', price: '' }])); });
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    const showErr = (e) => { err.innerHTML = `<strong>${esc(e.message || '存檔失敗')}</strong>${(e.details || []).map((x) => '<br>' + esc(x.message)).join('')}`; err.hidden = false; };
    const del = m.el.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => {
      if (!(await Confirm.open({ title: '刪除這個優惠？', rows: [['優惠', p.label]], note: '已經下的訂單不會變。只是暫時不用的話，取消勾選「啟用中」就好。', confirmText: '刪除', danger: true }))) return;
      Busy.show('刪除中⋯');
      try { await Api.admin('adminShopDeletePromo', { id: p.id }); Busy.hide(); m.close(); after('已刪除優惠'); } catch (e) { Busy.hide(); if (e.code === 'UNAUTHORIZED') { m.close(); guard(e); return; } showErr(e); }
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopSavePromo', { promo: { id: p ? p.id : '', name: f.elements.name.value.trim(),
          productIds: [...f.querySelectorAll('input[name=pid]:checked')].map((x) => x.value), tiers: read(), active: f.elements.active ? f.elements.active.checked : true } });
        Busy.hide();
        m.close();
        after(p ? '已儲存優惠' : '已新增優惠，購物車會自動算');
      } catch (e) {
        Busy.hide();
        if (e.code === 'UNAUTHORIZED') { m.close(); guard(e); return; }
        showErr(e);
      }
    });
  }

  return { report, stall, importPage, promos, count, yearClose, shrinkImage, downloadCsv };
})();
