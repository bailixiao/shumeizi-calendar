// 圖解教學（常見問題頁最上面）：一步一步的手機畫面，分 iPhone／Android。
// 圖片在 img/tutorial/（node tools/tutorial-shots.js 用示範版、假名拍攝）：兩種手機一樣的寫 NN.jpg，不一樣的寫 ios-NN.jpg／android-NN.jpg。
(function () {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 兩種手機畫面不一樣的步驟（圖片由 tools/tutorial-shots.js 產生，編號要一致）
  const DIFF = ['03', '04', '05', '24', '25'];
  // 每一步的標題（iPhone、Android 不同的寫成 [iPhone, Android]）
  const STEPS = {
    '01': '在 LINE 打開網址後，點右上角的選單',
    '02': '選「用預設瀏覽器開啟」',
    '03': ['把網站放到桌面：點下面的「分享」', '把網站放到桌面：點右上角「⋮」'],
    '04': ['往上滑，點「加入主畫面」', '點「加到主畫面」'],
    '05': ['按右上角的「加入」', '按「安裝」或「新增」'],
    '06': '回到主畫面，點「書槑子行事曆」',
    '07': '按「近期」看最近的活動',
    '08': '這個框：志工還缺人',
    '09': '也可以用月曆點日期',
    '10': '志工排班：先選項目',
    '11': '輸入名字，點跳出來的名字',
    '12': '第一次來？選怎麼認識我們',
    '13': '靈魂健身房這類活動：直接填名字',
    '14': '要一起吃飯就勾「🍱 我會一起吃飯」，選要吃、喝什麼',
    '15': '可以揪朋友一起報',
    '16': '按「我要去！」',
    '17': '看到「報名成功」就完成了 🎉',
    '18': '查我的報名：按這裡',
    '19': '打名字，點自己的名字',
    '20': '要取消或改期，按這裡',
    '21': '確認後才會取消',
    '22': '開啟手機提醒：按「🔔 手機提醒」',
    '23': '按「好的，請提醒我」',
    '24': '手機問要不要允許，按「允許」',
    '25': '收到通知，點一下就能看活動',
    '26': '有團購時，按「🛒 團購」',
    '27': '按「＋」選數量',
    '28': '選在哪一場取貨',
    '29': '填名字、選付款，按「送出訂單」',
    '30': '看到「訂好了」就完成了 🎉'
  };
  const CHAPTERS = [
    ['📲 把網站放到手機桌面', 1, 6],
    ['✍️ 報名活動', 7, 17],
    ['🔍 查我的報名、取消、改期', 18, 21],
    ['🔔 開啟手機提醒', 22, 25],
    ['🛒 團購', 26, 30]
  ];

  const KEY = 'shumeizi:tutorial-device';
  function device() {
    try { const v = localStorage.getItem(KEY); if (v === 'ios' || v === 'android') return v; } catch (e) { /* 無痕模式 */ }
    return /android/i.test(navigator.userAgent) ? 'android' : 'ios';
  }

  function stepHtml(n, dev) {
    const label = Array.isArray(STEPS[n]) ? STEPS[n][dev === 'ios' ? 0 : 1] : STEPS[n];
    const src = DIFF.indexOf(n) !== -1 ? `img/tutorial/${dev}-${n}.jpg` : `img/tutorial/${n}.jpg`;
    return `<li class="tut-step"><p class="tut-cap"><span class="tut-n">${Number(n)}</span>${esc(label)}</p><img src="${src}" alt="${esc(label)}" loading="lazy" width="540"></li>`;
  }

  function html() {
    const dev = device();
    return `
      <section class="tutorial">
        <h2 class="tut-title">📱 圖解教學<small>一步一步跟著做</small></h2>
        <div class="seg tut-device"><label class="seg-item"><input type="radio" name="tutDev" value="ios"${dev === 'ios' ? ' checked' : ''}><span>iPhone</span></label><label class="seg-item"><input type="radio" name="tutDev" value="android"${dev === 'android' ? ' checked' : ''}><span>Android</span></label></div>
        ${CHAPTERS.map(([title, from, to]) => {
          const nums = [];
          for (let i = from; i <= to; i++) nums.push(String(i).padStart(2, '0'));
          return `<details class="tut-chapter"><summary>${esc(title)}<small>${nums.length} 步</small></summary><ol class="tut-steps">${nums.map((n) => stepHtml(n, dev)).join('')}</ol></details>`;
        }).join('')}
      </section>`;
  }

  /** 把圖解教學放進 box；換手機種類時重畫（保留打開的章節） */
  function mount(box) {
    box.innerHTML = html();
    box.querySelectorAll('input[name=tutDev]').forEach((r) => r.addEventListener('change', () => {
      try { localStorage.setItem(KEY, r.value); } catch (e) { /* 無痕模式 */ }
      const open = [...box.querySelectorAll('.tut-chapter')].map((d) => d.open);
      mount(box);
      box.querySelectorAll('.tut-chapter').forEach((d, i) => { d.open = open[i]; });
    }));
  }

  const api = { mount, STEPS, DIFF, CHAPTERS };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Tutorial = api;
})();
