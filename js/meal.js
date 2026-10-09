// 吃飯的餐點選項（spec 第 0.5 節）：勾了「我會一起吃飯」後，每組選一個＋備註。
// 報名頁、查我的報名、後台幫人報名共用。groups＝[{ name, options }]（活動的 mealOptions）。
window.MealUI = (function () {
  const esc = (s) => Fmt.esc(s);

  /** 選項與備註的畫面；key 用來區分同一頁的好幾個人 */
  function html(groups, choice, note, key, missing) {
    choice = choice || {};
    return `<div class="meal-pick" data-meal-box="${esc(key)}">
      ${(groups || []).map((g, gi) => `
        <div class="meal-group${missing && !choice[g.name] ? ' is-missing' : ''}">
          <span class="meal-group-name">${esc(g.name)}</span>
          <div class="pos-chips" role="radiogroup" aria-label="${esc(g.name)}">
            ${g.options.map((o) => `<label class="pos-chip${choice[g.name] === o ? ' is-checked' : ''}">
              <input type="radio" name="meal-${esc(key)}-${gi}" value="${esc(o)}" data-meal-pick="${esc(key)}" data-meal-group="${esc(g.name)}"${choice[g.name] === o ? ' checked' : ''}>${esc(o)}</label>`).join('')}
          </div>
        </div>`).join('')}
      <input class="input meal-note" maxlength="50" placeholder="備註（選填，例：不吃辣、少飯）" value="${esc(note || '')}" data-meal-note="${esc(key)}">
    </div>`;
  }

  /** 從畫面讀回 { mealChoice, mealNote } */
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

  /** 標籤用：「素便當・紅茶」 */
  function label(groups, choice) {
    choice = choice || {};
    return (groups && groups.length ? groups.map((g) => choice[g.name]) : Object.values(choice)).filter(Boolean).join('・');
  }

  /** 點選項時更新 is-checked 樣式 */
  function bindChips(root) {
    root.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.mealPick === undefined) return;
      root.querySelectorAll(`input[name="${CSS.escape(t.name)}"]`).forEach((r) => r.closest('.pos-chip').classList.toggle('is-checked', r.checked));
      const g = t.closest('.meal-group');
      if (g) g.classList.remove('is-missing');
    });
  }

  /**
   * 改吃飯的對話框（查我的報名、後台）。opts = { title, sub, groups, meal, choice, note, submit(body) → Promise }
   * body = { meal, mealChoice, mealNote }；成功回傳 submit 的結果，按返回回傳 null。
   */
  function edit(opts) {
    return new Promise((resolve) => {
      let done = false;
      const m = Modal.open(`
        <form class="modal-form" novalidate>
          <h2 class="modal-title">${esc(opts.title || '🍱 改吃飯')}</h2>
          ${opts.sub ? `<p class="modal-note">${esc(opts.sub)}</p>` : ''}
          <label class="check"><input type="checkbox" name="meal"${opts.meal ? ' checked' : ''}> 🍱 我會一起吃飯</label>
          <div data-meal-area${opts.meal ? '' : ' hidden'}>${html(opts.groups, opts.choice, opts.note, 'edit')}</div>
          <div class="form-error" data-error hidden></div>
          <div class="modal-actions">
            <button type="submit" class="btn btn-block btn-primary">儲存</button>
            <button type="button" class="btn btn-block" data-close>返回</button>
          </div>
        </form>`, () => { if (!done) resolve(null); });
      const f = m.el.querySelector('form');
      bindChips(f);
      f.elements.meal.addEventListener('change', () => { f.querySelector('[data-meal-area]').hidden = !f.elements.meal.checked; });
      m.el.querySelector('[data-close]').addEventListener('click', () => m.close());
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const box = f.querySelector('[data-error]');
        const meal = f.elements.meal.checked;
        const v = read(f);
        const miss = meal ? missing(opts.groups, v.mealChoice) : '';
        if (miss) {
          box.textContent = '請選「' + miss + '」';
          box.hidden = false;
          f.querySelectorAll('.meal-group').forEach((g, i) => g.classList.toggle('is-missing', !v.mealChoice[opts.groups[i].name]));
          return;
        }
        m.el.setAttribute('data-locked', '');
        Busy.show('儲存中⋯');
        try {
          const res = await opts.submit({ meal, mealChoice: meal ? v.mealChoice : {}, mealNote: meal ? v.mealNote : '' });
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

  return { html, read, missing, label, bindChips, edit };
})();
