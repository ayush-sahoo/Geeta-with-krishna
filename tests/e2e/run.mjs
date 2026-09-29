// Runs every browser suite against the site served from the repo root. The
// Supabase backend, Meta pixel and Razorpay are simulated inside each suite,
// so nothing here touches production.
//
//   cd tests/e2e && npm install && node run.mjs
//
// Set CHROMIUM_PATH to use an already-installed Chromium instead of the one
// Playwright downloads. Screenshots go to OUT_DIR (default: a temp folder).
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SUITES = ['journeys.mjs', 'inapp.mjs', 'admin.mjs', 'login.mjs'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE_URL = `http://127.0.0.1:${server.address().port}`;
const OUT_DIR = process.env.OUT_DIR || await mkdtemp(join(tmpdir(), 'gita-e2e-'));
console.log(`Serving ${ROOT} at ${BASE_URL}; screenshots in ${OUT_DIR}`);

let failures = 0;
for (const suite of SUITES) {
  console.log(`\n=== ${suite}`);
  const child = spawn(process.execPath, [suite], { cwd: fileURLToPath(new URL('.', import.meta.url)), env: { ...process.env, BASE_URL, OUT_DIR } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
  child.stderr.on('data', (d) => process.stderr.write(d));
  const code = await new Promise((resolve) => child.on('close', resolve));
  // Some suites only print PASS/FAIL lines, so count those as well as the exit code.
  const failed = (out.match(/^FAIL /gm) || []).length;
  const passed = (out.match(/^PASS /gm) || []).length;
  console.log(`--- ${suite}: ${passed} passed, ${failed} failed${code ? `, exit ${code}` : ''}`);
  if (failed || code || !passed) failures++;
}
server.close();
console.log(failures ? `\n${failures} suite(s) failed` : '\nAll browser suites passed');
process.exit(failures ? 1 : 0);
