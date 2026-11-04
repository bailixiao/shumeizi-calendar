// 網站設定（前端）：團體名稱、場地、用詞、選項、要開哪些功能。複製給別的團體時，主要改這個檔案和 apps-script/Config.gs 最上面的 SITE。
// 兩邊的共同欄位要一致（tests/site-config.test.js 會檢查）。這裡只放公開的字，不放人名、電話。
(function () {
  window.SITE = {
    name: '書槑子青年坊行事曆',        // 網站名稱（標題列、主畫面圖示名稱、通知）
    shortName: '書槑子青年坊',         // 主畫面圖示下面的名稱（2026/10/14 官網＋行事曆合成一個 App，改叫書槑子青年坊）
    org: '書槑子青年坊',              // 團體名稱（名單開頭、缺人通知）
    shopWeb: { name: '植素園happy購', url: 'https://zhisu-shop.pages.dev/' }, // 給外面客人的團購網頁（規格 0.6.1；開團勾「也放到團購網頁」才會列）
    shopLine: { name: '植素園客服 LINE@', url: 'https://page.line.me/157orxzf' }, // 下單完成、我的訂單最下面的客服按鈕（規格 0.6.2）
    // 植素園happy購的會員登入（規格 0.6.3）：Google 的用戶端 ID、LINE Login 的 Channel ID（都是公開的）；兩個都空白＝不用登入（照舊填名字＋手機）
    shopLogin: { googleClientId: '290583637218-dtut8et01o10684umfs58bhh30t3r4l6.apps.googleusercontent.com', liffId: '2012376434-yIwTdARP' }, // liffId：LINE Developers 的 LIFF ID（例 1234567890-AbcdEfgh），公開的不是密碼
    linePay: 'https://qrcodepay.line.me/qr/payment/apQ%252BSG3a9fTlKyxysEJ4S79zpMB4g47QbqhsEhOK2CUQu7bfY8i2DRvV6K5wGRQC', // 團購付款可以選 LINE Pay（2026/11/4；空白＝不給選）
    // 團購網頁右邊的浮動按鈕（2026/11/4；購物車那頁不放，免得按了沒送出訂單）
    shopSocial: [
      { kind: 'ig', name: 'Instagram', url: 'https://www.instagram.com/zhishuyuan_happy' },
      { kind: 'line', name: 'LINE 社群', url: 'https://line.me/ti/g2/54nufHfVxf8vBencGmHK4fvJH408_CUpuOEWIA' }
    ],
    homepage: './home/', // 頁首「🏠 回到主頁」：App 裡的官網（官網專案 build 產生到 home/，規格 0.10；空白＝不顯示）
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
