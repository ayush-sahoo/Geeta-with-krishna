// The Android app (Play Store) opens the site with utm_source=android_app and
// gets an app layout: bottom tabs instead of the top menu, and the phone's back
// button walks back through screens. The website itself stays unchanged.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function open(url) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  await ctx.route(/supabase\.co/, r => { const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
    return r.request().method() === 'OPTIONS' ? r.fulfill({ status: 200, headers: H }) : r.fulfill({ headers: H, body: '[]' }); });
  await ctx.route(/facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + url); await p.waitForTimeout(400);
  return { ctx, p, errs };
}
const screen = p => p.evaluate(() => document.querySelector('.screen.active')?.id);
const tab = p => p.evaluate(() => document.querySelector('.tabbar button.active')?.id || null);

console.log('\n# Website (not the app)');
{ const { ctx, p, errs } = await open('/');
  ok(!(await p.isVisible('.tabbar')) && await p.isVisible('.topbar .nav'), 'the website keeps its top menu and shows no bottom tabs');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Android app');
{ const { ctx, p, errs } = await open('/?utm_source=android_app');
  ok(await p.isVisible('.tabbar') && !(await p.isVisible('.topbar .nav')), 'the app shows bottom tabs instead of the top menu');
  ok(await p.evaluate(() => document.getElementById('langButton').parentElement.classList.contains('toprow')) && await p.isVisible('#langButton'), 'the language button moves into the header');
  ok((await tab(p)) === 'tabHome', 'Home tab starts active', await tab(p));
  await p.click('#tabAsk'); ok((await screen(p)) === 'ask' && (await tab(p)) === 'tabAsk', 'Ask Krishna tab opens the chat', await screen(p));
  await p.click('#tabExplore'); ok((await screen(p)) === 'explore' && (await tab(p)) === 'tabExplore', 'Explore tab opens the chapters', await screen(p));
  await p.evaluate(() => showChapterPage(2)); ok((await tab(p)) === 'tabExplore', 'a chapter keeps the Explore tab active', await tab(p));
  await p.click('#tabMe'); ok((await screen(p)) === 'authScreen' && (await tab(p)) === 'tabMe', 'Account tab opens sign-in when signed out', await screen(p));
  const backs = [];
  for (let i = 0; i < 4; i++) { await p.goBack(); await p.waitForTimeout(250); backs.push(await screen(p)); }
  ok(backs.join(',') === 'chapter,explore,ask,home', 'the back button walks back through screens', backs.join(','));
  ok(await p.evaluate(() => sessionStorage.getItem('gitaAppMode')) === '1', 'app layout is remembered for this app session');
  const box = await p.locator('.tabbar').boundingBox();
  ok(box && Math.abs(box.y + box.height - 844) < 2, 'tabs sit at the bottom of the screen', JSON.stringify(box));
  await p.evaluate(() => showScreen('ask')); await p.focus('#askInput'); await p.waitForTimeout(150);
  ok(!(await p.isVisible('.tabbar')), 'tabs hide while typing, so the keyboard has room');
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(150);
  ok(await p.isVisible('.tabbar'), 'tabs come back after typing');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
await b.close();
