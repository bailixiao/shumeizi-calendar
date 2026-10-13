// js/xlsx-lite.js：記帳下載 Excel 用的 .xlsx（不壓縮的 zip）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const window = {};
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'js', 'xlsx-lite.js'), 'utf8'))(window);
const { Xlsx } = window;

test('crc32 和標準一樣；做出來的檔案是 zip，裡面有每個分頁', async () => {
  assert.equal(Xlsx.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const blob = Xlsx.build([{ name: '(1)、115年零用金', rows: [['日期', '金額'], ['115.01.10', 9857], ['期末', { v: -1515, b: true, fill: true }]] }, { name: '損益表', rows: [['A & <B>']] }]);
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString(), 'PK');
  const text = buf.toString('utf8');
  assert.ok(text.includes('xl/worksheets/sheet2.xml'));
  assert.ok(text.includes('<sheet name="(1)、115年零用金"'));
  assert.ok(text.includes('<v>9857</v>'));
  assert.ok(text.includes('A &amp; &lt;B&gt;'));
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, '結尾是 zip 的目錄');
});
