// Verses are stored with "|" (Sanskrit) or "." (transliteration) at line ends
// and "||2-47||" at the end; the verse page shows them as । and ॥ 2.47 ॥, kept
// on the line they end (verseMarks in app.js).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const verseMarks=new Function(app.slice(app.indexOf('function verseMarks('),app.indexOf('async function openVerse('))+'return verseMarks')();
test('Sanskrit line ends and the verse number become dandas',()=>{
  assert.equal(verseMarks('कर्मण्येवाधिकारस्ते मा फलेषु कदाचन |\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ||२-४७||'),
    'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥ २.४७ ॥');
});
test('transliteration keeps its avagraha dots and gets the same marks',()=>{
  assert.equal(verseMarks('mā phaleṣu kadācana .\nte saṅgo.astvakarmaṇi ||2-47||',true),'mā phaleṣu kadācana ।\nte saṅgo.astvakarmaṇi ॥ 2.47 ॥');
});
