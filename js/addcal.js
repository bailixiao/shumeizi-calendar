// 「加到手機行事曆」：報名成功、我的報名畫面上的按鈕。
//   - iPhone／iPad：產生 .ics 檔，系統直接跳出「加入行事曆」（前一天晚上 8 點提醒）。
//   - 其他（Android、電腦）：開 Google 日曆的新增活動畫面，按「儲存」即可。
// 內容只有勤務名稱、時間、地點與報名頁連結（不放名字）。
(function () {
  'use strict';

  const registry = new Map(); // key → { name, location, start, end, startTime, endTime, dutyId, date }
  let seq = 0;

  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /** 回傳按鈕 HTML；label 可自訂（例如多天時加日期） */
  function button(info, label) {
    const key = 'c' + (++seq);
    registry.set(key, info);
    return `<button type="button" class="btn btn-addcal" data-addcal="${key}">${Fmt.esc(label || '加到手機行事曆')}</button>`;
  }

  /** 台北時間 → UTC 'yyyyMMddTHHmmssZ' */
  function utcStamp(date, time) {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh - 8, mm)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /**
   * 這一天的起訖。單日勤務有開始時間：照時間（沒有結束時間算 2 小時，結束早於開始算隔天）；
   * 其他（多天勤務、沒寫時間）：整天。
   */
  function eventTimes(info) {
    const { date } = info;
    if (info.start === info.end && info.startTime) {
      let endDate = date;
      let endTime = info.endTime;
      if (!endTime) {
        const [h, m] = info.startTime.split(':').map(Number);
        endTime = `${String(Math.min(h + 2, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      } else if (endTime <= info.startTime) {
        endDate = Fmt.addDays(date, 1);
      }
      return { allDay: false, start: utcStamp(date, info.startTime), end: utcStamp(endDate, endTime) };
    }
    return { allDay: true, start: date.replace(/-/g, ''), end: Fmt.addDays(date, 1).replace(/-/g, '') };
  }

  function dutyUrl(info) {
    return `${location.origin}${location.pathname}#/duty/${encodeURIComponent(info.dutyId)}?date=${info.date}`;
  }

  function googleUrl(info) {
    const t = eventTimes(info);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: info.name,
      dates: `${t.start}/${t.end}`,
      details: `${window.SITE.name}\n${dutyUrl(info)}`,
      location: info.location || ''
    });
    if (!t.allDay) params.set('ctz', 'Asia/Taipei');
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  function icsEscape(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  function icsText(info) {
    const t = eventTimes(info);
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    // 提醒：前一天晚上 8 點（整天活動從當天 0 點算回去 4 小時；有時間的算到前一天 20:00）
    let trigger = '-PT4H';
    if (!t.allDay) {
      const [hh, mm] = info.startTime.split(':').map(Number);
      trigger = `-PT${(24 - 20 + hh) * 60 + mm}M`; // 從開始時間往回推到前一天 20:00
    }
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shumeizi-calendar//ZH-TW', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${info.dutyId}-${info.date}@shumeizi-calendar`,
      `DTSTAMP:${now}`,
      t.allDay ? `DTSTART;VALUE=DATE:${t.start}` : `DTSTART:${t.start}`,
      t.allDay ? `DTEND;VALUE=DATE:${t.end}` : `DTEND:${t.end}`,
      `SUMMARY:${icsEscape(info.name)}`,
      info.location ? `LOCATION:${icsEscape(info.location)}` : '',
      `DESCRIPTION:${icsEscape(window.SITE.name + '\n' + dutyUrl(info))}`,
      `URL:${dutyUrl(info)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(info.name)}`, `TRIGGER:${trigger}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean);
    return lines.join('\r\n');
  }

  function open(info) {
    if (isIOS()) {
      const blob = new Blob([icsText(info)], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `勤務-${info.date}.ics`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } else {
      window.open(googleUrl(info), '_blank', 'noopener');
    }
  }

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest && ev.target.closest('[data-addcal]');
    if (!btn) return;
    const info = registry.get(btn.dataset.addcal);
    if (info) open(info);
  });

  /**
   * 🎂 生日加到行事曆（後台成員，2026/11/5）：每年重複的整天活動「🎂 名字 生日」，當天早上 9 點提醒。
   * 一位、非 iPhone：開 Google 日曆新增畫面（每年重複）；其他：下載 .ics（iPhone 直接「全部加入」）。
   * 檔案在手機上產生，名字不會送到別的地方。
   */
  function birthdayIcs(list) {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shumeizi-calendar//ZH-TW', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    list.forEach((m) => {
      const d = m.birthday.replace(/-/g, '');
      const title = `🎂 ${m.name} 生日`;
      lines.push('BEGIN:VEVENT',
        `UID:bday-${d}-${encodeURIComponent(m.name).replace(/%/g, '')}@shumeizi-calendar`,
        `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${Fmt.addDays(m.birthday, 1).replace(/-/g, '')}`,
        'RRULE:FREQ=YEARLY', `SUMMARY:${icsEscape(title)}`, 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function birthdays(list) {
    list = (list || []).filter((m) => m && m.name && /^\d{4}-\d{2}-\d{2}$/.test(m.birthday || ''));
    if (!list.length) return;
    if (list.length === 1 && !isIOS()) {
      const d = list[0].birthday.replace(/-/g, '');
      const params = new URLSearchParams({ action: 'TEMPLATE', text: `🎂 ${list[0].name} 生日`, dates: `${d}/${Fmt.addDays(list[0].birthday, 1).replace(/-/g, '')}`, recur: 'RRULE:FREQ=YEARLY' });
      window.open('https://calendar.google.com/calendar/render?' + params.toString(), '_blank', 'noopener');
      return;
    }
    const blob = new Blob([birthdayIcs(list)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = list.length === 1 ? '生日.ics' : '大家的生日.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.AddCal = { button, googleUrl, icsText, eventTimes, birthdays, birthdayIcs };
})();
