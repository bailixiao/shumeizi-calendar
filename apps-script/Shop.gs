/**
 * 團購（書槑子，規格 0.6）：商品庫、開團、下單、我的團購、後台的備貨清單與取貨名單。
 *   - 大家：getShop（開放中的團購）、shopOrder（下單／改單）、shopMyOrders、shopCancel、shopSetLast5。
 *   - 後台：adminShop、adminShopGroup（讀）；adminShopSaveProduct、adminShopSaveGroup、adminShopDeleteGroup、
 *     adminShopOrder（幫人下單、改單，不受截止限制）、adminShopOrderSet（已取貨、已付款、備註、取消）。
 *   - 同一個人（名字完全相同，別名換成主要名字）同一次團購只有一張有效訂單，再下單＝修改那一張。
 *   - 限量＝所有有效訂單加總；取消的份數會還回去。
 *   - 轉帳帳號等付款說明存在「團購」分頁，只在下單後與查我的訂單顯示，不寫進程式碼。
 */

var SHOP_PAY = ['現場', '轉帳'];
var SHOP_MAX_QTY = 99;
var SHOP_GROUP_STATUS = ['開放', '結束'];

function shopNowMinute_() {
  return nowString_().slice(0, 16);
}

function shopJson_(text, fallback) {
  try { var v = JSON.parse(text || ''); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

function shopInt_(v) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

var SHOP_MAX_PHOTOS = 6; // 一個商品最多幾張照片（照片＋更多照片）
var SHOP_MAX_OPTIONS = 12; // 一組規格最多幾個選項

/** 商品的規格：{ label, options: [{ name, price（null＝商品價格） }] }，沒有就 null */
function shopOptions_(p) {
  var v = shopJson_(p['規格'], null);
  if (!v || !Array.isArray(v.options) || !v.options.length) return null;
  return {
    label: String(v.label || '規格'),
    options: v.options.map(function (o) { return { name: String(o.name), price: o.price === '' || o.price === null || o.price === undefined ? null : Number(o.price) }; })
  };
}

/** 商品的所有照片（第一張＝照片） */
function shopPhotos_(p) {
  return [p['照片']].concat(shopJson_(p['更多照片'], [])).filter(Boolean).slice(0, SHOP_MAX_PHOTOS);
}

function shopProductOut_(p) {
  return {
    id: p['商品ID'], name: p['名稱'], price: Number(p['價格']) || 0, unit: p['單位'] || '', description: p['說明'] || '',
    photo: p['照片'] || '', active: p['啟用'] !== '否', order: Number(p['排序']) || 0,
    cost: p['成本'] === '' || p['成本'] === undefined || p['成本'] === null ? null : Number(p['成本']), // 成本（只給後台）
    photos: shopPhotos_(p), options: shopOptions_(p), code: p['編號'] || ''
  };
}

/** 團購的取貨場次（活動）：[{ id, name, date, startTime, endTime, location, category }]，依日期排 */
function shopPickups_(g) {
  var duties = readTableCached_(SHEETS.DUTIES);
  return String(g['取貨場次'] || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean)
    .map(function (id) { return findById_(duties, '勤務ID', id); }).filter(Boolean)
    .map(function (d) {
      return { id: d['勤務ID'], name: d['名稱'], date: d['開始日'], startTime: d['開始時間'] || '', endTime: d['結束時間'] || '', location: d['地點'] || '', category: dutyCategory_(d) };
    })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

/** 各商品已訂幾份（有效訂單；exceptId＝不算這張，改單時用） */
function shopSold_(orders, groupId, exceptId) {
  var sold = {};
  orders.forEach(function (o) {
    if (o['團購ID'] !== groupId || o['狀態'] === '已取消' || o['訂單ID'] === exceptId) return;
    shopJson_(o['品項'], []).forEach(function (it) { sold[it.id] = (sold[it.id] || 0) + (Number(it.qty) || 0); });
  });
  return sold;
}

/**
 * 團購給畫面用的樣子。opts.admin：附付款說明。
 * items：[{ id, name, price, unit, description, photo, limit, perPerson, sold, left }]（left＝null 表示不限）
 */
function shopGroupView_(g, products, orders, opts) {
  var sold = shopSold_(orders, g['團購ID']);
  var now = shopNowMinute_();
  var items = shopJson_(g['商品設定'], []).map(function (it) {
    var p = findById_(products, '商品ID', it.id);
    if (!p) return null;
    var limit = it.limit === '' || it.limit === null || it.limit === undefined ? null : Number(it.limit);
    var s = sold[it.id] || 0;
    return {
      id: it.id, name: p['名稱'], price: it.price === '' || it.price === undefined || it.price === null ? Number(p['價格']) || 0 : Number(it.price),
      unit: p['單位'] || '', description: p['說明'] || '', photo: p['照片'] || '', photos: shopPhotos_(p), options: shopOptions_(p),
      limit: limit, perPerson: it.perPerson === '' || it.perPerson === null || it.perPerson === undefined ? null : Number(it.perPerson),
      sold: s, left: limit === null ? null : Math.max(limit - s, 0)
    };
  }).filter(Boolean);
  var out = {
    id: g['團購ID'], name: g['名稱'], description: g['說明'] || '', deadline: g['截止時間'], status: g['狀態'] || '開放',
    closed: g['狀態'] === '結束' || (g['截止時間'] && now > g['截止時間']),
    pickups: shopPickups_(g), items: items, hasPayInfo: !!g['付款說明'],
    link: g['賣場連結'] || '', cover: g['封面'] || '' // 賣場連結：賣貨便（有填＝到賣貨便下單）；封面：封面照片
  };
  if (opts && opts.admin) {
    out.payInfo = g['付款說明'] || '';
    // 成本（只給後台）：照商品庫現在的成本
    out.items.forEach(function (it) { var p = findById_(products, '商品ID', it.id); it.cost = p && p['成本'] !== '' && p['成本'] !== undefined ? Number(p['成本']) : null; });
  }
  return out;
}

/** 大家的團購頁：開放中、取貨還沒全部過去的團購（截止了也列出來，標「已截止」） */
function getShop_() {
  var today = todayString_();
  var products = readTableCached_(SHEETS.SHOP_PRODUCTS);
  var orders = readTableCached_(SHEETS.SHOP_ORDERS);
  var groups = readTableCached_(SHEETS.SHOP_GROUPS)
    .filter(function (g) { return g['團購ID'] && g['狀態'] !== '結束'; })
    .map(function (g) { return shopGroupView_(g, products, orders); })
    // 賣貨便：截止了就不列；行事曆下單：取貨還沒全部過去
    .filter(function (v) { return v.link ? !v.closed : !v.pickups.length || v.pickups[v.pickups.length - 1].date >= today; })
    .sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
  return { now: shopNowMinute_(), groups: groups };
}

/**
 * 檢查一張訂單（純函式，方便測試）。
 * ctx = { group: shopGroupView_ 的結果, sold: 其他有效訂單已訂的份數 { 商品ID: 份數 }, now: 'yyyy-MM-dd HH:mm', admin: boolean }
 * input = { pickupId, items: [{ id, option?, qty }], pay, last5 }（有規格的商品要選 option；同商品不同規格可以分開，限量、每人上限照商品加總）
 * 回傳 [{ message }]（空陣列＝可以）
 */
function shopValidate_(ctx, input) {
  var g = ctx.group;
  var errors = [];
  if (!g) return [{ message: '找不到這次團購' }];
  if (g.status === '結束') return [{ message: '這次團購已經結束了' }];
  if (g.link) return [{ message: '這次團購請到賣貨便下單' }];
  if (!ctx.admin && g.deadline && ctx.now > g.deadline) return [{ message: '已經過了截止時間（' + g.deadline + '），要改請找小編' }];
  if (g.pickups.length && !g.pickups.some(function (p) { return p.id === input.pickupId; })) errors.push({ message: '請選取貨場次' });
  var items = Array.isArray(input.items) ? input.items : [];
  var total = 0;
  var seen = {};
  var perItem = {}; // 商品ID → 這張訂單的份數（各規格加總）
  items.forEach(function (it) {
    var qty = shopInt_(it && it.qty);
    var gi = g.items.filter(function (x) { return x.id === (it && it.id); })[0];
    if (!gi) { errors.push({ message: '有一樣商品這次沒有賣，請重新整理' }); return; }
    if (qty === null || qty > SHOP_MAX_QTY) { errors.push({ message: '「' + gi.name + '」的數量不對' }); return; }
    var option = String((it && it.option) || '');
    if (gi.options) {
      if (!gi.options.options.some(function (o) { return o.name === option; })) { if (qty) errors.push({ message: '「' + gi.name + '」請選' + gi.options.label }); return; }
    } else option = '';
    var key = gi.id + '|' + option;
    if (seen[key]) { errors.push({ message: '「' + gi.name + (option ? '（' + option + '）' : '') + '」重複了' }); return; }
    seen[key] = true;
    if (!qty) return;
    total += qty;
    perItem[gi.id] = (perItem[gi.id] || 0) + qty;
  });
  g.items.forEach(function (gi) {
    var qty = perItem[gi.id];
    if (!qty) return;
    if (gi.perPerson !== null && qty > gi.perPerson) errors.push({ message: '「' + gi.name + '」每人最多 ' + gi.perPerson + ' ' + (gi.unit || '份') });
    if (gi.limit !== null) {
      var left = Math.max(gi.limit - ((ctx.sold && ctx.sold[gi.id]) || 0), 0);
      if (qty > left) errors.push({ message: left ? '「' + gi.name + '」只剩 ' + left + ' ' + (gi.unit || '份') : '「' + gi.name + '」已經賣完了' });
    }
  });
  if (!total) errors.push({ message: '請至少選一樣商品' });
  if (SHOP_PAY.indexOf(input.pay) === -1) errors.push({ message: '請選付款方式（取貨付現或轉帳）' });
  if (input.last5 && !/^\d{5}$/.test(String(input.last5))) errors.push({ message: '轉帳末五碼要是 5 個數字' });
  return errors;
}

function shopOrderOut_(o, group, withPay) {
  var out = {
    id: o['訂單ID'], groupId: o['團購ID'], name: o['姓名'], pickupId: o['取貨活動ID'], pickupDate: o['取貨日期'],
    items: shopJson_(o['品項'], []), total: Number(o['金額']) || 0, pay: o['付款方式'], last5: o['末五碼'] || '',
    paid: o['已付款'] === '是', picked: o['已取貨'] === '是', status: o['狀態'] || '有效', note: o['備註'] || '',
    createdAt: o['建立時間'], updatedAt: o['更新時間']
  };
  if (group) {
    out.groupName = group['名稱'];
    out.deadline = group['截止時間'];
    out.closed = group['狀態'] === '結束' || (group['截止時間'] && shopNowMinute_() > group['截止時間']);
    var pk = shopPickups_(group).filter(function (p) { return p.id === o['取貨活動ID']; })[0];
    if (pk) out.pickup = pk;
    if (withPay && o['付款方式'] === '轉帳') out.payInfo = group['付款說明'] || '';
  }
  return out;
}

/** 名字＋別名對應成主要名字（同報名） */
function shopName_(name, temple) {
  var e = withMemberIdentity_([{ name: name, temple: temple || '' }])[0];
  return { name: normalizeName_(e.name), temple: e.temple || '' };
}

/**
 * body = { groupId, name, temple?, pickupId, items: [{ id, option?, qty }], pay, last5?, source?, referrer?, sourceNote?, mode? }
 * mode＝'add'（購物車結帳）：這個人在這次團購已經有訂單，就把這次的東西加進去（同商品同規格數量相加）；沒有就新增。
 * 沒有 mode＝整張換成這次的內容（改單）。
 * 管理者（opts.admin）另外可帶 orderId（改指定那張）、note；不受截止時間限制。
 */
function shopOrder_(body, opts) {
  var admin = !!(opts && opts.admin);
  var who = shopName_(body.name, body.temple);
  if (!who.name) throw new ApiError_('VALIDATION', '訂單沒有送出，請看下面的說明', [{ message: '請填名字' }]);
  if (NAME_SEPARATORS_.test(who.name)) throw new ApiError_('VALIDATION', '訂單沒有送出，請看下面的說明', [{ message: '一張訂單填一個名字就好' }]);
  var linked = findById_(readTableCached_(SHEETS.SHOP_GROUPS), '團購ID', body.groupId);
  if (linked && linked['賣場連結']) throw new ApiError_('VALIDATION', '訂單沒有送出，請看下面的說明', [{ message: '這次團購請到賣貨便下單' }]);
  var sources = newcomerSources_([{ name: who.name, source: body.source, referrer: body.referrer, sourceNote: body.sourceNote }]);
  return withSignupLock_(function () {
    var groups = readTable_(SHEETS.SHOP_GROUPS);
    var g = findById_(groups, '團購ID', body.groupId);
    if (!g) throw new ApiError_('NOT_FOUND', '找不到這次團購，可能已經刪除了');
    var products = readTable_(SHEETS.SHOP_PRODUCTS);
    var orders = readTable_(SHEETS.SHOP_ORDERS);
    var existing = admin && body.orderId
      ? findById_(orders, '訂單ID', body.orderId)
      : orders.filter(function (o) { return o['團購ID'] === g['團購ID'] && o['狀態'] !== '已取消' && normalizeName_(o['姓名']) === who.name; })[0] || null;
    if (existing && existing['狀態'] === '已取消') existing = null;
    if (existing && existing['已取貨'] === '是' && !admin) throw new ApiError_('FORBIDDEN', '這張訂單已經取貨了，要改請找小編');
    var view = shopGroupView_(g, products, orders);
    var items = Array.isArray(body.items) ? body.items : [];
    if (body.mode === 'add' && existing) {
      // 加進原本那張：原本的品項＋這次的（同商品同規格相加）
      var merged = {};
      var order = [];
      shopJson_(existing['品項'], []).concat(items).forEach(function (it) {
        var key = it.id + '|' + (it.option || '');
        if (!merged[key]) { merged[key] = { id: it.id, option: it.option || '', qty: 0 }; order.push(key); }
        merged[key].qty += Number(shopInt_(it.qty)) || 0;
      });
      items = order.map(function (k) { return merged[k]; });
    }
    var input = { pickupId: body.pickupId || (existing && body.mode === 'add' && !body.pickupId ? existing['取貨活動ID'] : ''), items: items, pay: body.pay, last5: body.last5 ? String(body.last5).trim() : '' };
    var errors = shopValidate_({ group: view, sold: shopSold_(orders, g['團購ID'], existing ? existing['訂單ID'] : ''), now: shopNowMinute_(), admin: admin }, input);
    if (errors.length) throw new ApiError_('VALIDATION', '訂單沒有送出，請看下面的說明', errors);

    var lines = [];
    var total = 0;
    input.items.forEach(function (it) {
      var qty = shopInt_(it.qty);
      if (!qty) return;
      var gi = view.items.filter(function (x) { return x.id === it.id; })[0];
      var opt = gi.options ? gi.options.options.filter(function (o) { return o.name === String(it.option || ''); })[0] : null;
      var price = opt && opt.price !== null ? opt.price : gi.price;
      // name＝顯示用（商品（規格））；base、option 分開記，後台備貨分規格算
      lines.push({ id: gi.id, name: gi.name + (opt ? '（' + opt.name + '）' : ''), base: gi.name, option: opt ? opt.name : '', qty: qty, price: price, unit: gi.unit, photo: gi.photo });
      total += qty * price;
    });
    var pickup = view.pickups.filter(function (p) { return p.id === input.pickupId; })[0];
    var now = nowString_();
    var values = {
      // 沒有設取貨場次的團購（2026/10/10）：取貨活動、日期空白
      '姓名': who.name, '取貨活動ID': pickup ? pickup.id : '', '取貨日期': pickup ? pickup.date : '', '品項': JSON.stringify(lines), '金額': String(total),
      '付款方式': input.pay, '末五碼': input.pay === '轉帳' ? (input.last5 || (existing ? existing['末五碼'] : '') || '') : '', '更新時間': now
    };
    if (admin && body.note !== undefined) values['備註'] = cleanText_(body.note).slice(0, 100);
    var summary = who.name + '｜' + g['名稱'] + '｜' + lines.map(function (l) { return l.name + '×' + l.qty; }).join('、') + '｜' + total + ' 元｜' + (pickup ? pickup.date + ' ' + pickup.name + '｜' : '') + input.pay;
    var row;
    if (existing) {
      var before = rowSnapshot_(SHEETS.SHOP_ORDERS, existing);
      updateRow_(SHEETS.SHOP_ORDERS, existing, values);
      row = existing;
      writeDutyLog_('團購改單', summary + (admin ? adminTag_() : ''), before);
    } else {
      row = Object.assign({ '訂單ID': newId_('O'), '團購ID': g['團購ID'], '已付款': '', '已取貨': '', '狀態': '有效', '備註': '', '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_ORDERS, [row]);
      writeDutyLog_('團購下單', summary + (admin ? adminTag_() : ''));
    }
    addPendingMembers_([{ '姓名': who.name, '佛堂': who.temple, '日期': pickup ? pickup.date : todayString_(), '身分': '' }], '團購：' + g['名稱'], sources);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_ORDERS);
    return { order: shopOrderOut_(row, g, true), updated: !!existing, merged: !!existing && body.mode === 'add' };
  });
}

/**
 * body = { name, all? }：這個人還沒取貨的訂單（今天以後取貨的），附團購名稱、截止、取貨場次、付款說明。
 * all＝true（我的訂單頁）：最近 90 天下的單都列（含已取貨），不含已取消。
 */
function shopMyOrders_(body) {
  var who = shopName_(body.name);
  if (who.name.length < 2) throw new ApiError_('BAD_REQUEST', '請輸入完整的名字');
  var today = todayString_();
  var groups = readTableCached_(SHEETS.SHOP_GROUPS);
  var since = addDaysStr_(today, -90);
  var orders = readTable_(SHEETS.SHOP_ORDERS).filter(function (o) {
    if (normalizeName_(o['姓名']) !== who.name || o['狀態'] === '已取消') return false;
    if (body.all) return String(o['建立時間'] || '').slice(0, 10) >= since;
    if (o['已取貨'] === '是') return false;
    if (o['取貨日期']) return o['取貨日期'] >= today;
    var g = findById_(groups, '團購ID', o['團購ID']); // 沒有取貨場次：團購還沒結束就列出來
    return !!g && g['狀態'] !== '結束';
  });
  return {
    name: who.name,
    orders: orders.map(function (o) { return shopOrderOut_(o, findById_(groups, '團購ID', o['團購ID']), true); })
      .sort(body.all ? function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; } : function (a, b) { return a.pickupDate < b.pickupDate ? -1 : 1; })
  };
}

/** 大家自己動自己的訂單：要帶名字（和訂單上的一樣），截止前才能取消 */
function shopOwnOrder_(orders, body) {
  var o = findById_(orders, '訂單ID', body.orderId);
  if (!o || o['狀態'] === '已取消') throw new ApiError_('NOT_FOUND', '找不到這張訂單，可能已經取消了，請重新整理');
  if (normalizeName_(o['姓名']) !== shopName_(body.name).name) throw new ApiError_('FORBIDDEN', '名字和訂單上的不一樣');
  if (o['已取貨'] === '是') throw new ApiError_('FORBIDDEN', '這張訂單已經取貨了');
  return o;
}

/** body = { orderId, name } */
function shopCancel_(body) {
  return withSignupLock_(function () {
    var o = shopOwnOrder_(readTable_(SHEETS.SHOP_ORDERS), body);
    var g = findById_(readTable_(SHEETS.SHOP_GROUPS), '團購ID', o['團購ID']);
    if (g && g['截止時間'] && shopNowMinute_() > g['截止時間']) throw new ApiError_('FORBIDDEN', '已經過了截止時間，要取消請找小編');
    var before = rowSnapshot_(SHEETS.SHOP_ORDERS, o);
    updateRow_(SHEETS.SHOP_ORDERS, o, { '狀態': '已取消', '更新時間': nowString_() });
    writeDutyLog_('團購取消', o['姓名'] + '｜' + (g ? g['名稱'] : o['團購ID']) + '｜' + o['金額'] + ' 元' + (o['付款方式'] === '轉帳' && o['末五碼'] ? '｜已轉帳（末五碼 ' + o['末五碼'] + '），要退款' : ''), before);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_ORDERS);
    return { cancelled: true, paidByTransfer: o['付款方式'] === '轉帳' && !!o['末五碼'] };
  });
}

/** body = { orderId, name, last5 }：轉帳後補末五碼（截止後也可以，取貨前都行） */
function shopSetLast5_(body) {
  var last5 = String(body.last5 || '').trim();
  if (!/^\d{5}$/.test(last5)) throw new ApiError_('VALIDATION', '轉帳末五碼要是 5 個數字');
  return withSignupLock_(function () {
    var o = shopOwnOrder_(readTable_(SHEETS.SHOP_ORDERS), body);
    updateRow_(SHEETS.SHOP_ORDERS, o, { '付款方式': '轉帳', '末五碼': last5, '更新時間': nowString_() });
    writeDutyLog_('團購補末五碼', o['姓名'] + '｜末五碼 ' + last5);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_ORDERS);
    return { last5: last5 };
  });
}

// ---------- 後台 ----------

/** 商品庫、所有團購（新的在前，附訂單數與金額）、可以當取貨場次的活動（今天起 180 天） */
function adminShop_() {
  var products = readTable_(SHEETS.SHOP_PRODUCTS).map(shopProductOut_).sort(function (a, b) { return a.order - b.order || (a.name < b.name ? -1 : 1); });
  var orders = readTable_(SHEETS.SHOP_ORDERS);
  var groups = readTable_(SHEETS.SHOP_GROUPS).map(function (g) {
    var mine = orders.filter(function (o) { return o['團購ID'] === g['團購ID'] && o['狀態'] !== '已取消'; });
    return {
      id: g['團購ID'], name: g['名稱'], deadline: g['截止時間'], status: g['狀態'] || '開放', createdAt: g['建立時間'],
      closed: g['狀態'] === '結束' || (g['截止時間'] && shopNowMinute_() > g['截止時間']),
      orders: mine.length, total: mine.reduce(function (n, o) { return n + (Number(o['金額']) || 0); }, 0), pickups: shopPickups_(g),
      link: g['賣場連結'] || '', cover: g['封面'] || ''
    };
  }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
  var today = todayString_();
  var until = addDaysStr_(today, 180);
  var duties = readTableCached_(SHEETS.DUTIES)
    .filter(function (d) { return d['勤務ID'] && d['開始日'] >= today && d['開始日'] <= until; })
    .map(function (d) { return { id: d['勤務ID'], name: d['名稱'], date: d['開始日'], startTime: d['開始時間'] || '', location: d['地點'] || '', category: dutyCategory_(d), nature: d['性質'] }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { products: products, groups: groups, duties: duties };
}

/** body = { id }：一次團購的全部（含付款說明、所有訂單、備貨清單、總覽） */
function adminShopGroup_(body) {
  var g = findById_(readTable_(SHEETS.SHOP_GROUPS), '團購ID', body.id);
  if (!g) throw new ApiError_('NOT_FOUND', '找不到這次團購');
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  var orders = readTable_(SHEETS.SHOP_ORDERS).filter(function (o) { return o['團購ID'] === g['團購ID']; });
  var view = shopGroupView_(g, products, orders, { admin: true });
  view.pickupIds = String(g['取貨場次'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  view.itemSettings = shopJson_(g['商品設定'], []);
  var active = orders.filter(function (o) { return o['狀態'] !== '已取消'; });
  // 備貨清單：每個取貨場次，每項商品幾份
  // 沒有取貨場次的團購：全部訂單算一份（pickup＝null）
  var prep = (view.pickups.length ? view.pickups : [null]).map(function (p) {
    var list = active.filter(function (o) { return !p || o['取貨活動ID'] === p.id; });
    // 分規格算：key＝商品ID|規格
    var count = {};
    list.forEach(function (o) { shopJson_(o['品項'], []).forEach(function (it) { var k = it.id + '|' + (it.option || ''); count[k] = (count[k] || 0) + (Number(it.qty) || 0); }); });
    var rows = [];
    view.items.forEach(function (it) {
      Object.keys(count).filter(function (k) { return k.split('|')[0] === it.id; }).sort().forEach(function (k) {
        var opt = k.slice(it.id.length + 1);
        rows.push({ id: it.id, option: opt, name: it.name + (opt ? '（' + opt + '）' : ''), unit: it.unit, qty: count[k] });
      });
    });
    return {
      pickup: p, orders: list.length, total: list.reduce(function (n, o) { return n + (Number(o['金額']) || 0); }, 0),
      items: rows
    };
  });
  var sum = function (list) { return list.reduce(function (n, o) { return n + (Number(o['金額']) || 0); }, 0); };
  // 成本：有效訂單的每樣商品份數 × 商品庫的成本
  var costSum = { cost: 0, missing: [] };
  active.forEach(function (o) {
    shopJson_(o['品項'], []).forEach(function (l) {
      var it = view.items.filter(function (x) { return x.id === l.id; })[0];
      if (it && it.cost !== null) costSum.cost += it.cost * (Number(l.qty) || 0);
      else if (costSum.missing.indexOf(l.name) === -1) costSum.missing.push(l.name);
    });
  });
  return {
    group: view,
    orders: orders.map(function (o) { return shopOrderOut_(o, g, false); }),
    prep: prep,
    summary: {
      orders: active.length, total: sum(active),
      paid: sum(active.filter(function (o) { return o['已付款'] === '是'; })),
      unpaid: sum(active.filter(function (o) { return o['已付款'] !== '是'; })),
      picked: active.filter(function (o) { return o['已取貨'] === '是'; }).length,
      cost: costSum.cost, profit: sum(active) - costSum.cost, costMissing: costSum.missing // 成本、毛利（沒填成本的商品不算，列在 costMissing）
    }
  };
}

/** body = { product: { id?, name, price, unit, description, photo, active, order } } */
function adminShopSaveProduct_(body) {
  var p = body.product || {};
  var name = cleanText_(p.name);
  var price = shopInt_(p.price);
  var errors = [];
  if (!name) errors.push('請填商品名稱');
  if (name.length > 40) errors.push('商品名稱太長（最多 40 字）');
  if (price === null) errors.push('價格請填 0 以上的整數（元）');
  var code = cleanText_(p.code);
  if (code.length > 20) errors.push('編號太長（最多 20 字）');
  var cost = p.cost === '' || p.cost === undefined || p.cost === null ? '' : shopInt_(p.cost);
  if (cost === null) errors.push('成本請填 0 以上的整數（元），或空白');
  if (cleanText_(p.unit).length > 6) errors.push('單位太長（例：包、罐、份）');
  if (cleanText_(p.description).length > 300) errors.push('說明太長（最多 300 字）');
  if (p.photo && !/^F-[\w-]+$/.test(String(p.photo))) errors.push('照片代號不對，請重新上傳');
  var more = (Array.isArray(p.photos) ? p.photos : []).map(String).filter(Boolean);
  if (more.some(function (x) { return !/^F-[\w-]+$/.test(x); })) errors.push('照片代號不對，請重新上傳');
  if (more.length > SHOP_MAX_PHOTOS - 1) errors.push('照片最多 ' + SHOP_MAX_PHOTOS + ' 張');
  // 規格：{ label, options: [{ name, price }] }；選項名稱不能重複，價格空白＝商品價格
  var opts = '';
  if (p.options && Array.isArray(p.options.options) && p.options.options.some(function (o) { return o && cleanText_(o.name); })) {
    var label = cleanText_(p.options.label) || '規格';
    var names = {};
    var list = [];
    p.options.options.forEach(function (o) {
      var n = cleanText_(o && o.name);
      if (!n) return;
      if (n.length > 20) errors.push('規格「' + n + '」太長（最多 20 字）');
      if (names[n]) errors.push('規格「' + n + '」重複了');
      names[n] = true;
      var pr = o.price === '' || o.price === undefined || o.price === null ? '' : shopInt_(o.price);
      if (pr === null) errors.push('規格「' + n + '」的價格請填整數，或空白（照商品價格）');
      list.push({ name: n, price: pr === null ? '' : pr });
    });
    if (label.length > 10) errors.push('規格名稱太長（例：口味、大小）');
    if (list.length > SHOP_MAX_OPTIONS) errors.push('規格最多 ' + SHOP_MAX_OPTIONS + ' 個選項');
    opts = JSON.stringify({ label: label, options: list });
  }
  if (errors.length) throw new ApiError_('VALIDATION', '商品沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.SHOP_PRODUCTS);
    var now = nowString_();
    // 編號：空白就自動給下一個；不能和別的商品重複
    if (!code) code = p.id ? (findById_(rows, '商品ID', p.id) || {})['編號'] || nextProductCode_(rows) : nextProductCode_(rows);
    if (rows.some(function (r) { return r['商品ID'] !== p.id && String(r['編號'] || '') === code; })) throw new ApiError_('VALIDATION', '商品沒有存檔', [{ message: '編號「' + code + '」已經有別的商品用了' }]);
    var values = { '名稱': name, '價格': String(price), '單位': cleanText_(p.unit), '說明': cleanText_(p.description), '照片': p.photo || '',
      '啟用': p.active === false ? '否' : '是', '排序': String(shopInt_(p.order) || 0), '成本': cost === '' ? '' : String(cost),
      '更多照片': more.length ? JSON.stringify(more) : '', '規格': opts, '編號': code, '更新時間': now };
    var row;
    if (p.id) {
      row = findById_(rows, '商品ID', p.id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這個商品');
      updateRow_(SHEETS.SHOP_PRODUCTS, row, values);
    } else {
      row = Object.assign({ '商品ID': newId_('G'), '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_PRODUCTS, [row]);
    }
    writeDutyLog_('團購商品', (p.id ? '修改' : '新增') + '｜' + name + '｜' + price + ' 元' + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_PRODUCTS);
    return { product: shopProductOut_(row) };
  });
}

/** body = { group: { id?, name, description, deadline, pickups: [活動ID], items: [{ id, price, limit, perPerson }], payInfo, status } } */
function adminShopSaveGroup_(body) {
  var g = body.group || {};
  var name = cleanText_(g.name);
  var deadline = String(g.deadline || '').trim().replace('T', ' ');
  var errors = [];
  if (!name) errors.push('請填團購名稱');
  if (name.length > 40) errors.push('團購名稱太長（最多 40 字）');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(deadline) || !isDateString_(deadline.slice(0, 10))) errors.push('請填截止時間（日期和幾點）');
  if (cleanText_(g.description).length > 500) errors.push('說明太長（最多 500 字）');
  if (String(g.payInfo || '').length > 300) errors.push('付款說明太長（最多 300 字）');
  if (g.status && SHOP_GROUP_STATUS.indexOf(g.status) === -1) errors.push('狀態只能是開放或結束');
  // 賣貨便：貼賣場連結，不用選取貨場次、商品、付款說明（下單、付款、取貨都在賣貨便）
  var link = String(g.link || '').trim();
  var external = g.mode === '賣貨便' || !!link;
  if (external && !/^https:\/\/[^\s<>"']+$/.test(link)) errors.push('請貼上賣貨便的賣場連結（https:// 開頭）');
  if (link.length > 500) errors.push('賣場連結太長');
  var cover = String(g.cover || '').trim();
  if (cover && !/^[^\s<>"'&]{1,80}$/.test(cover)) errors.push('封面照片不對，請重新上傳');
  var duties = readTableCached_(SHEETS.DUTIES);
  // 取貨場次：可以不選（2026/10/10，使用者不需要）
  var pickups = external ? [] : (Array.isArray(g.pickups) ? g.pickups : []).map(String).filter(function (id, i, arr) { return id && arr.indexOf(id) === i; });
  pickups.forEach(function (id) { if (!findById_(duties, '勤務ID', id)) errors.push('有一個取貨場次找不到（可能活動被刪掉了）'); });
  var products = readTable_(SHEETS.SHOP_PRODUCTS);
  var items = [];
  (external ? [] : Array.isArray(g.items) ? g.items : []).forEach(function (it) {
    var p = it && findById_(products, '商品ID', it.id);
    if (!p) { errors.push('有一個商品找不到，請重新整理'); return; }
    var price = it.price === '' || it.price === undefined || it.price === null ? '' : shopInt_(it.price);
    var limit = it.limit === '' || it.limit === undefined || it.limit === null ? '' : shopInt_(it.limit);
    var per = it.perPerson === '' || it.perPerson === undefined || it.perPerson === null ? '' : shopInt_(it.perPerson);
    if (price === null) errors.push('「' + p['名稱'] + '」的價格請填整數');
    if (limit === null || limit === 0) errors.push('「' + p['名稱'] + '」的限量請填 1 以上的整數，或空白（不限）');
    if (per === null || per === 0) errors.push('「' + p['名稱'] + '」的每人上限請填 1 以上的整數，或空白（不限）');
    items.push({ id: p['商品ID'], price: price === '' ? '' : price, limit: limit === '' ? '' : limit, perPerson: per === '' ? '' : per });
  });
  if (!external && !items.length) errors.push('請至少選一樣商品');
  if (errors.length) throw new ApiError_('VALIDATION', '團購沒有存檔', errors.map(function (m) { return { message: m }; }));
  return withSignupLock_(function () {
    var rows = readTable_(SHEETS.SHOP_GROUPS);
    var orders = readTable_(SHEETS.SHOP_ORDERS);
    var now = nowString_();
    var values = { '名稱': name, '說明': cleanText_(g.description), '截止時間': deadline, '取貨場次': pickups.join(','), '商品設定': JSON.stringify(items),
      '付款說明': external ? '' : String(g.payInfo || '').trim(), '狀態': g.status || '開放', '更新時間': now,
      '賣場連結': external ? link : '', '封面': cover };
    var warnings = [];
    var row;
    if (g.id) {
      row = findById_(rows, '團購ID', g.id);
      if (!row) throw new ApiError_('NOT_FOUND', '找不到這次團購');
      var sold = shopSold_(orders, row['團購ID']);
      items.forEach(function (it) {
        var p = findById_(products, '商品ID', it.id);
        if (it.limit !== '' && (sold[it.id] || 0) > it.limit) warnings.push('「' + p['名稱'] + '」已經訂了 ' + sold[it.id] + ' 份，比限量多');
      });
      Object.keys(sold).forEach(function (id) {
        if (sold[id] && !items.some(function (it) { return it.id === id; })) { var p = findById_(products, '商品ID', id); warnings.push('「' + (p ? p['名稱'] : id) + '」拿掉了，但已經有人訂（訂單還在）'); }
      });
      var removed = String(row['取貨場次'] || '').split(',').filter(function (id) { return id && pickups.indexOf(id) === -1; });
      removed.forEach(function (id) {
        var n = orders.filter(function (o) { return o['團購ID'] === row['團購ID'] && o['狀態'] !== '已取消' && o['取貨活動ID'] === id; }).length;
        if (n) warnings.push('拿掉的取貨場次還有 ' + n + ' 張訂單（訂單還在，請通知他們改場次）');
      });
      updateRow_(SHEETS.SHOP_GROUPS, row, values);
    } else {
      row = Object.assign({ '團購ID': newId_('B'), '建立者': ADMIN_SESSION_ ? ADMIN_SESSION_.account : '', '建立時間': now }, values);
      appendRows_(SHEETS.SHOP_GROUPS, [row]);
    }
    var remindAt = shopScheduleDeadlinePush_(row); // 截止前一天晚上 8 點自動提醒
    writeDutyLog_('團購', (g.id ? '修改' : '開團') + '｜' + name + '｜截止 ' + deadline + '｜' + (external ? '賣貨便' : items.length + ' 樣商品') + (values['狀態'] === '結束' ? '｜已結束' : '') + adminTag_());
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_GROUPS);
    return { id: row['團購ID'], warnings: warnings, remindAt: remindAt || '' };
  });
}

/** body = { id }：沒有有效訂單才能刪 */
function adminShopDeleteGroup_(body) {
  return withSignupLock_(function () {
    var row = findById_(readTable_(SHEETS.SHOP_GROUPS), '團購ID', body.id);
    if (!row) throw new ApiError_('NOT_FOUND', '找不到這次團購');
    var n = readTable_(SHEETS.SHOP_ORDERS).filter(function (o) { return o['團購ID'] === row['團購ID'] && o['狀態'] !== '已取消'; }).length;
    if (n) throw new ApiError_('FORBIDDEN', '還有 ' + n + ' 張訂單，不能刪除；不賣了請改成「結束」');
    getSheet_(SHEETS.SHOP_GROUPS).deleteRow(row._row);
    shopScheduleDeadlinePush_(row, true); // 還沒送出的截止提醒一起刪
    writeDutyLog_('團購', '刪除｜' + row['名稱'] + adminTag_(), rowSnapshot_(SHEETS.SHOP_GROUPS, row));
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_GROUPS);
    return { deleted: true };
  });
}

/** body = { orderId, picked?, paid?, note?, cancel? }：取貨打勾、付款打勾、備註、取消（管理者不受截止限制） */
function adminShopOrderSet_(body) {
  return withSignupLock_(function () {
    var o = findById_(readTable_(SHEETS.SHOP_ORDERS), '訂單ID', body.orderId);
    if (!o) throw new ApiError_('NOT_FOUND', '找不到這張訂單');
    var ch = {};
    var what = [];
    if (body.picked !== undefined) { ch['已取貨'] = body.picked ? '是' : ''; what.push(body.picked ? '已取貨' : '改成還沒取貨'); }
    if (body.paid !== undefined) { ch['已付款'] = body.paid ? '是' : ''; what.push(body.paid ? '已付款' : '改成還沒付款'); }
    if (body.note !== undefined) { ch['備註'] = cleanText_(body.note).slice(0, 100); what.push('備註'); }
    if (body.cancel !== undefined) { ch['狀態'] = body.cancel ? '已取消' : '有效'; what.push(body.cancel ? '取消' : '恢復'); }
    if (!what.length) throw new ApiError_('BAD_REQUEST', '沒有要改的');
    if (body.cancel === false) {
      // 恢復訂單：限量要夠
      var orders = readTable_(SHEETS.SHOP_ORDERS);
      var g = findById_(readTable_(SHEETS.SHOP_GROUPS), '團購ID', o['團購ID']);
      if (g) {
        var view = shopGroupView_(g, readTable_(SHEETS.SHOP_PRODUCTS), orders);
        var errs = shopValidate_({ group: view, sold: shopSold_(orders, g['團購ID'], o['訂單ID']), now: shopNowMinute_(), admin: true },
          { pickupId: o['取貨活動ID'], items: shopJson_(o['品項'], []), pay: o['付款方式'], last5: o['末五碼'] });
        if (errs.length) throw new ApiError_('VALIDATION', '沒有恢復', errs);
      }
    }
    ch['更新時間'] = nowString_();
    var before = rowSnapshot_(SHEETS.SHOP_ORDERS, o);
    updateRow_(SHEETS.SHOP_ORDERS, o, ch);
    // 庫存：打勾已取貨記售出、取消打勾刪掉；取消訂單也刪掉
    if (body.picked !== undefined) stockForOrder_(o, !!body.picked && o['狀態'] !== '已取消');
    if (body.cancel === true) stockForOrder_(o, false);
    writeDutyLog_('團購訂單', o['姓名'] + '｜' + what.join('、') + adminTag_(), before);
    SpreadsheetApp.flush();
    invalidateTable_(SHEETS.SHOP_ORDERS);
    return { order: shopOrderOut_(o, null, false) };
  });
}

// ---------- 通知（5d） ----------

/** 某人某天要取的團購（有效、還沒取貨）：給每日提醒用 [{ group, items, total, pay, paid, last5, location, time }] */
function shopPickupsFor_(name, date) {
  var who = normalizeName_(name);
  if (!who) return [];
  var groups = readTableCached_(SHEETS.SHOP_GROUPS);
  return readTableCached_(SHEETS.SHOP_ORDERS).filter(function (o) {
    return o['取貨日期'] === date && o['狀態'] !== '已取消' && o['已取貨'] !== '是' && normalizeName_(o['姓名']) === who;
  }).map(function (o) {
    var g = findById_(groups, '團購ID', o['團購ID']);
    var pk = g ? shopPickups_(g).filter(function (p) { return p.id === o['取貨活動ID']; })[0] : null;
    return {
      group: g ? g['名稱'] : '', groupId: o['團購ID'], items: shopJson_(o['品項'], []).map(function (it) { return { name: it.name, qty: it.qty, unit: it.unit || '' }; }),
      total: Number(o['金額']) || 0, pay: o['付款方式'], paid: o['已付款'] === '是', last5: o['末五碼'] || '',
      location: pk ? pk.location : '', time: pk ? pk.startTime : ''
    };
  });
}

/** 這一天有團購要取的人（名字 → true），每日提醒決定要不要送 */
function shopPickupNames_(date) {
  var out = {};
  readTableCached_(SHEETS.SHOP_ORDERS).forEach(function (o) {
    if (o['取貨日期'] === date && o['狀態'] !== '已取消' && o['已取貨'] !== '是') out[normalizeName_(o['姓名'])] = true;
  });
  return out;
}

/**
 * 開團、改截止時間時：排一則「團購明天截止」推播（截止日前一天晚上 8 點；已經過了就不排）。
 * 先刪掉這次團購還沒送出的自動提醒再排；團購結束或刪除就不排。在 withSignupLock_ 裡呼叫。
 */
function shopScheduleDeadlinePush_(g, removeOnly) {
  var url = '#/shop/' + g['團購ID'];
  var old = readTable_(SHEETS.PUSH_PLANS).filter(function (r) { return r['狀態'] === '排定' && r['建立帳號'] === '自動' && r['網址'] === url; });
  if (old.length) deleteRows_(SHEETS.PUSH_PLANS, old.map(function (r) { return r._row; }));
  if (removeOnly || g['狀態'] === '結束' || !g['截止時間']) return null;
  var at = addDaysStr_(g['截止時間'].slice(0, 10), -1) + ' 20:00';
  if (at <= shopNowMinute_()) return null;
  var row = {
    '推播ID': newId_('P'), '類別': '植素', '勤務ID': g['團購ID'], '日期': '', '標題': '🛒 團購明天截止：' + g['名稱'],
    '內容': '⏰ ' + g['截止時間'] + ' 截止\n還沒訂的快來看看，訂過的可以再確認一下 😊', '網址': url, '預定時間': at,
    '狀態': '排定', '送出時間': '', '手機數': '', '建立帳號': '自動', '建立時間': nowString_(), '備註': '團購截止前一天自動提醒'
  };
  appendRows_(SHEETS.PUSH_PLANS, [row]);
  return at;
}
