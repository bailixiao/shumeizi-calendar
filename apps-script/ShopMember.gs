/**
 * 團購會員（規格 0.6.3，2026/11/4）：植素園happy購的買家用 LINE／Google 帳號登入。
 * 登入的驗證（Google ID token、LINE 換 token）和登入憑證的簽章在 Worker（worker/src/member-auth.js）；
 * Worker 驗證好憑證才在請求裡帶 _member（會員ID），這裡只認 Worker 帶來的（Google 版不認，見 SHOP_TRUST_MEMBER_）。
 * 會員的手機、地址、Email 只回傳給會員自己和登入後台的管理者。
 */

var SHOP_TRUST_MEMBER_ = false; // Worker 版（gs-overrides.js）改成 true
var SHOP_MEMBER_PROVIDERS = ['LINE', 'Google', '示範'];
var SHOP_MAX_ADDRESSES = 10;

/** 這個請求是哪位會員（Worker 驗證過登入憑證才有）；沒有＝'' */
function shopMemberId_(body) {
  return SHOP_TRUST_MEMBER_ && body && body._member ? String(body._member) : '';
}

function shopMemberRow_(id) {
  return id ? findById_(readTable_(SHEETS.SHOP_MEMBERS), '會員ID', id) : null;
}

/** 要登入的動作：沒登入或會員不見了＝請重新登入 */
function shopRequireMember_(body) {
  var m = shopMemberRow_(shopMemberId_(body));
  if (!m) throw new ApiError_('LOGIN', '請先登入');
  return m;
}

/** 地址簿：[{ id, label, name, phone, address, main }] */
function shopAddresses_(m) {
  return shopJson_(m['地址簿'], []).filter(function (a) { return a && a.address; }).map(function (a) {
    return { id: String(a.id || ''), label: String(a.label || ''), name: String(a.name || ''), phone: String(a.phone || ''), address: String(a.address || ''), main: !!a.main };
  });
}

/** 給會員自己看的（含手機、地址；別人拿不到） */
function shopMemberSelf_(m) {
  var name = m['姓名'] || '';
  var phone = String(m['手機'] || '');
  return {
    id: m['會員ID'], provider: m['登入方式'], displayName: m['顯示名稱'] || '', email: m['Email'] || '',
    name: name, phone: phone, addresses: shopAddresses_(m), needProfile: !name || !phone
  };
}

/**
 * 登入（Worker 驗證好 LINE／Google 之後呼叫）：p = { provider, sub, email, displayName }
 * 找得到就更新最後登入，找不到就新增一位會員。回傳 shopMemberSelf_。
 */
function shopMemberLogin_(p) {
  var provider = String(p.provider || '');
  var sub = String(p.sub || '');
  if (SHOP_MEMBER_PROVIDERS.indexOf(provider) === -1 || !sub) throw new ApiError_('BAD_REQUEST', '登入失敗，請再試一次');
  return withSignupLock_(function () {
    var now = nowString_();
    var m = readTable_(SHEETS.SHOP_MEMBERS).filter(function (r) { return r['登入方式'] === provider && String(r['帳號代號']) === sub; })[0];
    var ch = { '最後登入': now, '顯示名稱': cleanText_(p.displayName).slice(0, 40) };
    if (p.email) ch['Email'] = cleanText_(p.email).slice(0, 100);
    if (m) {
      updateRow_(SHEETS.SHOP_MEMBERS, m, ch);
    } else {
      m = Object.assign({ '會員ID': newId_('U'), '登入方式': provider, '帳號代號': sub, 'Email': '', '姓名': '', '手機': '', '地址簿': '', '建立時間': now }, ch);
      appendRows_(SHEETS.SHOP_MEMBERS, [m]);
      writeDutyLog_('團購會員', '新會員（' + provider + '）');
    }
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_MEMBERS);
    return shopMemberSelf_(m);
  });
}

/** body = {}：我的資料 */
function shopMe_(body) {
  return { member: shopMemberSelf_(shopRequireMember_(body)) };
}

/**
 * body = { name, phone, addresses: [{ id?, label, name, phone, address, main }] }：存我的資料。
 * 手機和以前在團購網頁下單的一樣：那些還沒有會員的訂單接過來變成這位會員的。
 */
function shopSaveProfile_(body) {
  var name = normalizeName_(body.name);
  var phone = shopPhone_(body.phone);
  var errors = [];
  if (name.length < 2) errors.push({ message: '請填你的名字' });
  else if (name.length > 20) errors.push({ message: '名字太長（最多 20 字）' });
  if (!/^09\d{8}$/.test(phone)) errors.push({ message: '手機請填 09 開頭的 10 個數字' });
  var list = Array.isArray(body.addresses) ? body.addresses : [];
  if (list.length > SHOP_MAX_ADDRESSES) errors.push({ message: '地址最多存 ' + SHOP_MAX_ADDRESSES + ' 個' });
  var addresses = [];
  list.slice(0, SHOP_MAX_ADDRESSES).forEach(function (a, i) {
    var addr = cleanText_(a && a.address).slice(0, 120);
    if (!addr) return;
    var ap = shopPhone_(a.phone);
    if (addr.length < 5) errors.push({ message: '第 ' + (i + 1) + ' 個地址太短' });
    if (ap && !/^09\d{8}$/.test(ap)) errors.push({ message: '第 ' + (i + 1) + ' 個地址的電話請填 09 開頭的 10 個數字' });
    addresses.push({ id: /^[A-Za-z0-9-]{1,40}$/.test(String(a.id || '')) ? String(a.id) : newId_('A'), label: cleanText_(a.label).slice(0, 10),
      name: normalizeName_(a.name).slice(0, 20), phone: ap, address: addr, main: !!a.main });
  });
  if (errors.length) throw new ApiError_('VALIDATION', '沒有存好，請看下面的說明', errors);
  // 預設地址只能一個；都沒勾＝第一個
  var mainAt = addresses.map(function (a) { return a.main; }).indexOf(true);
  addresses.forEach(function (a, i) { a.main = i === (mainAt === -1 ? 0 : mainAt); });
  return withSignupLock_(function () {
    var m = shopRequireMember_(body);
    updateRow_(SHEETS.SHOP_MEMBERS, m, { '姓名': name, '手機': phone, '地址簿': addresses.length ? JSON.stringify(addresses) : '' });
    // 以前在團購網頁下的單（同一支手機、還沒有會員）接過來
    var linked = 0;
    readTable_(SHEETS.SHOP_ORDERS).forEach(function (o) {
      if (o['來源'] === '團購網頁' && !o['會員ID'] && String(o['手機'] || '') === phone) { updateRow_(SHEETS.SHOP_ORDERS, o, { '會員ID': m['會員ID'] }); linked++; }
    });
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_MEMBERS);
    if (linked) invalidateTable_(SHEETS.SHOP_ORDERS);
    return { member: shopMemberSelf_(m), linked: linked };
  });
}

/** 後台「👥 會員」：每位會員的資料、地址簿、訂單統計（手機、地址、Email 只在後台） */
function adminShopMembers_(body) {
  var orders = readTable_(SHEETS.SHOP_ORDERS);
  var groups = readTable_(SHEETS.SHOP_GROUPS);
  var members = readTable_(SHEETS.SHOP_MEMBERS).map(function (m) {
    var mine = orders.filter(function (o) { return o['會員ID'] === m['會員ID'] && o['狀態'] !== '已取消'; });
    var last = mine.map(function (o) { return String(o['建立時間'] || ''); }).sort().pop() || '';
    return Object.assign(shopMemberSelf_(m), {
      createdAt: m['建立時間'] || '', lastLogin: m['最後登入'] || '',
      orderCount: mine.length, total: mine.reduce(function (n, o) { return n + (Number(o['金額']) || 0); }, 0), lastOrder: last,
      orders: mine.map(function (o) { return shopOrderOut_(o, findById_(groups, '團購ID', o['團購ID']), false, true); })
        .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
    });
  }).sort(function (a, b) { return (a.lastOrder || a.lastLogin) < (b.lastOrder || b.lastLogin) ? 1 : -1; });
  return { members: members };
}
