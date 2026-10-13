// 部署 Apps Script：clasp push，再更新「記帳即時更新」那個網頁應用程式部署（它固定跑某一版，不 deploy 就還是舊程式）。
// 用法（專案根目錄）：node tools/deploy-gas.js
// 部署 ID 不寫在程式裡（公開儲存庫）：從 clasp deployments 找說明是「記帳即時更新」的那一個。
const { execSync } = require('child_process');
const path = require('path');

const dir = path.join(__dirname, '..', 'apps-script');
const run = (cmd) => execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const DESC = '記帳即時更新';

const pushed = run('npx clasp push --force');
console.log('clasp push：' + (pushed.match(/\.gs/g) || []).length + ' 個檔案');
const list = run('npx clasp deployments');
const line = list.split('\n').find((l) => l.includes(DESC));
const id = line && (line.match(/-\s+(\S+)\s+@/) || [])[1];
if (!id) {
  console.error('找不到「' + DESC + '」的部署：請執行 cd apps-script && npx clasp deploy -d "' + DESC + '"，' +
    '再把 https://script.google.com/macros/s/<部署ID>/exec 用 npx wrangler secret put LEDGER_PUSH_URL 設給 Worker');
  process.exit(1);
}
console.log(run('npx clasp deploy -i ' + id + ' -d "' + DESC + '"').trim());
