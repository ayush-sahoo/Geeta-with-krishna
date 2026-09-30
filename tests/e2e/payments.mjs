// Payment edge cases against a simulated backend: slow or late Razorpay
// confirmation, returning without a session, errors when creating the link,
// an account that is already paid, and old purchases seen on a new device.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const DAY = 864e5;
const session = { access_token: 'tok_b', refresh_token: 'ref_b', token_type: 'bearer', expires_in: 3600, user: { id: 'b1', email: 'buyer@example.com', created_at: new Date(Date.now() - 5 * DAY).toISOString(), app_metadata: { provider: 'email' } } };

// opts: signedIn, paidAfterPolls (0 = never during this page), paidAt (ms ago), linkStatus, linkBody
async function open(opts, path = '/') {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([s, signedIn]) => {
    window.__fb = []; window.fbq = function () { window.__fb.push([...arguments]); };
    if (signedIn) localStorage.setItem('gitaAuthSession', JSON.stringify(s));
  }, [session, !!opts.signedIn]);
  const S = { polls: 0, links: 0 };
  await ctx.route(/facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  await ctx.route(/rzp\.io/, r => r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>razorpay</h1>' }));
  await ctx.route(/supabase\.co/, async r => {
    const u = new URL(r.request().url()), p = u.pathname;
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
    const j = (x, s = 200) => r.fulfill({ status: s, headers: H, body: JSON.stringify(x) });
    if (p === '/auth/v1/token') return j(session);
    if (p === '/auth/v1/user') return j(session.user);
    if (p.endsWith('get-my-access')) {
      S.polls++;
      const paid = opts.paidAfterPolls ? S.polls >= opts.paidAfterPolls : !!opts.paid;
      return j(paid
        ? { plan_status: 'annual', payment_status: 'paid', payment_id: 'pay_B1', purchased_at: new Date(Date.now() - (opts.paidAt || 60e3)).toISOString(), access_expires_at: new Date(Date.now() + 300 * DAY).toISOString(), access_active: true }
        : { plan_status: 'free', payment_status: 'unpaid', access_active: false, free_question_available: false });
    }
    if (p.endsWith('create-payment-link')) { S.links++; return j(opts.linkBody || { id: 'plink_B', short_url: 'https://rzp.io/l/b' }, opts.linkStatus || 200); }
    return j([]);
  });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(BASE + path);
  return { ctx, pg, S, errs };
}
const purchases = pg => pg.evaluate(() => window.__fb.filter(a => a[1] === 'Purchase'));
const screen = pg => pg.evaluate(() => [...document.querySelectorAll('.screen')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.id).join());

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
  await ctx.close(); }

console.log('\n# Buy tapped by someone who already has access');
{ const { ctx, pg, S } = await open({ signedIn: true, paid: true, paidAt: 30 * DAY });
  await pg.waitForTimeout(800);
  await pg.evaluate(() => startLifetimePurchase()); await pg.waitForTimeout(400);
  ok(S.links === 0 && (await pg.textContent('#toast')).includes('already active'), 'no new payment link; told access is already active', await pg.textContent('#toast'));
  await ctx.close(); }

await b.close();
