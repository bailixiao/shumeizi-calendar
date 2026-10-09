// Cloudflare Worker 入口：所有請求都交給同一個 Durable Object（DutyStore）依序處理，資料存在它的 SQLite。
import { DurableObject } from 'cloudflare:workers';
import { createApp } from './app.js';
import { createSqlStore } from './store.js';

export class DutyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.store = createSqlStore(ctx.storage);
      this.app = createApp(this.store);
      this.store.persist(); // 第一次啟動：建立分頁標題
    });
  }

  async fetch(request) {
    try {
      return await this.app.handle(request);
    } finally {
      this.store.persist();
    }
  }

  async cron(when) {
    try {
      return await this.app.cron(when);
    } finally {
      this.store.persist();
    }
  }
}

function stub(env) {
  // 第一次建立時放在亞太區（離台灣近）
  return env.DB.get(env.DB.idFromName('main'), { locationHint: 'apac' });
}

export default {
  fetch: (request, env) => stub(env).fetch(request),
  // 只用一個「每 5 分鐘」的排程（Cloudflare 免費方案整個帳號最多 5 個，教全區已經用了 3 個）：
  // 每次都送排定時間到了的後台推播；台北 07:00（UTC 23:00）那次再提醒今天、台北 20:00（UTC 12:00）那次再提醒明天。
  async scheduled(event, env, ctx) {
    const d = new Date(event.scheduledTime);
    const jobs = [];
    if (d.getUTCMinutes() < 5 && d.getUTCHours() === 23) jobs.push('today');
    if (d.getUTCMinutes() < 5 && d.getUTCHours() === 12) jobs.push('tomorrow');
    jobs.push('plans');
    ctx.waitUntil((async () => { for (const j of jobs) await stub(env).cron(j); })());
  }
};
