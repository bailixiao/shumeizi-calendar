// 管理後台：記帳（#/admin/shop/ledger；規格 0.6「改成 115年簡易記帳表格 的樣子」）。
//   選年度（民國），分頁和範本一樣：(1) 零用金、(2) 銀行存款、(3) 應收帳款、(4) 應付帳款、(5) 分類帳、(6) 資產負債表、(7) 損益表。
//   記一筆（收入／支出）、移轉（存提款、收回應收、付清應付）、期初餘額；團購訂單、出攤、進貨會自動記（🤖）。
//   ⬇️ 下載 Excel：.xlsx 七個分頁（js/xlsx-lite.js）。規則與計算都在伺服器（apps-script/Ledger.gs）。
window.AdminLedger = (function () {
  'use strict';

  const esc = Fmt.esc;
  const num = (n) => Number(n || 0).toLocaleString('zh-TW');
  const signed = (n) => (n < 0 ? '−' : '') + num(Math.abs(n));
  const canEdit = () => { const r = Api.adminWho().role; return r === '總管理者' || r === '植素'; };
  const back = '<a class="btn back-btn" href="#/admin/shop">‹ 回團購</a>';
  /** 2026-01-10 → 115.01.10 */
  const roc = (d) => d ? `${Number(d.slice(0, 4)) - 1911}.${d.slice(5, 7)}.${d.slice(8, 10)}` : '';
  const rocYear = (y) => Number(y) - 1911;
  const ACCOUNTS = ['零用金', '銀行存款', '應收帳款', '應付帳款'];
  const TABS = [['零用金', '(1) 零用金'], ['銀行存款', '(2) 銀行存款'], ['應收帳款', '(3) 應收帳款'], ['應付帳款', '(4) 應付帳款'], ['ledger', '(5) 分類帳'], ['bs', '(6) 資產負債表'], ['is', '(7) 損益表']];
  const SOURCE = (s) => s.startsWith('O:') ? '團購訂單' : s.startsWith('S:') ? '出攤銷售統計' : s.startsWith('K:') ? '商品增加（進貨）' : '自動';
  const state = { year: 0, tab: '零用金' };
  let data = null;

  async function show(body, guard) {
    body.innerHTML = `${back}<h2>💰 記帳</h2><p class="panel-empty">載入中⋯</p>`;
    try { data = await Api.admin('adminShopLedger', { year: state.year || '' }, true); } catch (e) { guard(e, body); return; }
    state.year = data.year;
    render(body, guard);
  }

  function render(body, guard) {
    const d = data;
    const edit = canEdit();
    const acc = (n) => d.accounts.find((a) => a.name === n);
    const reload = () => { AdminPage.clearMemo(); show(body, guard); };
    body.innerHTML = `
      ${back}
      <h2>💰 記帳</h2>
      <div class="ledger-top">
        <label class="ledger-year"><span>年度</span><select class="input" data-year>${d.years.map((y) => `<option value="${y}"${y === d.year ? ' selected' : ''}>${rocYear(y)} 年（${y}）</option>`).join('')}</select></label>
        <button type="button" class="btn" data-xlsx>⬇️ 下載 Excel</button>
      </div>
      ${edit ? `<div class="stock-actions ledger-actions">
        <button type="button" class="btn stock-btn is-out" data-new="支出">➖ 記支出</button>
        <button type="button" class="btn stock-btn is-in" data-new="收入">➕ 記收入</button>
        <button type="button" class="btn stock-btn" data-transfer>🔁 移轉</button>
      </div>` : ''}
      <div class="stat-cards stock-sum ledger-sum">
        ${ACCOUNTS.map((n) => `<button type="button" class="stat-card ledger-card${state.tab === n ? ' is-on' : ''}" data-go="${n}"><span class="stat-label">${n}</span><span class="stat-num">${signed(acc(n).closing)}</span></button>`).join('')}
        <button type="button" class="stat-card ledger-card ledger-net${d.is.profit < 0 ? ' is-neg' : ''}${state.tab === 'is' ? ' is-on' : ''}" data-go="is"><span class="stat-label">本期損益</span><span class="stat-num">${signed(d.is.profit)}</span></button>
      </div>
      <div class="ledger-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" class="ledger-tab${state.tab === k ? ' is-active' : ''}" aria-selected="${state.tab === k}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="ledger-body">${ACCOUNTS.includes(state.tab) ? accountHtml(acc(state.tab), edit) : state.tab === 'ledger' ? ledgerHtml() : state.tab === 'bs' ? bsHtml() : isHtml()}</div>`;
    body.querySelector('[data-year]').addEventListener('change', (ev) => { state.year = Number(ev.target.value); show(body, guard); });
    body.querySelector('[data-xlsx]').addEventListener('click', () => downloadXlsx());
    body.querySelectorAll('[data-tab],[data-go]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab || b.dataset.go; render(body, guard); }));
    body.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => entryForm(null, b.dataset.new, guard, reload)));
    const tr = body.querySelector('[data-transfer]');
    if (tr) tr.addEventListener('click', () => transferForm(guard, reload));
    const op = body.querySelector('[data-opening]');
    if (op) op.addEventListener('click', () => openingForm(guard, reload));
    body.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); Modal.image(Api.fileUrl(b.dataset.receipt), '收據'); }));
    body.querySelectorAll('[data-entry]').forEach((b) => b.addEventListener('click', () => {
      const e = d.accounts.flatMap((a) => a.entries).find((x) => x.id === b.dataset.entry);
      if (e) entryForm(e, e.type, guard, reload);
    }));
  }

  // ---------- (1)～(4) 帳戶 ----------

  function accountHtml(a, edit) {
    const debt = a.name === '應付帳款';
    return `
      <h3 class="ledger-title">${esc(a.name)}<small>${rocYear(data.year)}.01.01 至 ${rocYear(data.year)}.12.31</small></h3>
      <div class="ledger-scroll"><table class="ledger-table">
        <thead><tr><th>日期</th><th>科目</th><th>摘要</th><th class="num">金額</th><th class="num">餘額</th></tr></thead>
        <tbody>
          <tr class="ledger-open"><td colspan="3">期初餘額${edit ? ' <button type="button" class="btn btn-small" data-opening>設定</button>' : ''}</td><td></td><td class="num">${signed(a.opening)}</td></tr>
          ${a.entries.map((e) => `<tr class="${edit ? 'is-click' : ''}"${edit ? ` data-entry="${esc(e.id)}" tabindex="0"` : ''}>
            <td class="nowrap">${roc(e.date)}</td>
            <td class="nowrap">${esc(e.category)}${e.auto ? ' <span class="ledger-badge" title="自動記的">🤖</span>' : e.type === '移轉' ? ' <span class="ledger-badge">🔁</span>' : ''}</td>
            <td>${esc(e.note)}${e.receipt ? ` <button type="button" class="btn btn-small" data-receipt="${esc(e.receipt)}">🧾</button>` : ''}</td>
            <td class="num ${e.effect < 0 ? 'is-neg' : ''}">${signed(e.effect)}</td>
            <td class="num">${signed(e.balance)}</td>
          </tr>`).join('') || '<tr><td colspan="5" class="muted">這一年還沒有紀錄</td></tr>'}
        </tbody>
        <tfoot><tr><td colspan="4">期末餘額</td><td class="num">${signed(a.closing)}</td></tr></tfoot>
      </table></div>
      <p class="hint">${debt ? '應付帳款：還欠多少（買東西還沒付記這裡，付掉用「🔁 移轉」的「付清應付」）。' : a.name === '應收帳款' ? '應收帳款：別人還欠我們多少（團購取貨了還沒付會自動記；收到錢用「🔁 移轉」的「收回應收」）。' : '錢進來是正數、出去是負數。'}${edit ? ' 點一列可以修改、刪除；🤖＝自動記的（團購訂單、出攤、進貨）。' : ''}</p>`;
  }

  // ---------- (5) 分類帳 ----------

  function ledgerHtml() {
    const g = data.ledger;
    const label = { 收入: '【收入】', 其他收入: '【收入】', 成本: '【成本】', 費用: '【支出】', 其他損失: '【支出】' };
    return `
      <h3 class="ledger-title">分類帳<small>${rocYear(data.year)} 年</small></h3>
      ${g.length ? `<div class="ledger-scroll"><table class="ledger-table">
        <thead><tr><th>分類</th><th>日期</th><th>科目</th><th>摘要</th><th class="num">明細金額</th><th class="num">總計金額</th></tr></thead>
        <tbody>${g.map((x) => x.entries.map((e) => `<tr><td class="nowrap">${label[x.section]}</td><td class="nowrap">${roc(e.date)}</td><td>${esc(e.category)}</td><td>${esc(e.note)}</td><td class="num">${num(e.amount)}</td><td></td></tr>`).join('') +
          `<tr class="ledger-subtotal"><td>【總計】</td><td></td><td>${esc(x.subject)}</td><td></td><td></td><td class="num">${num(x.total)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="panel-empty">這一年還沒有收入、支出。</p>'}
      <p class="hint">照科目自動整理（不用像 Excel 一樣複製過來）；移轉、期初餘額不算。</p>`;
  }

  // ---------- (6) 資產負債表 ----------

  function bsHtml() {
    const b = data.bs;
    const rows = Math.max(b.assets.length, 1 + 4);
    const right = [['應付帳款', b.liabilities[0].amount], ['負債總額', b.liabilityTotal, true], ['累積結餘', b.retained], ['本期結餘', b.profit], ['結餘總額', b.equityTotal, true]];
    return `
      <h3 class="ledger-title">植素園 資產負債表<small>${roc(b.date)}　幣別：新台幣</small></h3>
      <div class="ledger-scroll"><table class="ledger-table ledger-bs">
        <thead><tr><th>資產項目</th><th class="num">金額</th><th>負債及結餘</th><th class="num">金額</th></tr></thead>
        <tbody>${Array.from({ length: rows }, (x, i) => {
          const a = b.assets[i];
          const r = right[i];
          return `<tr><td>${a ? esc(a.name) : ''}</td><td class="num">${a ? signed(a.amount) : ''}</td><td${r && r[2] ? ' class="b"' : ''}>${r ? r[0] : ''}</td><td class="num${r && r[2] ? ' b' : ''}">${r ? signed(r[1]) : ''}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td>資產總額</td><td class="num">${signed(b.assetTotal)}</td><td>負債及結餘總額</td><td class="num">${signed(b.rightTotal)}</td></tr></tfoot>
      </table></div>
      ${b.diff ? `<p class="notice notice-error">⚠️ 借貸差額 ${signed(b.diff)}：資產和負債＋結餘對不起來，請檢查期初餘額、或有沒有漏記。</p>` : '<p class="hint">✅ 借貸平衡。</p>'}
      <p class="hint">存貨＝進銷存報表的期末金額；累積結餘＝年初的（零用金＋銀行＋應收＋存貨－應付）；本期結餘＝損益表的損益。</p>`;
  }

  // ---------- (7) 損益表 ----------

  function isHtml() {
    const s = data.is;
    const line = (name, amount, total, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${name}</td><td class="num">${amount === null ? '' : signed(amount)}</td><td class="num">${total === undefined ? '' : signed(total)}</td></tr>`;
    return `
      <h3 class="ledger-title">植素園 損益表<small>${rocYear(data.year)}.01.01 至 ${rocYear(data.year)}.12.31　幣別：新台幣</small></h3>
      <div class="ledger-scroll"><table class="ledger-table ledger-is">
        <thead><tr><th>項目</th><th class="num">金額</th><th class="num">總計</th></tr></thead>
        <tbody>
          <tr class="ledger-sec"><td colspan="3">收入</td></tr>
          ${s.income.map((l) => line('　' + esc(l.subject), l.amount)).join('')}
          ${line('收入總額', null, s.incomeTotal, 'b')}
          <tr class="ledger-sec"><td colspan="3">成本</td></tr>
          ${line('　期初存貨', s.openInv)}${line('　進貨', s.purchases)}${line('　減：期末存貨', -s.closeInv)}
          ${line('銷貨成本', null, s.cogs, 'b')}
          <tr class="ledger-sec"><td colspan="3">費用</td></tr>
          ${s.expenses.map((l) => line('　' + esc(l.subject), l.amount)).join('')}
          ${line('費用總額', null, s.expenseTotal, 'b')}
          <tr class="ledger-sec"><td colspan="3">其他收入（損失）</td></tr>
          ${s.others.map((l) => line('　' + esc(l.subject), l.amount)).join('')}
          ${line('', null, s.otherTotal, 'b')}
        </tbody>
        <tfoot><tr><td>損益</td><td></td><td class="num${s.profit < 0 ? ' is-neg' : ''}">${signed(s.profit)}</td></tr></tfoot>
      </table></div>
      ${s.stockBuy !== s.purchases ? `<p class="notice">💡 進銷存報表的本期進貨是 ${num(s.stockBuy)}，記帳的進貨是 ${num(s.purchases)}，差 ${signed(s.stockBuy - s.purchases)}（匯入 Excel 的進貨不會自動記帳；需要的話手動記一筆「進貨」）。</p>` : ''}
      <p class="hint">期初、期末存貨用進銷存報表的金額（加權平均成本）；損益＝收入－銷貨成本－費用＋其他收入（損失）。</p>`;
  }

  // ---------- 下載 Excel ----------

  function downloadXlsx() {
    const d = data;
    const y = rocYear(d.year);
    const range = `${y}.01.01 至 ${y}.12.31`;
    const B = (v) => ({ v, b: true });
    const F = (v) => ({ v, fill: true });
    const sheets = d.accounts.map((a, i) => ({
      name: `(${i + 1})、${y}年${a.name}`,
      widths: [12, 14, 30, 14, 14],
      rows: [['', '', B(a.name)], ['', '', range], [B('日期'), B('科目'), B('摘要'), B('金額(TWD)'), B('餘額(TWD)')], ['期初餘額', '', '', '', F(a.opening)]]
        .concat(a.entries.map((e) => [roc(e.date), e.category, e.note, e.effect, F(e.balance)]), [['期末餘額', '', '', '', { v: a.closing, b: true, fill: true }]])
    }));
    const label = { 收入: '【收入】', 其他收入: '【收入】', 成本: '【成本】', 費用: '【支出】', 其他損失: '【支出】' };
    sheets.push({ name: `(5)、${y}年分類帳`, widths: [10, 12, 14, 30, 14, 14], rows: [[B('分類帳'), B('日期'), B('科目'), B('摘要'), B('明細金額'), B('總計金額')]]
      .concat(...d.ledger.map((g) => g.entries.map((e) => [label[g.section], roc(e.date), e.category, e.note, e.amount, '']).concat([['【總計】', '', g.subject, '', '', F(g.total)]]))) });
    const b = d.bs;
    sheets.push({ name: `(6)、${y}年BS`, widths: [16, 14, 18, 14], rows: [
      [B('植素園')], [B('資產負債表')], ['', roc(b.date), '幣別：新台幣'], [B('資產項目'), B('金額'), B('負債項目'), B('金額')],
      [b.assets[0].name, F(b.assets[0].amount), '應付帳款', F(b.liabilities[0].amount)],
      [b.assets[1].name, F(b.assets[1].amount)], [b.assets[2].name, F(b.assets[2].amount)], [b.assets[3].name, F(b.assets[3].amount), '負債總額', F(b.liabilityTotal)],
      [], ['', '', '結餘'], ['', '', '累積結餘', F(b.retained)], ['', '', '本期結餘', F(b.profit)], ['', '', '結餘總額', F(b.equityTotal)], [],
      [B('資產總額'), F(b.assetTotal), B('負債及結餘總額'), F(b.rightTotal)], b.diff ? ['', '', '借貸方差額', b.diff] : []
    ] });
    const s = d.is;
    sheets.push({ name: `(7)、${y}年IS`, widths: [22, 14, 14], rows: [[B('植素園')], [B('損益表')], [range, '', '幣別：新台幣'], [B('項目'), B('金額'), B('總計')],
      [B('收入')]].concat(s.income.map((l) => ['　' + l.subject, F(l.amount)]), [[B('收入總額'), '', F(s.incomeTotal)], [B('成本')],
      ['　期初存貨', s.openInv], ['　進貨', F(s.purchases)], ['　減：期末存貨', -s.closeInv], [B('銷貨成本'), '', F(s.cogs)], [B('費用')]],
      s.expenses.map((l) => ['　' + l.subject, F(l.amount)]), [[B('費用總額'), '', F(s.expenseTotal)], [B('其他收入（損失）')]],
      s.others.map((l) => ['　' + l.subject, F(l.amount)]), [['', '', F(s.otherTotal)], [], [B('損益'), '', { v: s.profit, b: true, fill: true }]]) });
    Xlsx.download(`${y}年植素園記帳.xlsx`, sheets);
  }

  // ---------- 表單 ----------

  function errorHtml(err) {
    return `<strong>${esc(err.message || '存檔失敗')}</strong>${(err.details || []).map((x) => '<br>' + esc(x.message)).join('')}`;
  }

  /** 記一筆／修改：收入或支出、帳戶、日期、科目、金額、摘要、收據照片。自動記的、移轉、期初只能改帳戶（自動的）、摘要、收據 */
  function entryForm(e, type, guard, after) {
    const d = data;
    const v = e || { date: d.today > d.to ? d.to : d.today, type, account: '零用金', category: '', amount: '', note: '', receipt: '' };
    const locked = !!e && (e.auto || e.type === '移轉' || e.type === '期初');
    let receipt = v.receipt || '';
    let kind = v.type;
    let account = v.account;
    const m = Modal.open(`
      <form class="modal-form admin-form" novalidate>
        <h2 class="modal-title">${e ? '修改' : kind === '收入' ? '➕ 記收入' : '➖ 記支出'}</h2>
        ${locked ? `<p class="notice">${e.auto ? `🤖 這筆是「${esc(SOURCE(e.source))}」自動記的：${esc(roc(e.date))} ${esc(e.category)} ${num(e.amount)} 元。金額要回原本的地方改；這裡可以改帳戶（例：現場收的錢其實轉進銀行）、摘要。` : `${e.type === '移轉' ? '🔁 移轉' : '期初餘額'}：${esc(roc(e.date))} ${esc(e.account)} ${signed(e.amount)} 元。只能改摘要；記錯了請刪掉重記。`}</p>` : `
        <div class="seg">${['支出', '收入'].map((t) => `<label class="seg-item"><input type="radio" name="type" value="${t}"${kind === t ? ' checked' : ''}><span>${t === '支出' ? '➖ 支出' : '➕ 收入'}</span></label>`).join('')}</div>
        <label class="form-row"><span>日期</span><input class="input" type="date" name="date" max="${esc(d.today)}" value="${esc(v.date)}"></label>`}
        ${!locked || e.auto ? '<div class="form-row"><span>帳戶（錢從哪裡進出）</span><div class="pos-chips" data-accounts></div></div>' : ''}
        ${locked ? '' : `<div class="form-row"><span>科目</span><div class="pos-chips" data-cats></div><input class="input" name="category" maxlength="20" value="${esc(v.category)}" placeholder="選上面的，或自己打"></div>
        <label class="form-row"><span>金額（元）</span><input class="input" name="amount" inputmode="numeric" maxlength="7" value="${esc(v.amount)}" placeholder="例：300"></label>`}
        <label class="form-row"><span>摘要（選填）</span><input class="input" name="note" maxlength="200" value="${esc(v.note)}" placeholder="例：宏宗聖堂出攤攤位費"></label>
        <div class="form-row"><span>收據照片（選填）</span><div data-receipt-box></div><label class="btn btn-small">📷 拍照／選照片<input type="file" accept="image/*" hidden data-file></label></div>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          ${e && !e.auto ? `<button type="button" class="btn btn-block btn-quiet-danger" data-del>${e.type === '移轉' ? '刪除（兩筆一起刪）' : '刪除這筆'}</button>` : ''}
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const box = f.querySelector('[data-error]');
    const drawAccounts = () => {
      const el = f.querySelector('[data-accounts]');
      if (!el) return;
      el.innerHTML = ACCOUNTS.filter((a) => !(kind === '收入' && a === '應付帳款') && !(kind === '支出' && a === '應收帳款')).map((a) => `<button type="button" class="pos-chip${account === a ? ' is-checked' : ''}" data-acc="${a}">${a}</button>`).join('');
      el.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => { account = b.dataset.acc; drawAccounts(); }));
    };
    const drawCats = () => {
      const el = f.querySelector('[data-cats]');
      if (!el) return;
      el.innerHTML = (d.categoryOptions[kind] || []).map((c) => `<button type="button" class="pos-chip${f.elements.category.value === c ? ' is-checked' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { f.elements.category.value = b.dataset.cat; drawCats(); }));
    };
    const drawReceipt = () => {
      f.querySelector('[data-receipt-box]').innerHTML = receipt ? `<button type="button" class="shop-thumb shop-thumb-big" data-zoom><img src="${esc(Api.fileUrl(receipt))}" alt="收據"></button><button type="button" class="btn btn-small btn-quiet-danger" data-receipt-del>拿掉照片</button>` : '<span class="muted">還沒有照片</span>';
      const z = f.querySelector('[data-zoom]');
      if (z) z.addEventListener('click', () => Modal.image(Api.fileUrl(receipt), '收據'));
      const del = f.querySelector('[data-receipt-del]');
      if (del) del.addEventListener('click', () => { receipt = ''; drawReceipt(); });
    };
    drawAccounts();
    drawCats();
    drawReceipt();
    f.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => { kind = r.value; if ((kind === '收入' && account === '應付帳款') || (kind === '支出' && account === '應收帳款')) account = '零用金'; drawAccounts(); drawCats(); }));
    if (f.elements.category) f.elements.category.addEventListener('input', drawCats);
    f.querySelector('[data-file]').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      Busy.show('上傳中⋯');
      try {
        receipt = (await Api.admin('adminUploadFile', { mime: 'image/jpeg', name: file.name, data: await AdminStock.shrinkImage(file) })).id;
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
    const del = m.el.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => {
      if (!(await Confirm.open({ title: '刪除這筆？', rows: [['日期', roc(e.date)], [e.account, `${e.category} ${signed(e.effect)} 元`]], note: e.type === '移轉' ? '移轉的兩筆會一起刪掉。' : '', confirmText: '刪除', danger: true }))) return;
      Busy.show('刪除中⋯');
      try { await Api.admin('adminShopLedgerDelete', { id: e.id }); Busy.hide(); m.close(); after(); } catch (err) { Busy.hide(); if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; } box.innerHTML = errorHtml(err); box.hidden = false; }
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      m.el.setAttribute('data-locked', '');
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopLedgerSave', { entry: { id: e ? e.id : '', date: f.elements.date ? f.elements.date.value : '', type: kind, account,
          category: f.elements.category ? f.elements.category.value.trim() : '', amount: f.elements.amount ? f.elements.amount.value.trim() : '', note: f.elements.note.value, receipt } });
        Busy.hide();
        m.close();
        after();
      } catch (err) {
        Busy.hide();
        m.el.removeAttribute('data-locked');
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        box.innerHTML = errorHtml(err);
        box.hidden = false;
      }
    });
  }

  /** 🔁 移轉：存提款（零用金↔銀行）、收回應收、付清應付 */
  function transferForm(guard, after) {
    const d = data;
    const KINDS = [['存提款', '🏦 存提款', '零用金存進銀行，或從銀行領出來'], ['收回應收', '📥 收回應收', '別人欠的錢收到了'], ['付清應付', '📤 付清應付', '欠的錢付掉了']];
    let kind = '存提款';
    let from = '零用金';
    let to = '銀行存款';
    const m = Modal.open(`
      <form class="modal-form admin-form" novalidate>
        <h2 class="modal-title">🔁 移轉</h2>
        <p class="hint">錢在帳戶之間移動，不算收入、支出。</p>
        <div class="pos-chips ledger-kinds" data-kinds></div>
        <div data-dir></div>
        <label class="form-row"><span>日期</span><input class="input" type="date" name="date" max="${esc(d.today)}" value="${esc(d.today > d.to ? d.to : d.today)}"></label>
        <label class="form-row"><span>金額（元）</span><input class="input" name="amount" inputmode="numeric" maxlength="7" placeholder="例：5000"></label>
        <label class="form-row"><span>摘要（選填）</span><input class="input" name="note" maxlength="200" placeholder="例：出攤的現金存進銀行"></label>
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const box = f.querySelector('[data-error]');
    const cashChips = (name, cur) => ['零用金', '銀行存款'].map((a) => `<button type="button" class="pos-chip${cur === a ? ' is-checked' : ''}" data-${name}="${a}">${a}</button>`).join('');
    const draw = () => {
      f.querySelector('[data-kinds]').innerHTML = KINDS.map(([k, l, h]) => `<button type="button" class="pos-chip${kind === k ? ' is-checked' : ''}" data-kind="${k}" title="${h}">${l}</button>`).join('');
      const dir = f.querySelector('[data-dir]');
      dir.innerHTML = kind === '存提款'
        ? `<div class="form-row"><span>從</span><div class="pos-chips">${cashChips('from', from)}</div></div><div class="form-row"><span>到</span><div class="pos-chips">${cashChips('to', to)}</div></div>`
        : kind === '收回應收'
          ? `<p class="hint">應收帳款減少，收到的錢放進：</p><div class="pos-chips">${cashChips('to', to)}</div>`
          : `<p class="hint">應付帳款減少，用哪裡的錢付：</p><div class="pos-chips">${cashChips('from', from)}</div>`;
      f.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; if (kind === '收回應收') to = '零用金'; draw(); }));
      f.querySelectorAll('[data-from]').forEach((b) => b.addEventListener('click', () => { from = b.dataset.from; if (kind === '存提款' && to === from) to = from === '零用金' ? '銀行存款' : '零用金'; draw(); }));
      f.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => { to = b.dataset.to; if (kind === '存提款' && to === from) from = to === '零用金' ? '銀行存款' : '零用金'; draw(); }));
    };
    draw();
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopLedgerTransfer', { kind, from, to, date: f.elements.date.value, amount: f.elements.amount.value.trim(), note: f.elements.note.value });
        Busy.hide();
        m.close();
        after();
      } catch (err) {
        Busy.hide();
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        box.innerHTML = errorHtml(err);
        box.hidden = false;
      }
    });
  }

  /** 期初餘額：這一年 1/1 各帳戶有多少（第一次用才需要；之後的年度自動接續） */
  function openingForm(guard, after) {
    const d = data;
    const m = Modal.open(`
      <form class="modal-form admin-form" novalidate>
        <h2 class="modal-title">${rocYear(d.year)} 年期初餘額</h2>
        <p class="hint">開始用記帳時，填 ${rocYear(d.year)}.01.01 各帳戶原本有多少（應收＝別人欠我們、應付＝我們欠別人）。之後的年度會自動接續，不用再填。</p>
        ${ACCOUNTS.map((a) => { const x = d.accounts.find((y) => y.name === a); return `<label class="form-row"><span>${a}${x.opening !== (x.openingSet || 0) ? `<small class="muted">（之前的紀錄累積 ${signed(x.opening - (x.openingSet || 0))}）</small>` : ''}</span><input class="input" name="${a}" inputmode="numeric" maxlength="8" value="${x.openingSet !== null ? esc(x.openingSet) : ''}" placeholder="0"></label>`; }).join('')}
        <div class="form-error" data-error hidden></div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-block btn-primary">存檔</button>
          <button type="button" class="btn btn-block" data-close>返回</button>
        </div>
      </form>`);
    const f = m.el.querySelector('form');
    const box = f.querySelector('[data-error]');
    m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      Busy.show('存檔中⋯');
      try {
        await Api.admin('adminShopLedgerOpening', { year: d.year, balances: Object.fromEntries(ACCOUNTS.map((a) => [a, f.elements[a].value.trim()])) });
        Busy.hide();
        m.close();
        after();
      } catch (err) {
        Busy.hide();
        if (err.code === 'UNAUTHORIZED') { m.close(); guard(err); return; }
        box.innerHTML = errorHtml(err);
        box.hidden = false;
      }
    });
  }

  return { show };
})();
