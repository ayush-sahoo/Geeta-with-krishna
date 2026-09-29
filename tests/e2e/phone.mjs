// Mobile OTP sign-in against a simulated Supabase, in a normal browser and inside Instagram.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function run(label, ua) {
  console.log('\n# ' + label);
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(() => { window.fbq = function () { (window.__fb = window.__fb || []).push([...arguments]); }; });
  const S = { otp: [], verify: [], asks: 0, freeUsed: false };
  await ctx.route(/facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  await ctx.route(/supabase\.co/, async r => {
    const u = new URL(r.request().url()), p = u.pathname; if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
    const j = (x, s = 200) => r.fulfill({ status: s, headers: H, body: JSON.stringify(x) });
    const body = JSON.parse(r.request().postData() || '{}');
    if (p === '/auth/v1/otp') { S.otp.push(body); return body.phone === '+919999999999' ? j({ msg: 'Error sending SMS' }, 500) : j({}); }
    if (p === '/auth/v1/verify') { S.verify.push(body); if (body.token !== '123456') return j({ msg: 'Token has expired or is invalid' }, 403);
      return j({ access_token: 'tok_p', refresh_token: 'r', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'p1', phone: '919876543210', email: '', created_at: new Date().toISOString(), app_metadata: { provider: 'phone' } } }); }
    if (p.endsWith('get-my-access')) return j({ plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: !S.freeUsed });
    if (p.endsWith('ask-krishna')) { S.asks++; S.freeUsed = true; return j({ free_question: true, style: 'krishna_inspired', title: 'Be steady', paragraphs: ['Dear one, I hear you.'], actions: [], follow_up: '', verses: [] }); }
    return j([]);
  });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE + '/?fbclid=x&utm_source=ig'); await pg.waitForTimeout(600);
  await pg.evaluate(() => showScreen('ask')); await pg.fill('#askInput', 'Mujhe career ki chinta hai'); await pg.click('#sendAskButton'); await pg.waitForTimeout(300);
  ok(await pg.isVisible('#phoneAuth') && await pg.isVisible('#phoneNumber'), 'sign-up screen shows the mobile number option');
  const order = await pg.evaluate(() => [...document.querySelector('.auth-page-card').children].map(e => e.id || e.className).join(' > '));
  ok(order.indexOf('phoneAuth') < order.indexOf('googleLogin') && (!ua || order.indexOf('passwordSignupStep') < order.indexOf('googleLogin')), 'mobile first; inside Instagram, Google stays last', order);
  await pg.fill('#phoneNumber', '12345'); await pg.click('#sendOtpBtn'); await pg.waitForTimeout(150);
  ok((await pg.textContent('#authPageError')).includes('valid 10-digit') && S.otp.length === 0, 'invalid number rejected without sending an SMS');
  await pg.fill('#phoneNumber', '99999 99999'); await pg.click('#sendOtpBtn'); await pg.waitForTimeout(300);
  ok((await pg.textContent('#authPageError')).includes('Error sending SMS') && await pg.isHidden('#otpStep'), 'SMS failure shown, stays on number step');
  await pg.fill('#phoneNumber', '+91 98765-43210'); await pg.click('#sendOtpBtn'); await pg.waitForTimeout(300);
  ok(S.otp.at(-1)?.phone === '+919876543210' && S.otp.at(-1)?.create_user === true, 'OTP requested for +91 number (spaces, +91 and dashes handled)', JSON.stringify(S.otp.at(-1)));
  ok(await pg.isVisible('#otpStep') && (await pg.textContent('#otpPhone')) === '+91 98765 43210', 'OTP step shows the number');
  ok(await pg.isDisabled('#resendOtp') && (await pg.textContent('#resendOtp')).includes('in '), 'resend waits 30s');
  await pg.fill('#otpCode', '111111'); await pg.waitForTimeout(300);
  ok((await pg.textContent('#authPageError')).includes('wrong or has expired') && S.verify.length === 1, 'wrong OTP rejected (auto-submitted at 6 digits)');
  await pg.fill('#otpCode', '123456'); await pg.waitForTimeout(800);
  const scr = await pg.evaluate(() => [...document.querySelectorAll('.screen')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.id).join());
  ok(scr === 'ask' && S.asks === 1 && (await pg.textContent('#chat')).includes('Dear one'), 'after OTP, the pending question is answered', scr);
  ok(await pg.evaluate(() => (window.__fb || []).some(a => a[1] === 'CompleteRegistration' && a[2]?.registration_method === 'phone')), 'Meta CompleteRegistration fires with method phone');
  await pg.evaluate(() => showScreen('accountScreen')); await pg.waitForTimeout(100);
  ok((await pg.textContent('#accountEmail')) === '+919876543210' && (await pg.textContent('#accountProvider')) === 'Mobile', 'account screen shows the mobile number', await pg.textContent('#accountEmail'));
  ok(!errs.length, 'no JS errors', errs.join('|'));
  await ctx.close();
}
await run('Normal browser');
await run('Instagram in-app browser', 'Mozilla/5.0 (Linux; Android 14; RMX3392; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 Instagram 350.0.0.40.94 Android');
await b.close();
