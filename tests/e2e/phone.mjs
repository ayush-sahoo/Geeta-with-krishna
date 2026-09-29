// Mobile OTP sign-in against a simulated Supabase, in a normal browser and inside Instagram.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function run(label, ua, inApp = '') {
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
  ok(order.indexOf('phoneAuth') < order.indexOf('googleLogin') && (!inApp || order.indexOf('passwordSignupStep') < order.indexOf('googleLogin')), 'mobile first; inside an app, Google goes last', order);
  const note = await pg.isVisible('#inAppNote') ? await pg.textContent('#inAppTitle') : '';
  ok(inApp ? note.includes(inApp) : !note, inApp ? `in-app note names ${inApp}` : 'no in-app note in a normal browser', note);
  if (inApp && /Android/.test(ua)) {
    // Android apps get a button that reopens the site in Chrome (checked in inapp.mjs).
    ok(await pg.isVisible('#openInChrome'), 'Android: "Open in Chrome to use Google" offered');
  } else if (inApp) {
    await pg.click('#googleLogin'); await pg.waitForTimeout(200);
    const msg = await pg.textContent('#authPageError');
    ok(!pg.url().includes('/auth/v1/authorize') && msg.includes('mobile number'), 'iPhone: Google is not attempted inside the app; the user is pointed to mobile number', msg);
    await pg.evaluate(() => { document.getElementById('authPageError').textContent = ''; });
  }
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
// Every Meta placement opens the site in one of these browsers. Audience
// Network ads open the phone's own browser (Chrome Custom Tab or Safari view).
const AND = 'Mozilla/5.0 (Linux; Android 14; RMX3392 Build/UKQ1.230924.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const PLACEMENTS = [
  ['Normal browser (desktop)', undefined, ''],
  ['Audience Network, Android (Chrome)', 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', ''],
  ['Audience Network, iPhone (Safari)', IOS.replace('Mobile/15E148', 'Version/18.1 Mobile/15E148 Safari/604.1'), ''],
  ['Instagram feed/reels/stories, Android', AND + ' Instagram 350.0.0.40.94 Android (34/14; 480dpi; 1080x2400; realme; RMX3392; RE58B2L1; qcom; en_IN; 640234114)', 'Instagram'],
  ['Instagram feed/reels/stories, iPhone', IOS + ' Instagram 350.0.0.25.97 (iPhone15,2; iOS 18_1; en_IN; en-IN; scale=3.00; 1179x2556; 612345678)', 'Instagram'],
  ['Facebook feed/reels/stories, Android', AND + ' [FB_IAB/FB4A;FBAV/485.0.0.62.107;]', 'Facebook'],
  ['Facebook feed/reels/stories, iPhone', IOS + ' [FBAN/FBIOS;FBAV/485.0.0.36.107;FBBV/662880396;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]', 'Facebook'],
  ['Messenger, Android', AND + ' [FB_IAB/Orca-Android;FBAV/475.0.0.43.109;]', 'Messenger'],
  ['Messenger, iPhone', IOS + ' [FBAN/MessengerForiOS;FBAV/475.0.0.33.109;FBBV/654321098;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_IN;FBOP/5]', 'Messenger'],
  ['Threads, Android', AND + ' Barcelona 350.0.0.40.94 Android (34/14; 480dpi; 1080x2400; realme; RMX3392; RE58B2L1; qcom; en_IN; 640234114)', 'Threads'],
  ['Threads, iPhone', IOS + ' Barcelona 350.0.0.25.97 (iPhone15,2; iOS 18_1; en_IN; en-IN; scale=3.00; 1179x2556; 612345678)', 'Threads'],
];
for (const [label, ua, inApp] of PLACEMENTS) await run(label, ua, inApp);
await b.close();
