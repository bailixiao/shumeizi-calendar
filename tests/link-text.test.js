// 活動說明的網址變成可以點的連結（Google 地圖、菜單連結），其他字照樣跳脫。
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
global.window.SITE = global.window.SITE || { inviteTitle: '', shortageTitle: '' };
require('../js/format.js');
const Fmt = global.window.Fmt;

test('說明裡的網址可以點；Google 地圖顯示成 📍 Google 地圖；句尾標點不算網址', () => {
  assert.equal(Fmt.linkText('地圖：https://maps.app.goo.gl/AbC123。'),
    '地圖：<a href="https://maps.app.goo.gl/AbC123" target="_blank" rel="noopener">📍 Google 地圖</a>。');
  assert.equal(Fmt.linkText('菜單 https://example.com/menu?a=1&b=2, 謝謝'),
    '菜單 <a href="https://example.com/menu?a=1&amp;b=2" target="_blank" rel="noopener">https://example.com/menu?a=1&amp;b=2</a>, 謝謝');
  assert.equal(Fmt.linkText('<b>早點來</b>\n19:30'), '&lt;b&gt;早點來&lt;/b&gt;<br>19:30');
  assert.equal(Fmt.linkText('javascript:alert(1)'), 'javascript:alert(1)');
});
