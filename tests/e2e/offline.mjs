// Offline screen and links into a screen (used by the Android app's
// shortcuts and its daily verse notification).
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8768';
const ok = (c, m, d = '') => console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' -> ' + d));
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const VERSE = [{ chapter_id: 3, verse_number: 19, sanskrit: 'तस्मादसक्तः सततं कार्यं कर्म समाचर ।\nअसक्तो ह्याचरन्कर्म परमाप्नोति पूरुषः ॥', translation_english: 'Therefore, without attachment, always do the work that has to be done.' }];
async function open(url) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/supabase\.co/, r => { const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'content-type': 'application/json' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: H });
    return r.fulfill({ headers: H, body: JSON.stringify(r.request().url().includes('get_daily_verse') ? VERSE : []) }); });
  await ctx.route(/facebook|fonts\.g/, r => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + url); await p.waitForTimeout(500);
  return { ctx, p, errs };
}
const screen = p => p.evaluate(() => document.querySelector('.screen.active')?.id);

console.log('\n# Links into a screen');
{ const { ctx, p, errs } = await open('/?utm_source=android_app&open=talk');
  ok((await screen(p)) === 'ask' && !(await p.isHidden('#talkMode')), '?open=talk opens Talk to Krishna', await screen(p));
  ok(!(await p.evaluate(() => location.search)).includes('open='), 'the link is tidied from the address afterwards', await p.evaluate(() => location.search));
  ok((await p.evaluate(() => location.search)).includes('utm_source=android_app'), 'the app source is kept');
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
{ const { ctx, p, errs } = await open('/?open=ask');
  ok((await screen(p)) === 'ask' && await p.isHidden('#talkMode') && await p.isVisible('#chatMode'), '?open=ask opens the chat', await screen(p));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
{ const { ctx, p, errs } = await open('/?open=verse');
  ok((await screen(p)) === 'home' && await p.evaluate(() => { const r = document.querySelector('#home .verse-mini').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "?open=verse shows today's verse on the home screen");
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }

console.log('\n# Offline screen');
{ const { ctx, p, errs } = await open('/');
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(300);
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('gitaDailyVerse') || '{}').n === 19), "today's verse is saved on the phone");
  await p.reload(); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'the offline helper is running');
  await ctx.setOffline(true);
  await p.goto(BASE + '/?utm_source=android_app').catch(() => {}); await p.waitForTimeout(400);
  ok((await p.textContent('h1')).includes("You're offline"), 'without internet the Gita Verse offline screen shows', await p.textContent('h1').catch(() => ''));
  ok((await p.textContent('#tag')).includes('3.19') && (await p.textContent('#meaning')).includes('without attachment'), 'it shows the last verse of the day the phone saw');
  ok(await p.evaluate(() => { const i = document.querySelector('.logo'); return i.complete && i.naturalWidth > 0; }), 'the logo shows offline');
  ok(await p.isVisible('#retry'), 'a Reconnect button is shown');
  await ctx.setOffline(false);
  await p.waitForFunction(() => document.querySelector('.screen.active')?.id === 'home', null, { timeout: 5000 }).catch(() => {});
  ok((await screen(p)) === 'home', 'coming back online opens the site again by itself', await screen(p));
  ok(!errs.length, 'no JS errors', errs.join('|')); await ctx.close(); }
await b.close();
