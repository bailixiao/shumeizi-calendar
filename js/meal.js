// 吃飯（spec 第 0.5 節＋2026/10/16 訂餐重新設計）：勾了「我會一起吃飯」後點餐＋備註，有餐費時選付款方式。
//   - 選項（mealMode 空白）：每組選一個；選項可以帶價錢（prices 和 options 一一對應）。
//   - 自己點（mealMode＝'自己點'）：看菜單自己一行一行打「要吃什麼、單價、份數」。
// 報名頁、查我的報名、後台幫人報名共用。groups＝[{ name, options, prices }]（活動的 mealOptions）。
window.MealUI = (function () {
  const esc = (s) => Fmt.esc(s);
  const SELF = '自己點';
  const MAX_LINES = 10;
  const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US');

  // ---------- 訂餐截止 ----------

  /** 台北現在時間 'yyyy-MM-dd HH:mm' */
  function nowTaipei() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  }

  /** 某一天的訂餐截止 'yyyy-MM-dd HH:mm'（cutoff＝{ days, time }，沒有就前 1 天 12:00） */
  function deadline(cutoff, date) {
    const c = cutoff || { days: 1, time: '12:00' };
    const t = new Date(date + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() - (Number(c.days) || 0));
    return t.toISOString().slice(0, 10) + ' ' + (c.time || '12:00');
  }

  function isOpen(cutoff, date) { return nowTaipei() < deadline(cutoff, date); }

  /** 截止時間的顯示：「10/15（四）12:00」 */
  function deadlineText(dl) {
    return Fmt.shortDate(dl.slice(0, 10)) + ' ' + dl.slice(11, 16);
  }

  // ---------- 菜單 ----------

  /** 菜單：連結按鈕、說明（網址可以點）、照片 */
  function menuHtml(d) {
    if (!d || (!d.menuUrl && !d.menuNote && !(d.menuPhotos || []).length)) return '';
    const note = esc(d.menuNote || '').replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`).replace(/\n/g, '<br>');
    return `<div class="meal-menu-box">
      <p class="meal-menu-head">📋 這次的菜單</p>
      ${d.menuNote ? `<p class="meal-menu-note">${note}</p>` : ''}
      ${(d.menuPhotos || []).length ? `<div class="meal-menu-photos">${d.menuPhotos.map((p) => `<a href="${esc(Api.fileUrl(p.id))}" target="_blank" rel="noopener"><img src="${esc(Api.fileUrl(p.id))}" alt="菜單" loading="lazy"></a>`).join('')}</div>` : ''}
      ${d.menuUrl ? `<a class="btn btn-small" href="${esc(d.menuUrl)}" target="_blank" rel="noopener">📍 看菜單／店家</a>` : ''}
    </div>`;
  }

  // ---------- 選項 ----------

  /** 選項與備註的畫面；key 用來區分同一頁的好幾個人 */
  function html(groups, choice, note, key, missing) {
    choice = choice || {};
    return `<div class="meal-pick" data-meal-box="${esc(key)}">
      ${(groups || []).map((g, gi) => `
        <div class="meal-group${missing && !choice[g.name] ? ' is-missing' : ''}">
          <span class="meal-group-name">${esc(g.name)}</span>
          <div class="pos-chips" role="radiogroup" aria-label="${esc(g.name)}">
            ${g.options.map((o, oi) => { const p = g.prices && g.prices[oi]; return `<label class="pos-chip${choice[g.name] === o ? ' is-checked' : ''}">
              <input type="radio" name="meal-${esc(key)}-${gi}" value="${esc(o)}" data-meal-pick="${esc(key)}" data-meal-group="${esc(g.name)}"${choice[g.name] === o ? ' checked' : ''}>${esc(o)}${p ? `<small class="meal-price">${money(p)}</small>` : ''}</label>`; }).join('')}
          </div>
        </div>`).join('')}
      <input class="input meal-note" maxlength="50" placeholder="備註（選填，例：不吃辣、少飯）" value="${esc(note || '')}" data-meal-note="${esc(key)}">
    </div>`;
  }

  // ---------- 自己點 ----------

  function blankLine() { return { name: '', price: '', qty: 1 }; }

  /** 自己點的畫面：一行一樣（要吃什麼、單價、份數），小計，備註 */
  function orderHtml(lines, note, key, missing) {
    lines = lines && lines.length ? lines : [blankLine()];
    return `<div class="meal-order${missing ? ' is-missing' : ''}" data-order-box="${esc(key)}">
      ${lines.map((l, i) => `<div class="order-line">
        <input class="input order-name" maxlength="30" placeholder="要吃什麼" value="${esc(l.name || '')}" data-order="${esc(key)}" data-oi="${i}" data-of="name" aria-label="第 ${i + 1} 樣要吃什麼">
        <label class="order-price"><span>$</span><input class="input" type="number" inputmode="numeric" min="0" max="9999" placeholder="單價" value="${esc(l.price === 0 ? '0' : l.price || '')}" data-order="${esc(key)}" data-oi="${i}" data-of="price" aria-label="單價"></label>
        <label class="order-qty"><span>×</span><input class="input" type="number" inputmode="numeric" min="1" max="20" value="${esc(l.qty || 1)}" data-order="${esc(key)}" data-oi="${i}" data-of="qty" aria-label="份數"></label>
        ${lines.length > 1 ? `<button type="button" class="btn-remove" data-order-del="${esc(key)}" data-oi="${i}" aria-label="刪掉這一樣">×</button>` : ''}
      </div>`).join('')}
      <div class="order-foot">
        ${lines.length < MAX_LINES ? `<button type="button" class="link-btn" data-order-add="${esc(key)}">＋ 再加一樣</button>` : '<span></span>'}
        <span class="order-sum" data-order-sum="${esc(key)}">小計 ${money(orderTotal(lines))}</span>
      </div>
      <input class="input meal-note" maxlength="50" placeholder="備註（選填，例：不吃辣、少飯）" value="${esc(note || '')}" data-meal-note="${esc(key)}">
    </div>`;
  }

  /** 有填名稱的行 */
  function filled(lines) { return (lines || []).filter((l) => String(l.name || '').trim()); }

  function orderTotal(lines) {
    return filled(lines).reduce((a, l) => a + (Number(l.price) || 0) * (Number(l.qty) || 1), 0);
  }

  /** 送出用：只留有名稱的行 */
  function orderPayload(lines) {
    return filled(lines).map((l) => ({ name: String(l.name).trim(), price: String(l.price === '' || l.price === undefined ? 0 : l.price), qty: String(l.qty || 1) }));
  }

  /**
   * 自己點畫面的事件（不重畫，免得游標跑掉）：打字、加一行、刪一行。
   * getLines(key) 回傳那個人的 lines 陣列（會直接改它）；rerender(key) 加行／刪行後重畫；onChange() 金額變了。
   */
  function bindOrder(root, getLines, rerender, onChange) {
    root.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.dataset.order === undefined) return;
      const lines = getLines(t.dataset.order);
      const l = lines[Number(t.dataset.oi)];
      if (!l) return;
      l[t.dataset.of] = t.value;
      const sum = root.querySelector(`[data-order-sum="${CSS.escape(t.dataset.order)}"]`);
      if (sum) sum.textContent = '小計 ' + money(orderTotal(lines));
      const box = t.closest('.meal-order');
      if (box && filled(lines).length) box.classList.remove('is-missing');
      if (onChange) onChange();
    });
    root.addEventListener('click', (ev) => {
      const add = ev.target.closest('[data-order-add]');
      const del = ev.target.closest('[data-order-del]');
      if (add) {
        const lines = getLines(add.dataset.orderAdd);
        if (lines.length < MAX_LINES) lines.push(blankLine());
        rerender(add.dataset.orderAdd);
        const inputs = root.querySelectorAll(`[data-order="${CSS.escape(add.dataset.orderAdd)}"][data-of="name"]`);
        if (inputs.length) inputs[inputs.length - 1].focus();
      } else if (del) {
        const lines = getLines(del.dataset.orderDel);
        lines.splice(Number(del.dataset.oi), 1);
        if (!lines.length) lines.push(blankLine());
        rerender(del.dataset.orderDel);
        if (onChange) onChange();
      }
    });
  }

  // ---------- 餐費、付款 ----------

  /** 一個人一天的餐費。d＝{ mealMode, mealOptions }；e＝{ mealChoice, mealOrder } */
  function feeOf(d, e) {
    if (!e) return 0;
    if (d.mealMode === SELF) return orderTotal(e.mealOrder);
    let sum = 0;
    (d.mealOptions || []).forEach((g) => {
      const i = g.options.indexOf((e.mealChoice || {})[g.name]);
      if (i !== -1) sum += Number(g.prices && g.prices[i]) || 0;
    });
    return sum;
  }

  /** 付款方式（現場付現／轉帳）＋末五碼；total＝要付的錢 */
  function payHtml(total, pay, last5, line) {
    if (!total) return '';
    return `<div class="meal-pay">
      <p class="meal-pay-total">🍱 餐費共 <strong>${money(total)}</strong>${line ? `<small>（${esc(line)}）</small>` : ''}</p>
      <div class="pos-chips" role="radiogroup" aria-label="餐費怎麼付">
        ${[['現場', '💵 現場付現'], ['轉帳', '🏦 轉帳']].map(([v, l]) => `<label class="pos-chip${pay === v ? ' is-checked' : ''}"><input type="radio" name="meal-pay" value="${v}" data-meal-pay${pay === v ? ' checked' : ''}>${l}</label>`).join('')}
      </div>
      ${pay === '轉帳' ? `<label class="meal-last5"><span>轉帳末五碼（轉好再填，也可以之後在「查我的報名」補）</span>
        <input class="input" inputmode="numeric" maxlength="5" pattern="\\d{5}" placeholder="例：12345" value="${esc(last5 || '')}" data-meal-last5></label>
        <p class="hint">轉帳帳號會在報名成功後顯示。</p>` : ''}
    </div>`;
  }

  // ---------- 共用 ----------

  /** 從畫面讀回 { mealChoice, mealNote }（選項） */
  function read(box) {
    const mealChoice = {};
    box.querySelectorAll('[data-meal-pick]:checked').forEach((r) => { mealChoice[r.dataset.mealGroup] = r.value; });
    const n = box.querySelector('[data-meal-note]');
    return { mealChoice, mealNote: n ? n.value.trim() : '' };
  }

  /** 還沒選的組（第一個），都選了回傳 '' */
  function missing(groups, choice) {
    const g = (groups || []).find((x) => !(choice || {})[x.name]);
    return g ? g.name : '';
  }

  /** 這個人的點餐還缺什麼（'' ＝沒問題） */
  function problem(d, e) {
    if (d.mealMode === SELF) {
      const lines = e.mealOrder || [];
      if (!filled(lines).length) return '請填要吃什麼';
      const bad = filled(lines).find((l) => !/^\d{0,4}$/.test(String(l.price === undefined ? '' : l.price).trim()) || !(Number(l.qty || 1) >= 1 && Number(l.qty || 1) <= 20));
      return bad ? `「${bad.name}」的單價或份數不對` : '';
    }
    const g = missing(d.mealOptions, e.mealChoice);
    return g ? '請選「' + g + '」' : '';
  }

  /** 標籤用：選項「素便當・紅茶」；自己點「素便當×2・紅茶」 */
  function label(groups, choice) {
    choice = choice || {};
    return (groups && groups.length ? groups.map((g) => choice[g.name]) : Object.values(choice)).filter(Boolean).join('・');
  }

  function labelOf(e) {
    if (e && Array.isArray(e.mealOrder)) return filled(e.mealOrder).map((l) => l.name + (Number(l.qty) > 1 ? '×' + l.qty : '')).join('・');
    return label(null, e && e.mealChoice);
  }

  /** 點選項時更新 is-checked 樣式 */
  function bindChips(root) {
    root.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.mealPick === undefined && t.dataset.mealPay === undefined) return;
      root.querySelectorAll(`input[name="${CSS.escape(t.name)}"]`).forEach((r) => r.closest('.pos-chip').classList.toggle('is-checked', r.checked));
      const g = t.closest('.meal-group');
      if (g) g.classList.remove('is-missing');
    });
  }

  /**
   * 改吃飯的對話框（查我的報名、後台）。
   * opts = { title, sub, d: { mealMode, mealOptions, menuUrl, menuNote, menuPhotos }, meal, choice, order, note, pay, last5, submit(body) → Promise }
   * body = { meal, mealChoice, mealOrder, mealNote, mealPay, mealLast5 }；成功回傳 submit 的結果，按返回回傳 null。
   */
  function edit(opts) {
    const d = opts.d || { mealOptions: opts.groups || [] };
    const self = d.mealMode === SELF;
    const st = { meal: !!opts.meal, choice: Object.assign({}, opts.choice), order: (opts.order || []).map((l) => Object.assign({}, l)), pay: opts.pay || '', last5: opts.last5 || '' };
    if (!st.order.length) st.order.push(blankLine());
    return new Promise((resolve) => {
      let done = false;
      const m = Modal.open(`
        <form class="modal-form" novalidate>
          <h2 class="modal-title">${esc(opts.title || '🍱 改吃飯')}</h2>
          ${opts.sub ? `<p class="modal-note">${esc(opts.sub)}</p>` : ''}
          <label class="check"><input type="checkbox" name="meal"${st.meal ? ' checked' : ''}> 🍱 我會一起吃飯</label>
          <div data-meal-area${st.meal ? '' : ' hidden'}>
            ${menuHtml(d)}
            <div data-pick-area>${self ? orderHtml(st.order, opts.note, 'edit') : html(d.mealOptions, st.choice, opts.note, 'edit')}</div>
            <div data-pay-area></div>
          </div>
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-block btn-primary">儲存</button>
            <button type="button" class="btn btn-block" data-close>返回</button>
          </div>
        </form>`, () => { if (!done) resolve(null); });
      const f = m.el.querySelector('form');
      const fee = () => (st.meal ? feeOf(d, { mealChoice: st.choice, mealOrder: st.order }) : 0);
      const renderPay = () => { f.querySelector('[data-pay-area]').innerHTML = payHtml(fee(), st.pay, st.last5); };
      const noteVal = () => { const n = f.querySelector('[data-meal-note]'); return n ? n.value : opts.note; };
      renderPay();
      bindChips(f);
      if (self) bindOrder(f, () => st.order, () => { const note = noteVal(); f.querySelector('[data-pick-area]').innerHTML = orderHtml(st.order, note, 'edit'); renderPay(); }, renderPay);
      f.addEventListener('change', (ev) => {
        const t = ev.target;
        if (t.name === 'meal') { st.meal = t.checked; f.querySelector('[data-meal-area]').hidden = !st.meal; renderPay(); }
        if (t.dataset.mealPick !== undefined) { st.choice[t.dataset.mealGroup] = t.value; renderPay(); }
        if (t.dataset.mealPay !== undefined) { st.pay = t.value; renderPay(); }
      });
      f.addEventListener('input', (ev) => { if (ev.target.dataset.mealLast5 !== undefined) st.last5 = ev.target.value.trim(); });
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const box = f.querySelector('[data-error]');
        const note = String(noteVal() || '').trim();
        const why = st.meal ? problem(d, { mealChoice: st.choice, mealOrder: st.order }) : '';
        const payWhy = st.meal && fee() && !st.pay ? '請選餐費怎麼付' : st.last5 && !/^\d{5}$/.test(st.last5) ? '轉帳末五碼要是 5 個數字' : '';
        if (why || payWhy) {
          box.textContent = why || payWhy;
          box.hidden = false;
          if (!self && why) f.querySelectorAll('.meal-group').forEach((g, i) => g.classList.toggle('is-missing', !st.choice[d.mealOptions[i].name]));
          return;
        }
        m.el.setAttribute('data-locked', '');
        Busy.show('儲存中⋯');
        try {
          const res = await opts.submit({
            meal: st.meal,
            mealChoice: st.meal && !self ? st.choice : {},
            mealOrder: st.meal && self ? orderPayload(st.order) : [],
            mealNote: st.meal ? note : '',
            mealPay: st.meal && fee() ? st.pay : '',
            mealLast5: st.meal && fee() && st.pay === '轉帳' ? st.last5 : ''
          });
          Busy.hide();
          done = true;
          m.close();
          resolve(res || {});
        } catch (err) {
          Busy.hide();
          m.el.removeAttribute('data-locked');
          box.textContent = err.message || '儲存失敗';
          box.hidden = false;
        }
      });
    });
  }

  return {
    SELF, money, nowTaipei, deadline, isOpen, deadlineText, menuHtml, html, orderHtml, bindOrder, orderTotal, orderPayload, blankLine,
    feeOf, payHtml, read, missing, problem, label, labelOf, bindChips, edit
  };
})();
