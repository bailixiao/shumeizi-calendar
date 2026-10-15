// 後台「🍱 訂餐統計」（spec 0.5 訂餐重新設計）：#/admin/meals?duty=ID&date=yyyy-MM-dd
//   選一場有吃飯的活動，看各餐點總份數、餐費（已付／未付）、每個人點了什麼，勾「已付款」，複製給店家。
window.MealAdmin = (function () {
  'use strict';
  const esc = (s) => Fmt.esc(s);
  const money = (n) => MealUI.money(n);

  /** 複製給店家：品項、份數、備註（不含名字、錢） */
  function shopText(name, date, sum) {
    return [`${name} ${Fmt.shortDate(date)}`, `共 ${sum.total} 位`]
      .concat(sum.items.length ? sum.items.map((x) => `${x.name} × ${x.qty}`) : ['（還沒有人點）'])
      .concat(sum.notes.length ? ['備註：'].concat(sum.notes.map((n) => `・${n.note}`)) : [])
      .join('\n');
  }

  function parse(sub) {
    const q = new URLSearchParams(String(sub || '').split('?')[1] || '');
    return { dutyId: q.get('duty') || '', date: q.get('date') || '' };
  }

  async function show(body, guard, sub) {
    const want = parse(sub);
    let data;
    try {
      data = await Api.admin('adminMealOrders', want, true);
    } catch (err) {
      if (!guard(err)) body.innerHTML = `<div class="notice notice-error"><p>${esc(err.message || '讀取失敗')}</p></div>`;
      return;
    }
    render(body, data, guard);
  }

  function render(body, data, guard, flash) {
    const sel = data.selected;
    if (!sel) {
      body.innerHTML = '<h2>🍱 訂餐統計</h2><p class="panel-empty">最近（30 天前到 90 天後）沒有「有吃飯」的活動。新增或編輯活動時勾「🍱 這次有吃飯」就會出現在這裡。</p>';
      return;
    }
    const key = (e) => e.dutyId + '|' + e.date;
    body.innerHTML = `
      <h2>🍱 訂餐統計</h2>
      ${flash || ''}
      <label class="form-row"><span>活動</span>
        <select class="input" data-pick>${data.events.map((e) => `<option value="${esc(key(e))}"${key(e) === key(sel) ? ' selected' : ''}>${esc(Fmt.shortDate(e.date))} ${esc(e.name)}・🍱 ${e.count} 位</option>`).join('')}</select></label>
      <div class="meal-admin-info">
        <p>${sel.mode === MealUI.SELF ? '點餐方式：自己點（看菜單打）' : '點餐方式：選項'}・訂餐截止 ${esc(MealUI.deadlineText(sel.deadline))}${sel.open ? '' : '<span class="tag">已截止</span>'}</p>
        <p>${sel.menuUrl ? `<a class="btn btn-small" href="${esc(sel.menuUrl)}" target="_blank" rel="noopener">📍 菜單／店家</a> ` : ''}<a class="btn btn-small" href="#/admin/duty/${encodeURIComponent(sel.dutyId)}?date=${sel.date}">看名單 ›</a></p>
      </div>
      <div class="stat-tiles">
        <div class="stat-tile"><span>吃飯</span><strong>${sel.total} 位</strong></div>
        <div class="stat-tile"><span>餐費</span><strong>${money(sel.fee)}</strong></div>
        <div class="stat-tile"><span>已付</span><strong>${money(sel.paid)}</strong></div>
        <div class="stat-tile${sel.unpaid ? ' is-warn' : ''}"><span>未付</span><strong>${money(sel.unpaid)}</strong></div>
      </div>
      <h3>各餐點份數 ${sel.total ? '<button type="button" class="btn btn-small" data-copy>📋 複製給店家</button>' : ''}</h3>
      ${sel.items.length ? `<table class="stock-table"><thead><tr><th>餐點</th><th>份數</th></tr></thead><tbody>${sel.items.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.qty}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">還沒有人點。</p>'}
      ${sel.notes.length ? `<h3>備註</h3><ul class="meal-notes">${sel.notes.map((n) => `<li>${esc(n.name)}：${esc(n.note)}</li>`).join('')}</ul>` : ''}
      <h3>每個人</h3>
      ${sel.people.length ? `<div class="stock-table-wrap"><table class="stock-table meal-people"><thead><tr><th>名字</th><th>點了什麼</th><th>餐費・付款</th></tr></thead><tbody>
        ${sel.people.map((p) => `<tr>
          <td>${esc(p.name)}</td>
          <td>${esc(p.label || '（只勾吃飯）')}${p.note ? `<br><small class="muted">備註：${esc(p.note)}</small>` : ''}</td>
          <td class="meal-fee-cell">${p.fee ? `<strong>${money(p.fee)}</strong><br><small>${esc(p.pay === '轉帳' ? '轉帳' + (p.last5 ? '（' + p.last5 + '）' : '（還沒填末五碼）') : '現場付現')}</small><br><label class="check"><input type="checkbox" data-paid="${esc(p.signupId)}"${p.paid ? ' checked' : ''}> 已付</label>` : '—'}</td>
        </tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">還沒有人要吃飯。</p>'}`;

    body.querySelector('[data-pick]').addEventListener('change', (ev) => {
      const [dutyId, date] = ev.target.value.split('|');
      location.hash = `#/admin/meals?duty=${encodeURIComponent(dutyId)}&date=${date}`;
    });
    const copy = body.querySelector('[data-copy]');
    if (copy) copy.addEventListener('click', async () => {
      copy.textContent = (await Share.copyText(shopText(sel.name, sel.date, sel))) ? '已複製 ✓' : '複製失敗';
      setTimeout(() => { copy.textContent = '📋 複製給店家'; }, 2500);
    });
    body.querySelectorAll('[data-paid]').forEach((c) => c.addEventListener('change', async () => {
      c.disabled = true;
      try {
        await Api.admin('adminMealPaid', { signupId: c.dataset.paid, paid: c.checked });
        const again = await Api.admin('adminMealOrders', { dutyId: sel.dutyId, date: sel.date });
        render(body, again, guard);
      } catch (err) {
        c.checked = !c.checked;
        c.disabled = false;
        if (!guard(err)) alert(err.message || '沒有存到，請再試一次');
      }
    }));
  }

  return { show, shopText };
})();
