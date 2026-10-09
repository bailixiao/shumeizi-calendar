// 網站設定（前端）：團體名稱、場地、用詞、選項、要開哪些功能。複製給別的團體時，主要改這個檔案和 apps-script/Config.gs 最上面的 SITE。
// 兩邊的共同欄位要一致（tests/site-config.test.js 會檢查）。這裡只放公開的字，不放人名、電話。
(function () {
  window.SITE = {
    name: '書槑子青年坊行事曆',        // 網站名稱（標題列、主畫面圖示名稱、通知）
    shortName: '書槑子行事曆',         // 主畫面圖示下面的短名稱
    org: '書槑子青年坊',              // 團體名稱（名單開頭、缺人通知）
    homepage: 'https://shumeiziqingnianfang4.webnode.page/', // 官網（行事曆最下面的「逛逛官網」按鈕；空白＝不顯示）
    venue: '場地',                    // 可以借的場地名稱（書槑子目前不借場地，features.venue＝false）
    temple: '佛堂',                   // 「佛堂」這個用詞（書槑子不用，features.temple＝false 時整個藏起來）
    // 類別顯示的名字（內部代號不變：勤務＝志工排班，有項目＋名額、會算缺人；道務、教育、植素＝一般活動，自由參加不算缺人）
    categoryLabels: { 勤務: '志工', 道務: '靈魂健身房', 教育: '槑青韜課館', 植素: '植素園工作坊' },
    locations: ['竹北', '宏宗聖堂道學院', '安東彌勒山', '安東彌勒山（厚德樓）'], // 新增活動時的地點選項
    eduTeacherClasses: [],            // 教育統計「各班師資」看哪幾個班（書槑子不用）
    vegCandidateMin: 15,              // 清口統計門檻（書槑子不用）
    overseas: [],                     // 成員的「國外」選項（書槑子不用）
    identity: false,                  // 報名要不要選身分（道親／壇辦／未求道、陪同）；書槑子不用
    // 第一次報名的人要選怎麼認識的（空的＝不問；「朋友介紹」要填介紹人）；和 Config.gs 的 SITE.sources 一樣
    sources: ['朋友介紹', '官方 LINE', '官網', 'Instagram', 'Facebook', '其他', '不確定'],
    term: '活動',                     // 後台用詞：活動管理、近期活動、新增活動（空白＝依帳號叫勤務或活動）
    // 性質顯示的名字（內部代號不變；志工類的「活動」＝只記錄參加者、不算志工統計）
    natureLabels: { 勤務: '志工排班', 支援: '活動支援', 烹飪: '廚房', 活動: '活動（只記參加者）' },
    // 通知、分享用的標題
    shortageTitle: '🙋【書槑子 志工還缺人】',
    inviteTitle: '🌱【書槑子青年坊 邀請你來】',
    // 畫面上的範例字（placeholder）
    examples: { dutyName: '例：槑子的靈魂健身房', pushBody: '例：今晚 19:30 竹北，可以提早來吃飯喔 🍱' },
    // 功能開關：不需要的設成 false（只藏入口，程式和資料都還在；之後要用改回 true）
    //   venue 借場地、repair 修繕回報、help 常見問題、push 手機提醒、temple 佛堂（成員的佛堂、同名的舊紀錄）、
    //   vegetarian 清口與年齡統計、goals 各佛堂道務目標、ai 從照片新增（AI 整理草稿）、groups 分組（勤務了愿組、打掃組、拜香輪值組）、shop 團購
    features: { venue: false, repair: false, help: true, push: true, temple: false, vegetarian: false, goals: false, ai: false, groups: false, shop: true }
  };
})();
