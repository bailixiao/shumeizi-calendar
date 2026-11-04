// 團購會員登入（規格 0.6.3，2026/11/4）：驗證 Google／LINE 的登入，發我們自己的登入憑證。
// 憑證＝base64url(JSON { m: 會員ID, exp }) + '.' + HMAC-SHA256 簽章；金鑰在 Worker secret SHOP_SESSION_SECRET（不寫進程式）。
// Google、LINE 的 Client ID／Channel ID 本來就是公開的，放 wrangler.toml 的 vars。
// LINE 用 LIFF（2026/11/4）：網頁拿到 LINE 簽好的 ID token，這裡用公開的 Channel ID 請 LINE 驗證，不需要 Channel secret。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

const SESSION_DAYS = 180;
const b64url = (s) => Buffer.from(s).toString('base64url');

export function signSession(secret, memberId, nowMs) {
  const payload = b64url(JSON.stringify({ m: memberId, exp: Math.floor(nowMs / 1000) + SESSION_DAYS * 86400 }));
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}

/** 驗證登入憑證：對了回傳會員ID，不對（或過期）回傳 '' */
export function verifySession(secret, token, nowMs) {
  if (!secret || typeof token !== 'string') return '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return '';
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return '';
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return p && typeof p.m === 'string' && p.exp > nowMs / 1000 ? p.m : '';
  } catch (e) {
    return '';
  }
}

/**
 * 驗證登入，回傳 { provider, sub, email, displayName }。
 * body = { provider: 'google', credential } ｜ { provider: 'line', idToken }（LIFF 的 liff.getIDToken()）｜ { provider: 'demo', name }（只有本機示範版）
 */
export async function verifyLogin(gs, cfg, body, fetchFn) {
  const fail = (msg) => new gs.ApiError_('LOGIN', msg || '登入失敗，請再試一次');
  const doFetch = fetchFn || fetch;
  if (body.provider === 'demo') {
    if (!cfg.demoLogin) throw fail('沒有示範登入');
    const name = String(body.name || '').trim().slice(0, 20) || '示範買家';
    return { provider: '示範', sub: 'demo:' + name, email: '', displayName: name };
  }
  if (body.provider === 'google') {
    if (!cfg.googleClientId) throw new gs.ApiError_('CONFIG', '還沒設定 Google 登入');
    const res = await doFetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(body.credential || '')));
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.aud !== cfg.googleClientId || !/^(https:\/\/)?accounts\.google\.com$/.test(j.iss || '') || !j.sub) throw fail();
    if (Number(j.exp) * 1000 < Date.now()) throw fail('登入逾時了，請再試一次');
    return { provider: 'Google', sub: String(j.sub), email: j.email_verified === 'true' || j.email_verified === true ? String(j.email || '') : '', displayName: String(j.name || '') };
  }
  if (body.provider === 'line') {
    if (!cfg.lineChannelId) throw new gs.ApiError_('CONFIG', '還沒設定 LINE 登入');
    const idToken = String(body.idToken || '');
    if (!idToken) throw fail();
    // LINE 驗證簽章、發給誰（client_id）、有沒有過期
    const ver = await doFetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: cfg.lineChannelId })
    });
    const v = await ver.json().catch(() => ({}));
    if (!ver.ok || !v.sub || String(v.aud) !== String(cfg.lineChannelId) || v.iss !== 'https://access.line.me') throw fail();
    return { provider: 'LINE', sub: String(v.sub), email: '', displayName: String(v.name || '') };
  }
  throw fail();
}
