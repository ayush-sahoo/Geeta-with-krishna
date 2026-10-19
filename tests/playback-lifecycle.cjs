const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
function narration(){
  const played=[];const player={pause(){},play(){played.push(this.src);return Promise.resolve()}};
  const c=vm.createContext({speaking:true,narrationPaused:true,resumeNarration:null,narrationGeneration:1,cancelPlayback:null,currentAudio:null,ambientAudio:null,audioUrl:null,voicePlayer:player,URL:{createObjectURL:blob=>blob.id,revokeObjectURL(){}},narrationUI(){}});
  vm.runInContext(source.slice(source.indexOf('function stopSpeech(){'),source.indexOf('// Safari (iPhone')),c);
  vm.runInContext(source.slice(source.indexOf('async function playBlob('),source.indexOf('// Narration is split')),c);
  return {c,played};
}
test('restart cannot wake a clip waiting in a previous paused narration',async()=>{
  const {c,played}=narration();const old=c.playBlob({id:'old'},1);
  c.stopSpeech();c.speaking=true;await old;assert.deepEqual(played,[]);
  const current=c.playBlob({id:'new'},c.narrationGeneration);await new Promise(setImmediate);
  assert.deepEqual(played,['new']);c.cancelPlayback();await current;
});
test('ordinary resume still plays the waiting clip',async()=>{
  const {c,played}=narration();const p=c.playBlob({id:'resumed'},1);
  c.narrationPaused=false;c.resumeNarration();await new Promise(setImmediate);
  assert.deepEqual(played,['resumed']);c.cancelPlayback();await p;
});
function videoRuntime(){
  let resolve,active='chapter',plays=0;const video={dataset:{},pause(){},play(){plays++;return Promise.resolve()}};
  const box={dataset:{chapter:'1'},querySelector:()=>video,querySelectorAll:()=>[]};
  const nodes={chapterVideo:box,chapter:{classList:{contains:()=>active==='chapter'}},home:{classList:{contains:()=>active==='home'}},offer:{style:{}},homeNav:{classList:{add(){}}},exploreNav:{classList:{add(){}}}};
  const c=vm.createContext({$:id=>nodes[id],chapterVideoGeneration:0,authSession:null,hasLifetimeAccess:()=>true,document:{getElementById:id=>nodes[id],querySelectorAll:sel=>sel==='.screen'?['home','chapter'].map(id=>({id,classList:{toggle:(cls,on)=>{if(on)active=id}}})):sel==='#chapterVideo video'?[video]:[]},logEvent(){},trackMeta(){},stopSpeech(){},talkCancel(){},talkStage:null,askMode:'chat',APP_MODE:false,window:{scrollTo(){}},currentChapter:1,chapterVideoParts:()=>new Promise(r=>resolve=r),toast(){}});
  vm.runInContext(source.slice(source.indexOf('async function playChapterVideo('),source.indexOf('function renderChapterPage('))+source.slice(source.indexOf('function showScreen('),source.indexOf('\nif(APP_MODE){')),c);
  return {c,resolve:()=>resolve(['https://example.invalid/part.mp4']),plays:()=>plays};
}
test('leaving a chapter while links load prevents hidden video playback',async()=>{
  const r=videoRuntime(),p=r.c.playChapterVideo(1,0);r.c.showScreen('home');r.resolve();await p;assert.equal(r.plays(),0);
});
test('leaving and returning to the same chapter cannot revive an old request',async()=>{
  const r=videoRuntime(),p=r.c.playChapterVideo(1,0);r.c.showScreen('home');r.c.showScreen('chapter');r.resolve();await p;assert.equal(r.plays(),0);
});
test('a chapter kept on screen still starts normally',async()=>{
  const r=videoRuntime(),p=r.c.playChapterVideo(1,0);r.resolve();await p;assert.equal(r.plays(),1);
});
