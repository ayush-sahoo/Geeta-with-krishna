// Payment edge cases against a simulated backend: slow or late Razorpay
// confirmation, returning without a session, errors when creating the link,
// an account that is already paid, and old purchases seen on a new device.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const DAY = 864e5;
// A JWT-shaped token that expires `inSec` seconds from now (the site reads exp).
const jwt = (inSec, tag = 'x') => ['e30', Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + inSec, tag })).toString('base64url'), 'sig'].join('.');
const session = { access_token: 'tok_b', refresh_token: 'ref_b', token_type: 'bearer', expires_in: 3600, user: { id: 'b1', email: 'buyer@example.com', created_at: new Date(Date.now() - 5 * DAY).toISOString(), app_metadata: { provider: 'email' } } };

// opts: signedIn, session (stored session), refresh ('ok' | 'reject' | 'network'),
// paidAfterPolls (0 = never during this page), paidAt (ms ago), linkStatus, linkBody
async function open(opts, path = '/') {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([s, signedIn]) => {
    window.__fb = []; window.fbq = function () { window.__fb.push([...arguments]); };
    if (signedIn) localStorage.setItem('gitaAuthSession', JSON.stringify(s));
  }, [opts.session || session, !!opts.signedIn]);
  const S = { polls: 0, links: 0, refreshes: 0, linkAuth: [], linkBodies: [] };
  await ctx.route(/facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  // Razorpay's on-site checkout script: blocked unless a test opts in, which
  // also exercises the fallback to the hosted payment link.
  await ctx.route(/checkout\.razorpay\.com/, r => opts.checkout === 'popup' || opts.checkout === 'popup-broken'
    ? r.fulfill({ status: 200, headers: { 'content-type': 'text/javascript' }, body: 'window.Razorpay=function(o){window.__rzp={opts:o,opened:0,handlers:{}};this.open=function(){' + (opts.checkout === 'popup-broken' ? 'throw new Error("blocked")' : 'window.__rzp.opened++') + '};this.on=function(e,f){window.__rzp.handlers[e]=f}};' })
    : r.abort());
  await ctx.route(/rzp\.io/, r => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>razorpay</h1>' }));
  await ctx.route(/supabase\.co/, async r => {
    const u = new URL(r.request().url()), p = u.pathname;
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
    const j = (x, s = 200) => r.fulfill({ status: s, headers: H, body: JSON.stringify(x) });
    if (p === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') {
        S.refreshes++;
        if (opts.refreshAfterStart && S.refreshes === 1) return j(opts.session || session); // page load
        if (opts.refresh === 'network') return r.abort();
        if (opts.refresh === 'reject') return j({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
        return j({ ...session, access_token: opts.renewedToken || session.access_token });
      }
      return j(session); // password sign-in
    }
    if (p === '/auth/v1/user') return j(session.user);
    if (p.endsWith('get-my-access')) {
      S.polls++;
      const paid = opts.paidAfterPolls ? S.polls >= opts.paidAfterPolls : !!opts.paid;
      return j(paid
        ? { plan_status: 'annual', payment_status: 'paid', payment_id: 'pay_B1', purchased_at: new Date(Date.now() - (opts.paidAt || 60e3)).toISOString(), access_expires_at: new Date(Date.now() + 300 * DAY).toISOString(), access_active: true }
        : { plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: false });
    }
    if (p.endsWith('create-payment-link')) {
      S.links++; S.linkAuth.push(r.request().headers()['authorization']); S.linkBodies.push(r.request().postData() || '');
      if ((r.request().postData() || '').includes('"popup"') && !opts.linkBody) return j({ order_id: 'order_B', key_id: 'rzp_live_key', amount: 100000, currency: 'INR', prefill: { contact: '+919876543210' } });
      return j(opts.linkBody || { id: 'plink_B', short_url: 'https://rzp.io/l/b' }, opts.linkStatus || 200);
    }
    return j([]);
  });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE + path);
  return { ctx, pg, S, errs };
}
const purchases = pg => pg.evaluate(() => window.__fb.filter(a => a[1] === 'Purchase'));
const screen = pg => pg.evaluate(() => [...document.querySelectorAll('.screen')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.id).join());

const phoneSession = { ...session, user: { ...session.user, email: '', phone: '919876543210', app_metadata: { provider: 'phone' } } };
const toastText = pg => pg.textContent('#toast');

console.log('\n# On-site checkout (Razorpay pop-up)');
{ const { ctx, pg, S, errs } = await open({ signedIn: true, session: phoneSession, checkout: 'popup', paidAfterPolls: 0 });
  await pg.waitForTimeout(800);
  const urlBefore = pg.url();
  await pg.evaluate(() => startLifetimePurchase());
  await pg.waitForFunction(() => window.__rzp?.opened === 1, null, { timeout: 8000 }).catch(() => {});
  const o = await pg.evaluate(() => window.__rzp?.opts);
  ok(S.links === 1 && S.linkBodies[0].includes('"popup"'), 'asks the server for an on-site checkout order', JSON.stringify(S.linkBodies));
  ok(o?.order_id === 'order_B' && o?.key === 'rzp_live_key' && o?.amount === 100000 && o?.name === 'Gita Verse', 'Razorpay pop-up opens for the Gita Verse order', JSON.stringify(o));
  ok(o?.prefill?.contact === '+919876543210', 'phone number from sign-up is filled in for the buyer', JSON.stringify(o?.prefill));
  ok(pg.url() === urlBefore, 'buyer stays on Gita Verse (no redirect to a payment page)', pg.url());
  ok((await pg.evaluate(() => window.__fb.filter(a => a[1] === 'InitiateCheckout').length)) === 1, 'Meta InitiateCheckout sent once when the pop-up opens');
  ok(await pg.isDisabled('#accountUpgrade') && await pg.evaluate(() => sessionStorage.getItem('gitaCheckoutPending') !== null), 'buy buttons stay locked while the pop-up is open');
  await pg.evaluate(() => window.__rzp.opts.modal.ondismiss()); await pg.waitForTimeout(200);
  ok(!(await pg.isDisabled('#accountUpgrade')) && await pg.evaluate(() => sessionStorage.getItem('gitaCheckoutPending') === null), 'closing the pop-up unlocks the buy buttons');
  ok((await purchases(pg)).length === 0 && !(await toastText(pg)).includes('not confirmed'), 'closing it without paying sends no Purchase and no payment message');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# On-site checkout fails to open');
{ const { ctx, pg, errs } = await open({ signedIn: true, session: phoneSession, checkout: 'popup-broken', paidAfterPolls: 0 });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase());
  await pg.waitForFunction(() => /payment window/.test(document.getElementById('toast').textContent), null, { timeout: 8000 }).catch(() => {});
  ok((await toastText(pg)).includes('Could not open the payment window'), 'buyer is told the payment window could not open', await toastText(pg));
  ok(!(await pg.isDisabled('#accountUpgrade')) && (await pg.textContent('#accountUpgrade')).includes('Get Annual Access'), 'buy buttons unlock so the buyer can try again', await pg.textContent('#accountUpgrade'));
  ok(await pg.evaluate(() => sessionStorage.getItem('gitaCheckoutPending') === null), 'no pending payment is left behind');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# On-site checkout: paid');
{ const o = { signedIn: true, session: phoneSession, checkout: 'popup', paidAfterPolls: 0 };
  const { ctx, pg, S, errs } = await open(o);
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase());
  await pg.waitForFunction(() => window.__rzp?.opened === 1, null, { timeout: 8000 }).catch(() => {});
  o.paidAfterPolls = S.polls + 2; // the webhook lands a moment after the payment
  await pg.evaluate(() => window.__rzp.opts.handler({ razorpay_payment_id: 'pay_B1', razorpay_order_id: 'order_B' }));
  await pg.waitForFunction(() => window.__fb.some(a => a[1] === 'Purchase'), null, { timeout: 15000 }).catch(() => {});
  const p = await purchases(pg);
  ok(p.length === 1 && p[0][3]?.eventID === 'gita_purchase_pay_B1', 'after paying in the pop-up, access is confirmed and Meta Purchase sent once', JSON.stringify(p));
  ok((await screen(pg)) === 'accountScreen' && (await toastText(pg)).includes('Annual Access unlocked'), 'buyer sees Annual Access unlocked on Gita Verse', await toastText(pg));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# On-site checkout: page reloaded on return from the UPI app');
{ const o = { signedIn: true, session: phoneSession, checkout: 'popup', paidAfterPolls: 0 };
  const { ctx, pg, errs } = await open(o);
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase());
  await pg.waitForFunction(() => window.__rzp?.opened === 1, null, { timeout: 8000 }).catch(() => {});
  o.paid = true; o.paidAfterPolls = 0; // paid in the UPI app; the in-app browser reloads the page
  await pg.reload();
  await pg.waitForFunction(() => /unlocked/.test(document.getElementById('toast').textContent), null, { timeout: 8000 }).catch(() => {});
  ok((await screen(pg)) === 'accountScreen' && (await toastText(pg)).includes('Annual Access unlocked'), 'after a reload the purchase is still confirmed on screen', await toastText(pg));
  ok((await purchases(pg)).length === 1, 'Meta Purchase sent once after the reload');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# On-site checkout unavailable: falls back to the payment page');
{ const { ctx, pg, S, errs } = await open({ signedIn: true, session: phoneSession, paidAfterPolls: 0 });
  await pg.waitForTimeout(800);
  const nav = pg.waitForURL(/rzp\.io/, { timeout: 12000 }).then(() => true).catch(() => false);
  await pg.evaluate(() => startLifetimePurchase());
  ok(await nav, 'with the checkout script blocked, the buyer is sent to the Razorpay payment page');
  ok(S.links === 1 && !S.linkBodies[0].includes('"popup"'), 'fallback asks for a payment link, not a pop-up order', JSON.stringify(S.linkBodies));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Razorpay confirms after ~20 s');
{ const { ctx, pg, errs } = await open({ signedIn: true, paidAfterPolls: 15 }, '/?payment=success');
  await pg.waitForFunction(() => window.__fb.some(a => a[1] === 'Purchase'), null, { timeout: 32000 }).catch(() => {});
  const p = await purchases(pg);
  ok(p.length === 1 && p[0][3]?.eventID === 'gita_purchase_pay_B1', 'still confirmed on the return page and Meta Purchase sent once', JSON.stringify(p));
  ok((await screen(pg)) === 'accountScreen', 'buyer lands on the account page with access', await screen(pg));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Razorpay confirms after the buyer stopped waiting');
{ const first = await open({ signedIn: true, paidAfterPolls: 0 }, '/?payment=success');
  await first.pg.waitForTimeout(2500);
  ok((await purchases(first.pg)).length === 0, 'no Purchase while the payment is unconfirmed');
  await first.ctx.close();
  // Later visit, same browser: the webhook has landed by now.
  const later = await open({ signedIn: true, paid: true });
  await later.pg.waitForTimeout(1500);
  const p = await purchases(later.pg);
  ok(p.length === 1 && p[0][3]?.eventID === 'gita_purchase_pay_B1', 'Meta Purchase sent on the next visit once access is active', JSON.stringify(p));
  await later.pg.reload(); await later.pg.waitForTimeout(1500);
  ok((await purchases(later.pg)).length === 0, 'not sent again on another reload');
  await later.ctx.close(); }

console.log('\n# Old purchase seen on a new device');
{ const { ctx, pg } = await open({ signedIn: true, paid: true, paidAt: 30 * DAY });
  await pg.waitForTimeout(1500);
  ok((await purchases(pg)).length === 0, 'a 30-day-old purchase is not reported to Meta again');
  await ctx.close(); }

console.log('\n# Returns from Razorpay without being signed in');
{ const { ctx, pg, errs } = await open({ signedIn: false }, '/?payment=success');
  await pg.waitForTimeout(800);
  ok((await screen(pg)) === 'authScreen' && (await pg.textContent('#authPageError')).includes('If you have paid, sign in'), 'sign-in screen explains the payment is on their account', await pg.textContent('#authPageError'));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Payment link cannot be created');
{ const { ctx, pg, S } = await open({ signedIn: true, linkStatus: 502, linkBody: { error: 'Could not start payment. Please try again.' } });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(600);
  ok(S.links === 1 && (await pg.textContent('#toast')).includes('Could not start payment'), 'buyer sees "Could not start payment"', await pg.textContent('#toast'));
  ok(!(await pg.isDisabled('#accountUpgrade')) && (await pg.textContent('#accountUpgrade')).includes('Annual'), 'buy buttons unlock so they can try again', await pg.textContent('#accountUpgrade'));
  ok(await pg.evaluate(() => window.__fb.some(a => a[1] === 'CheckoutError') && !window.__fb.some(a => a[1] === 'InitiateCheckout')), 'CheckoutError recorded, no InitiateCheckout');
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(600);
  ok(S.links === 2, 'a second tap after the error tries again');
  ok((await pg.textContent('#offerText')) === 'About ₹83/month · One-time payment, no autopay' && (await pg.textContent('#offerTitle')) === '₹1,000 for 1 year', 'bottom offer bar shows per-month price and no autopay', await pg.textContent('#offerText'));
  ok((await pg.innerHTML('#accountUpgrade')).includes('<small class="btn-sub">About ₹83/month · One-time payment, no autopay</small>'), 'paywall button keeps its per-month and no-autopay line after unlocking');
  await ctx.close(); }

console.log('\n# Buy tapped by someone who already has access');
{ const { ctx, pg, S } = await open({ signedIn: true, paid: true, paidAt: 30 * DAY });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(400);
  ok(S.links === 0 && (await pg.textContent('#toast')).includes('already active'), 'no new payment link; told access is already active', await pg.textContent('#toast'));
  await ctx.close(); }

console.log('\n# Login expired while the tab was open (in-app browsers keep tabs for days)');
{ const renewed = jwt(3600, 'new');
  const { ctx, pg, S } = await open({ signedIn: true, renewedToken: renewed });
  await pg.waitForTimeout(800); const before = S.refreshes;
  await pg.evaluate(t => { authSession = { ...authSession, access_token: t }; }, jwt(-5, 'old'));
  const nav = pg.waitForRequest(r => r.url().startsWith('https://rzp.io/'), { timeout: 5000 }).catch(() => null);
  await pg.evaluate(() => startLifetimePurchase());
  const went = await nav;
  ok(S.refreshes === before + 1 && S.linkAuth[0] === 'Bearer ' + renewed, 'login renewed first; payment link made with the new login', JSON.stringify({ refreshes: S.refreshes - before, auth: S.linkAuth[0]?.slice(0, 20) }));
  ok(!!went, 'buyer is taken to Razorpay');
  await ctx.close(); }

console.log('\n# Network drops while the page loads');
{ const { ctx, pg, S } = await open({ signedIn: true, refresh: 'network' });
  await pg.waitForTimeout(1000);
  ok(await pg.evaluate(() => !!localStorage.getItem('gitaAuthSession') && !!authSession), 'visitor stays signed in (not logged out by a network error)');
  const nav = pg.waitForRequest(r => r.url().startsWith('https://rzp.io/'), { timeout: 5000 }).catch(() => null);
  await pg.evaluate(() => startLifetimePurchase());
  ok(!!(await nav) && S.links === 1, 'and can still pay');
  await ctx.close(); }

console.log('\n# Supabase rejects the stored login');
{ const { ctx, pg } = await open({ signedIn: true, refresh: 'reject' });
  await pg.waitForTimeout(1000);
  ok(await pg.evaluate(() => !localStorage.getItem('gitaAuthSession') && !authSession), 'signed out when the login is really invalid');
  await ctx.close(); }

console.log('\n# Login rejected at the moment of buying');
{ const { ctx, pg, S } = await open({ signedIn: true, refresh: 'reject', refreshAfterStart: true });
  await pg.waitForTimeout(800);
  await pg.evaluate(t => { authSession = { ...authSession, access_token: t }; }, jwt(-5, 'old'));
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(500);
  ok(S.links === 0 && (await screen(pg)) === 'authScreen' && (await pg.textContent('#authPageError')).includes('Payment opens right after'), 'sent to sign-in with a clear message, no broken payment attempt', (await screen(pg)) + ' / ' + (await pg.textContent('#authPageError')));
  ok(!(await pg.isDisabled('#accountUpgrade')), 'buy buttons unlocked');
  await ctx.close(); }

console.log('\n# Buy tapped while signed out: sign in, then payment opens by itself');
{ const { ctx, pg, S } = await open({ signedIn: false });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(300);
  ok((await screen(pg)) === 'authScreen' && S.links === 0, 'asked to sign in first');
  await pg.evaluate(() => setAuthPageMode('login'));
  await pg.fill('#passwordEmail', 'buyer@example.com'); await pg.fill('#passwordPassword', 'secret123');
  const nav = pg.waitForRequest(r => r.url().startsWith('https://rzp.io/'), { timeout: 6000 }).catch(() => null);
  await pg.click('#passwordLoginBtn');
  ok(!!(await nav) && S.links === 1, 'after signing in, Razorpay opens without another tap', 'links=' + S.links);
  await ctx.close(); }

await b.close();
