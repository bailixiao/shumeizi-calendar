// 自動的資料（規格第 4 節）：近期活動、開放中的團購，從行事曆 API 讀；讀不到就顯示「到行事曆看」。
//   <div data-events data-cat="道務" data-limit="3" data-days="60"></div>  data-cat 空白＝全部類別
//   <div data-shop></div>
//   <a data-cal data-cal-path="#/shop">⋯</a>  連到行事曆（本機／正式自動換網址）
(function () {
  'use strict';

  const CFG = window.SITE_CONFIG;
  const CAT = {
    道務: { label: '靈魂健身房', icon: '🧡', cls: 'cat-gym' },
    教育: { label: '槑青韜課館', icon: '❤️', cls: 'cat-taoke' },
    植素: { label: '植素園工作坊', icon: '🌿', cls: 'cat-zhisu' },
    勤務: { label: '志工', icon: '🙌', cls: 'cat-vol' }
  };
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const md = (s) => { const d = parse(s); return { m: d.getMonth() + 1, d: d.getDate(), w: WEEK[d.getDay()] }; };
  const calUrl = (p) => CFG.CAL + (p || '');
  const fileUrl = (id) => CFG.API + (CFG.API.indexOf('?') === -1 ? '?' : '&') + 'action=file&id=' + encodeURIComponent(id);

  document.querySelectorAll('[data-cal]').forEach((a) => { a.href = calUrl(a.dataset.calPath); });

  async function get(params) {
    const url = CFG.API + (CFG.API.indexOf('?') === -1 ? '?' : '&') + new URLSearchParams(params);
    const r = await fetch(url);
    const j = await r.json();
    if (!j.ok) throw new Error((j.error && j.error.message) || '讀取失敗');
    return j.data;
  }

  let eventsPromise = null;
  function loadEvents(days) {
    if (!eventsPromise) {
      const today = new Date();
      const to = new Date(today.getTime() + days * 864e5);
      eventsPromise = get({ action: 'getEvents', from: ymd(today), to: ymd(to) });
    }
    return eventsPromise;
  }

  /** 每個活動一張卡（跨好幾天的活動用今天以後的第一天） */
  function eventCard(d, today, hideCat) {
    const date = d.start < today ? today : d.start;
    const c = CAT[d.category] || CAT.勤務;
    const t = md(date);
    const time = d.startTime ? d.startTime + (d.endTime ? '–' + d.endTime : '') : '';
    return `<li><a class="event ${c.cls}" href="${esc(calUrl('#/duty/' + encodeURIComponent(d.id) + '?date=' + date))}">
      <span class="event-date"><span class="event-md">${t.m}/${t.d}</span><span class="event-w">週${t.w}</span></span>
      <span class="event-body">
        ${hideCat ? '' : `<span class="event-cat">${c.icon} ${esc(c.label)}</span>`}
        <span class="event-name">${esc(d.name)}</span>
        <span class="event-meta">${esc([time, d.location].filter(Boolean).join('・'))}</span>
      </span>
      <span class="event-go">報名 ›</span>
    </a></li>`;
  }

  function fallback(text) {
    return `<p class="muted">${esc(text)}</p><a class="btn" href="${esc(calUrl())}">📅 到行事曆看最新活動</a>`;
  }

  document.querySelectorAll('[data-events]').forEach(async (box) => {
    const cat = box.dataset.cat || '';
    const limit = Number(box.dataset.limit) || 5;
    box.innerHTML = '<p class="muted loading">讀取近期活動⋯</p>';
    try {
      const data = await loadEvents(Number(box.dataset.days) || 60);
      const list = (data.duties || [])
        .filter((d) => d.mode !== '公告型' && (!cat || d.category === cat) && (d.end || d.start) >= data.today)
        .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : String(a.startTime).localeCompare(String(b.startTime))));
      if (!list.length) {
        box.innerHTML = fallback(cat ? '近期還沒排好下一次，可以先加官方 LINE 收通知。' : '近期還沒有活動，可以先加官方 LINE 收通知。');
        return;
      }
      box.innerHTML = `<ul class="events">${list.slice(0, limit).map((d) => eventCard(d, data.today, !!cat)).join('')}</ul>
        ${list.length > limit ? `<a class="more-link" href="${esc(calUrl())}">看全部活動 ›</a>` : ''}`;
    } catch (err) {
      box.innerHTML = fallback('暫時讀不到活動資料。');
    }
  });

  document.querySelectorAll('[data-shop]').forEach(async (box) => {
    try {
      const data = await get({ action: 'getShop' });
      const open = (data.groups || []).filter((g) => !g.closed); // 賣貨便、行事曆下單的團購都列（2026/10/10）
      if (!open.length) {
        box.innerHTML = box.dataset.empty ? `<p class="muted">${esc(box.dataset.empty)}</p>` : '';
        return;
      }
      box.innerHTML = open.map((g) => {
        const dl = g.deadline ? md(g.deadline.slice(0, 10)) : null;
        const photos = g.items.filter((it) => it.photo).slice(0, 3);
        // 賣貨便的團購：直接連到賣場（開新分頁）；行事曆下單：連到行事曆的團購頁
        const href = g.link || calUrl('#/shop/' + encodeURIComponent(g.id));
        return `<a class="shop-card" href="${esc(href)}"${g.link ? ' target="_blank" rel="noopener"' : ''}>
          <span class="shop-tag">🛒 團購開放中${g.link ? '・賣貨便' : ''}</span>
          <strong class="shop-name">${esc(g.name)}</strong>
          ${g.cover ? `<img class="shop-cover" src="${esc(fileUrl(g.cover))}" alt="${esc(g.name)}" loading="lazy">`
            : photos.length ? `<span class="shop-photos">${photos.map((it) => `<img src="${esc(fileUrl(it.photo))}" alt="${esc(it.name)}" loading="lazy">`).join('')}</span>` : ''}
          ${g.items.length ? `<span class="shop-items">${esc(g.items.map((it) => it.name).join('、'))}</span>` : g.description ? `<span class="shop-items">${esc(g.description)}</span>` : ''}
          ${dl ? `<span class="shop-dl">${dl.m}/${dl.d}（${dl.w}）${esc(g.deadline.slice(11))} 截止</span>` : ''}
          <span class="btn btn-primary">${g.link ? '到賣貨便下單 ›' : '我要訂 ›'}</span>
        </a>`;
      }).join('');
    } catch (err) {
      box.innerHTML = '';
    }
  });
})();
