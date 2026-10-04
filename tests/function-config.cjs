// Every edge function has an explicit gateway setting in supabase/config.toml,
// so a CLI deploy can't silently switch JWT checking on for a function that is
// called without a login (Razorpay, pg_cron, the SMS hook) or off for one that
// relies on it.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('each function folder has a [functions.<name>] verify_jwt entry',()=>{
  const config=fs.readFileSync('supabase/config.toml','utf8');
  const dirs=fs.readdirSync('supabase/functions',{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.name.startsWith('_')).map(d=>d.name);
  assert.ok(dirs.includes('meta-purchase-retry'));
  const setting=n=>{const i=config.indexOf('[functions.'+n+']');return i<0?null:(config.slice(i).match(/verify_jwt = (true|false)/)||[])[1];};
  assert.deepEqual(dirs.filter(n=>!setting(n)),[],'functions without a verify_jwt entry');
  assert.match(config,/\[functions\.meta-purchase-retry\]\s*\nverify_jwt = false/);
  assert.match(config,/\[functions\.razorpay-webhook\]\s*\nverify_jwt = false/);
});
