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
  const S = { polls: 0, links: 0, refreshes: 0, linkAuth: [], linkBodies: [], events: [] };
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
        ? { plan_status: 'annual', payment_status: 'paid', payment_id: 'pay_B1', amount_paid_paise: opts.paidPaise || 49900, purchased_at: new Date(Date.now() - (opts.paidAt || 60e3)).toISOString(), access_expires_at: new Date(Date.now() + 300 * DAY).toISOString(), access_active: true }
        : { plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: false });
    }
    if (p.endsWith('/rpc/log_event')) { S.events.push(JSON.parse(r.request().postData() || '{}').p_event); return j(null); }
    if (p.endsWith('create-payment-link')) {
      S.links++; S.linkAuth.push(r.request().headers()['authorization']); S.linkBodies.push(r.request().postData() || '');
      if ((r.request().postData() || '').includes('"popup"') && !opts.linkBody) return j({ order_id: 'order_B', key_id: 'rzp_live_key', amount: (r.request().postData() || '').includes('"monthly"') ? 14900 : 49900, currency: 'INR', prefill: { contact: '+919876543210' } });
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
  ok(o?.order_id === 'order_B' && o?.key === 'rzp_live_key' && o?.amount === 49900 && o?.name === 'Gita Verse', 'Razorpay pop-up opens for the Gita Verse order', JSON.stringify(o));
  ok(o?.prefill?.contact === '+919876543210', 'phone number from sign-up is filled in for the buyer', JSON.stringify(o?.prefill));
  ok(pg.url() === urlBefore, 'buyer stays on Gita Verse (no redirect to a payment page)', pg.url());
  ok((await pg.evaluate(() => window.__fb.filter(a => a[1] === 'InitiateCheckout').length)) === 1, 'Meta InitiateCheckout sent once when the pop-up opens');
  ok(await pg.isDisabled('#accountUpgrade') && await pg.evaluate(() => sessionStorage.getItem('gitaCheckoutPending') !== null), 'buy buttons stay locked while the pop-up is open');
  await pg.evaluate(() => window.__rzp.opts.modal.ondismiss()); await pg.waitForTimeout(200);
  ok(!(await pg.isDisabled('#accountUpgrade')) && await pg.evaluate(() => sessionStorage.getItem('gitaCheckoutPending') === null), 'closing the pop-up unlocks the buy buttons');
  ok((await purchases(pg)).length === 0 && !(await toastText(pg)).includes('not confirmed'), 'closing it without paying sends no Purchase and no payment message');
  ok(['checkout_click', 'checkout_annual', 'checkout_open', 'checkout_dismiss'].every((e) => S.events.includes(e)) && !S.events.includes('checkout_open_failed'), 'checkout steps recorded: click, plan, window opened, closed without paying', S.events.join(','));
  ok(JSON.parse(S.linkBodies[0]).meta?.ua?.length > 10, 'browser details for Meta matching are sent with the checkout', S.linkBodies[0]);
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# On-site checkout fails to open');
{ const { ctx, pg, S, errs } = await open({ signedIn: true, session: phoneSession, checkout: 'popup-broken', paidAfterPolls: 0 });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase());
  await pg.waitForFunction(() => /payment window/.test(document.getElementById('toast').textContent), null, { timeout: 8000 }).catch(() => {});
  ok((await toastText(pg)).includes('Could not open the payment window'), 'buyer is told the payment window could not open', await toastText(pg));
  ok(!(await pg.isDisabled('#accountUpgrade')) && (await pg.textContent('#accountUpgrade')).includes('See plans'), 'buy buttons unlock so the buyer can try again', await pg.textContent('#accountUpgrade'));
  ok(await pg.evaluate(() => sessionStorage.getItem('gitaCheckoutPending') === null), 'no pending payment is left behind');
  ok(S.events.includes('checkout_open_failed') && !S.events.includes('checkout_create_failed'), 'recorded as "window failed to open"', S.events.join(','));
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

console.log('\n# Offer screen: monthly plan');
{ const o = { signedIn: true, session: phoneSession, checkout: 'popup', paidAfterPolls: 0, paidPaise: 14900 };
  const { ctx, pg, S, errs } = await open(o);
  await pg.waitForTimeout(800);
  await pg.evaluate(() => showPaywall());
  await pg.click('.plan[data-plan="monthly"]');
  ok(S.events.includes('plan_monthly'), 'tapping the 1-month card is recorded', S.events.join(','));
  ok((await pg.textContent('#offerBuy')).includes('₹149 for 1 month') && await pg.getAttribute('.plan[data-plan="monthly"]', 'aria-checked') === 'true', 'choosing 1 month selects it and names it on the button', await pg.textContent('#offerBuy'));
  await pg.click('#offerBuy');
  await pg.waitForFunction(() => window.__rzp?.opened === 1, null, { timeout: 8000 }).catch(() => {});
  const ro = await pg.evaluate(() => window.__rzp?.opts);
  ok(S.links === 1 && JSON.parse(S.linkBodies[0]).plan === 'monthly', 'asks the server for the monthly plan', JSON.stringify(S.linkBodies));
  ok(ro?.amount === 14900 && /1-Month/.test(ro?.description), 'pop-up shows ₹149 for 1-Month Access', JSON.stringify(ro));
  const meta = await pg.evaluate(() => window.__fb.filter(a => a[1] === 'CheckoutClick' || a[1] === 'InitiateCheckout').map(a => [a[1], a[2].value, a[2].content_ids[0]]));
  ok(meta.length === 2 && meta.every(m => m[1] === 149 && m[2] === 'gita_monthly'), 'Meta checkout events carry ₹149 and the 1-month product', JSON.stringify(meta));
  o.paidAfterPolls = S.polls + 1;
  await pg.evaluate(() => window.__rzp.opts.handler({ razorpay_payment_id: 'pay_B1', razorpay_order_id: 'order_B' }));
  await pg.waitForFunction(() => window.__fb.some(a => a[1] === 'Purchase'), null, { timeout: 15000 }).catch(() => {});
  const p = await purchases(pg);
  ok(p.length === 1 && p[0][2].value === 149 && p[0][2].content_ids[0] === 'gita_monthly', 'Meta Purchase is sent once with value ₹149', JSON.stringify(p));
  ok((await toastText(pg)).includes('1-Month Access unlocked') && (await pg.textContent('#accountPlan')) === '1 month', 'buyer sees 1-Month Access unlocked and the plan on Account', await toastText(pg) + ' / ' + await pg.textContent('#accountPlan'));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Offer screen: monthly plan chosen while signed out');
{ const { ctx, pg, S, errs } = await open({ checkout: 'popup', paidAfterPolls: 0 });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => showPaywall());
  await pg.click('.plan[data-plan="monthly"]'); await pg.click('#offerBuy');
  ok((await screen(pg)) === 'authScreen' && await pg.evaluate(() => localStorage.getItem('gitaBuyPlan')) === 'monthly', 'sign-in is asked first and the chosen plan is remembered', await screen(pg));
  ok(await pg.evaluate(() => takeBuyAfterSignIn()) === 'monthly' && await pg.evaluate(() => localStorage.getItem('gitaBuyPlan')) === null, 'after sign-in the monthly plan is bought, then forgotten');
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
  ok(S.events.includes('checkout_create_failed') && !S.events.includes('checkout_open_failed'), 'recorded as "checkout could not be created"', S.events.join(','));
  ok(!(await pg.isDisabled('#accountUpgrade')) && (await pg.textContent('#accountUpgrade')).includes('See plans'), 'buy buttons unlock so they can try again', await pg.textContent('#accountUpgrade'));
  ok(await pg.evaluate(() => window.__fb.some(a => a[1] === 'CheckoutError') && !window.__fb.some(a => a[1] === 'InitiateCheckout')), 'CheckoutError recorded, no InitiateCheckout');
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(600);
  ok(S.links === 2, 'a second tap after the error tries again');
  ok((await pg.textContent('#offerText')) === '1 month or 1 year · One-time payment, no autopay' && (await pg.textContent('#offerTitle')) === 'Plans from ₹149', 'bottom offer bar shows both plans and no autopay', await pg.textContent('#offerText'));
  ok((await pg.innerHTML('#accountUpgrade')).includes('<small class="btn-sub">1 month or 1 year · One-time payment, no autopay</small>'), 'paywall button keeps its plans and no-autopay line after unlocking');
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

console.log('\n# Payment already made, confirmation not in yet');
{ const o = { signedIn: true, checkout: 'popup', paidAfterPolls: 0, linkStatus: 409, linkBody: { error: 'Your payment was received and is being confirmed. Please wait a moment.', payment_processing: true } };
  const { ctx, pg, S, errs } = await open(o);
  await pg.waitForTimeout(800);
  o.paidAfterPolls = S.polls + 2;
  await pg.evaluate(() => startLifetimePurchase('monthly'));
  await pg.waitForFunction(() => window.__fb.some(a => a[1] === 'Purchase'), null, { timeout: 15000 }).catch(() => {});
  ok(S.links === 1 && !(await pg.evaluate(() => window.__rzp?.opened)), 'no payment window is opened again', 'links=' + S.links);
  ok((await purchases(pg)).length === 1 && (await screen(pg)) === 'accountScreen', 'the site waits for the confirmation, then shows access and sends Purchase', await screen(pg));
  ok(!S.events.includes('checkout_create_failed'), 'not counted as a failed checkout', S.events.join(','));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Meta Purchase value is what was actually paid');
{ const { ctx, pg, errs } = await open({ signedIn: true, paid: true, paidPaise: 100000 });
  await pg.waitForFunction(() => window.__fb.some(a => a[1] === 'Purchase'), null, { timeout: 8000 }).catch(() => {});
  const p = await purchases(pg);
  ok(p.length === 1 && p[0][2].value === 1000 && p[0][2].content_ids[0] === 'gita_annual', 'an annual purchase made at ₹1,000 is reported as ₹1,000', JSON.stringify(p));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Someone who bought the retired 3-month plan');
{ const { ctx, pg, errs } = await open({ signedIn: true, paid: true, paidPaise: 39900 });
  await pg.waitForFunction(() => window.__fb.some(a => a[1] === 'Purchase'), null, { timeout: 8000 }).catch(() => {});
  await pg.evaluate(() => showScreen('accountScreen'));
  const p = await purchases(pg);
  ok((await pg.textContent('#accountPlan')) === '3 months' && p[0]?.[2]?.value === 399 && p[0]?.[2]?.content_ids[0] === 'gita_quarterly', 'Account still names the 3-month plan and Meta gets ₹399', await pg.textContent('#accountPlan') + ' ' + JSON.stringify(p));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Every buy button opens the plan choice first');
{ const { ctx, pg, S, errs } = await open({ signedIn: true, paid: false });
  await pg.waitForTimeout(800);
  for (const [name, go] of [['Account page button', () => { showScreen('accountScreen'); document.getElementById('accountUpgrade').click(); }], ['bottom bar button', () => { showScreen('home'); offerAction(); }]]) {
    await pg.evaluate(() => showScreen('home'));
    await pg.evaluate(go); await pg.waitForTimeout(200);
    ok((await screen(pg)) === 'offerScreen' && S.links === 0 && (await pg.locator('.plan').count()) === 2, name + ' opens the 1-year / 1-month choice', await screen(pg));
  }
  await pg.evaluate(() => { selectOfferPlan('monthly'); showScreen('accountScreen'); document.getElementById('accountUpgrade').click(); });
  ok(await pg.getAttribute('.plan[data-plan="monthly"]', 'aria-checked') === 'true' && (await pg.textContent('#offerBuy')).includes('₹149'), 'the last chosen plan stays selected');
  ok((await pg.textContent('#offerScreen .meta')) === 'Full Access' && !(await pg.textContent('#offerScreen')).includes('Annual Access'), 'the offer screen does not call both plans "Annual Access"');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Offer screen in an Indian language');
{ const { ctx, pg, errs } = await open({ signedIn: true, paid: false });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => setWebsiteLanguage('hi')); await pg.waitForTimeout(800);
  await pg.evaluate(() => showPaywall()); await pg.waitForTimeout(300);
  const text = await pg.textContent('#offerScreen');
  const english = ['1 month', '1 year', 'BEST VALUE', 'Unlimited Ask Krishna', 'Maybe later', 'One-time payment', 'Choose your plan', 'CHOOSE YOUR PLAN'].filter(t => text.includes(t));
  ok(!english.length, 'plan names, benefits, badge and buttons are shown in Hindi', english.join(' | '));
  await pg.click('.plan[data-plan="monthly"]'); await pg.waitForTimeout(200);
  ok(!(await pg.textContent('#offerBuy')).includes('month'), 'the button text for the chosen plan is translated too', await pg.textContent('#offerBuy'));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

await b.close();
