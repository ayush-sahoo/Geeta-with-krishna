const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/tts-krishna/index.ts','utf8').replace(/^import .*;\n/gm,''));
const c=vm.createContext({Deno:{serve(){}},console});vm.runInContext(source,c);
test('line boundaries get a pause and verse numbers are removed',()=>{const text=c.chantText('धर्मक्षेत्रे कुरुक्षेत्रे समवेता युयुत्सवः ।\nमामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय ॥ १.१ ॥');assert.match(text,/<break time="0.7s" \/>/);assert.ok(text.endsWith('<break time="1.2s" />'));assert.doesNotMatch(text.replace(/<[^>]*>/g,''),/[१1]/);assert.equal((text.match(/<break/g)||[]).length,2);});
test('ASCII verse markers and newlines keep phrasing',()=>{const text=c.chantText('First line\nSecond line ||1-1||');assert.equal(text,'First line <break time="0.7s" /> Second line <break time="1.2s" />');});
test('caller supplied markup cannot become speech controls',()=>{const text=c.chantText('<break time="99s"/>One । Two');assert.doesNotMatch(text,/99s/);assert.equal((text.match(/<break/g)||[]).length,2);});
