// 網站設定（前端）：團體名稱、場地、用詞、選項、要開哪些功能。複製給別的團體時，主要改這個檔案和 apps-script/Config.gs 最上面的 SITE。
// 兩邊的共同欄位要一致（tests/site-config.test.js 會檢查）。這裡只放公開的字，不放人名、電話。
(function () {
  window.SITE = {
    name: '書槑子青年坊行事曆',        // 網站名稱（標題列、主畫面圖示名稱、通知）
    shortName: '書槑子行事曆',         // 主畫面圖示下面的短名稱
    org: '書槑子青年坊',              // 團體名稱（名單開頭、缺人通知）
    venue: '場地',                    // 可以借的場地名稱（書槑子目前不借場地，features.venue＝false）
    temple: '佛堂',                   // 「佛堂」這個用詞（書槑子不用，features.temple＝false 時整個藏起來）
    // 類別顯示的名字（內部代號不變：勤務＝志工排班，有項目＋名額、會算缺人；道務、教育＝一般活動）
    categoryLabels: { 勤務: '志工', 道務: '靈魂健身房', 教育: '槑青韜課館' },
    locations: ['竹北', '宏宗聖堂道學院', '安東彌勒山', '安東彌勒山（厚德樓）'], // 新增活動時的地點選項
    eduTeacherClasses: [],            // 教育統計「各班師資」看哪幾個班（書槑子不用）
    vegCandidateMin: 15,              // 清口統計門檻（書槑子不用）
    overseas: [],                     // 成員的「國外」選項（書槑子不用）
    // 通知、分享用的標題
    shortageTitle: '🙋【書槑子 志工還缺人】',
    inviteTitle: '🌱【書槑子青年坊 邀請你來】',
    // 畫面上的範例字（placeholder）
    examples: { dutyName: '例：槑子的靈魂健身房', pushBody: '例：今晚 19:30 竹北，可以提早來吃飯喔 🍱' },
    // 功能開關：不需要的設成 false（目前只用來顯示／隱藏入口）
    features: { venue: false, repair: false, help: true, push: true }
  };
})();
