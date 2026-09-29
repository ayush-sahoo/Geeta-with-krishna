// Meta events contain product/activity metadata only, never questions or credentials.
function trackMeta(name,data={},custom=false,eventId){
  try{if(typeof fbq!=='function')return false;
    if(eventId)fbq(custom?'trackCustom':'track',name,data,{eventID:eventId});
    else fbq(custom?'trackCustom':'track',name,data);
    return true;
  }catch(e){return false}
}
// Advanced matching: once someone is signed in, the pixel attaches their email
// or mobile number (and account id) to each event, hashed with SHA-256 in the
// browser, so Meta can tie more sign-ups and purchases back to the ad that
// brought them. Same pixel as in index.html.
const META_PIXEL_ID='2178415463100322';
let metaUserKey='';
function setMetaUser(user){
  try{
    if(typeof fbq!=='function'||!user?.id)return;
    const data={external_id:user.id};
    const email=String(user.email||'').trim().toLowerCase();
    const phone=String(user.phone||'').replace(/\D/g,'');
    if(email)data.em=email;
    if(phone)data.ph=phone;
    const key=JSON.stringify(data);
    if(key===metaUserKey)return;
    metaUserKey=key;
    fbq('init',META_PIXEL_ID,data);
  }catch(e){}
}
const annualEvent={value:1000,currency:'INR',content_name:'Gita Verse Annual Access',content_ids:['gita_annual'],content_type:'product',num_items:1};
function trackConfirmedPurchase(){
  const id=accountProfile?.payment_id;
  if(!hasLifetimeAccess()||!id)return;
  const key='gitaMetaPurchase:'+id;
  try{if(localStorage.getItem(key)||localStorage.getItem('metaPurchaseTracked')===id)return}catch(e){}
  if(trackMeta('Purchase',annualEvent,false,'gita_purchase_'+id)){
    try{localStorage.setItem(key,'1');localStorage.setItem('metaPurchaseTracked',id)}catch(e){}
  }
}
// Reference design with the existing Gita Verse service integrations.
const SUPA='https://bkwvuckznpaawmqrjjgk.supabase.co';
const KEY='sb_publishable_xiYHK1Q_5FcGkaSbug89Qg_yeDuR3KW';
const $=id=>document.getElementById(id);
// First-party analytics for the admin dashboard: an anonymous per-browser id,
// page visits with their ad/UTM source, and funnel events (see log_visit /
// log_event / set_my_attribution in Supabase).
const VISITOR_ID=(()=>{
  const ok=v=>/^[A-Za-z0-9_-]{8,64}$/.test(v||'');
  let id=null;
  try{
    const handed=new URLSearchParams(location.search).get('vid');
    id=ok(handed)?handed:localStorage.getItem('gitaVisitorId');
    if(!ok(id))id='v_'+(crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):Math.random().toString(36).slice(2)+Date.now().toString(36));
    localStorage.setItem('gitaVisitorId',id);
  }catch(e){id=id||'v_'+Math.random().toString(36).slice(2)+Date.now().toString(36)}
  return id;
})();
function rpc(fn,args,opts={}){
  const headers={apikey:KEY,'Content-Type':'application/json'};
  const tok=(typeof authSession!=='undefined'&&authSession?.access_token)||null;
  if(tok)headers.Authorization='Bearer '+tok;
  return fetch(SUPA+'/rest/v1/rpc/'+fn,{method:'POST',headers,body:JSON.stringify(args),keepalive:!!opts.keepalive}).catch(()=>{});
}
function logEvent(event,opts){rpc('log_event',{p_visitor_id:VISITOR_ID,p_event:event},opts)}
async function visitorGeo(){
  // City/region from Vercel's edge (/api/geo). Best effort: never delays the visit log by more than 1.5s.
  try{
    const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),1500);
    const r=await fetch('/api/geo',{signal:ctl.signal});clearTimeout(t);
    return r.ok?await r.json():{};
  }catch(e){return {}}
}
// Which Meta app's built-in browser the page is open in, if any. Messenger and
// Threads are checked first: their user agents also carry Facebook/Instagram
// markers or none at all ("Barcelona" is Threads).
function metaInAppName(ua){
  return /Orca-Android|MessengerForiOS|MessengerLite|FBAN\/Messenger/i.test(ua)?'Messenger'
    :/Barcelona/.test(ua)?'Threads'
    :/Instagram/i.test(ua)?'Instagram'
    :/FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(ua)?'Facebook':null;
}
async function logVisit(){
  const q=new URLSearchParams(location.search);
  const ua=navigator.userAgent||'';
  const inApp=metaInAppName(ua);
  const path=location.pathname+(location.hash||''),referrer=document.referrer||null;
  const geo=await visitorGeo();
  rpc('log_visit',{p_visitor_id:VISITOR_ID,p_path:path,p_referrer:referrer,
    p_utm_source:q.get('utm_source'),p_utm_medium:q.get('utm_medium'),p_utm_campaign:q.get('utm_campaign'),p_utm_content:q.get('utm_content'),
    p_has_fbclid:q.has('fbclid'),p_in_app:inApp,p_device:/Android/i.test(ua)?'android':/iPhone|iPad|iPod/i.test(ua)?'ios':'desktop',
    p_region:geo.region||null,p_city:geo.city||null});
}
function attributeSignup(){if(authSession?.access_token)rpc('set_my_attribution',{p_visitor_id:VISITOR_ID})}
let authSession=null,accountProfile=null,authPageMode='login',selectedVerse=null,currentTab='meaning';
let speaking=false,currentAudio=null,ambientAudio=null,audioUrl=null,chatBusy=false,verseRequest=0;
const verseCache=new Map();
let saved;try{saved=new Set(JSON.parse(localStorage.getItem('savedVerses')||'[]'))}catch(e){saved=new Set()}
    const LIFE_TOPICS={
      love:{
        label:'Love',icon:'♥',kicker:'Love without possession',
        intro:'The Gita rarely treats love as romance alone. It points toward a steadier love: compassion without hatred, seeing oneself in others, and devotion that does not demand possession or control.',
        dos:['Care without trying to possess or control the other person.','Practice compassion even when you disagree.','Notice whether your love makes you more generous, patient and truthful.'],
        donts:['Do not confuse attachment with love.','Do not make another person responsible for your inner stability.','Do not use love as a reason to abandon discernment or self-respect.'],
        practice:'Today, do one caring action without expecting appreciation, attention, or a return favour.',
        verses:[
          {c:12,v:13,n:'Love begins with non-hatred and compassion toward every being.'},
          {c:6,v:32,n:'A mature heart learns to recognize another person’s joy and pain as deeply as its own.'},
          {c:9,v:29,n:'Divine love is impartial; closeness grows through sincere devotion rather than status or privilege.'},
          {c:18,v:65,n:'Krishna brings love, remembrance, devotion and surrender together as a personal relationship with the Divine.'}
        ]
      },
      lust:{
        label:'Lust & Desire',icon:'◆',kicker:'When desire starts controlling you',
        intro:'The Gita does not say every desire is evil. It warns about desire that becomes compulsive — when wanting turns into attachment, frustration, anger and loss of judgment.',
        dos:['Notice desire early, before it becomes obsession.','Reduce repeated exposure to triggers that strengthen craving.','Redirect restless energy into disciplined action, exercise, study or service.'],
        donts:['Do not keep feeding a fantasy and then expect the urge to disappear.','Do not shame yourself for having desire; observe it without automatically obeying it.','Do not make decisions at the peak of craving.'],
        practice:'When a strong urge appears, wait 10 minutes before acting. Move your body, change context, and observe whether the urge rises and falls.',
        verses:[
          {c:3,v:37,n:'Krishna identifies uncontrolled desire and anger as powerful inner enemies born of restless passion.'},
          {c:2,v:62,n:'Repeatedly dwelling on an object can grow into attachment, and attachment into craving.'},
          {c:2,v:63,n:'Frustrated craving can become anger, confusion and ultimately poor judgment.'},
          {c:3,v:41,n:'The practical response is to regulate the senses early, before desire becomes overpowering.'}
        ]
      },
      anger:{
        label:'Anger',icon:'⚡',kicker:'Interrupt anger before it owns the mind',
        intro:'The Gita traces anger back to frustrated attachment and desire. Its solution is not suppression alone, but awareness, self-mastery and reducing the inner demand that life must go exactly as we want.',
        dos:['Create a pause before speaking or sending a message.','Identify what expectation or attachment was frustrated.','Return to the issue only after your body and mind have settled.'],
        donts:['Do not make permanent decisions during a temporary surge of anger.','Do not rehearse the insult repeatedly in your mind.','Do not mistake aggression for strength.'],
        practice:'Use a 90-second rule today: no reply, call, or confrontation until you have breathed slowly and named what exactly triggered you.',
        verses:[
          {c:2,v:62,n:'Attachment creates the conditions from which anger can arise.'},
          {c:2,v:63,n:'Anger clouds memory and judgment, making wise action harder.'},
          {c:5,v:23,n:'Freedom grows when one can withstand the surge of desire and anger before acting on it.'},
          {c:16,v:21,n:'Desire, anger and greed are described as three forces that can destroy inner clarity.'}
        ]
      },
      fear:{
        label:'Fear & Anxiety',icon:'◌',kicker:'Steadiness when the future is uncertain',
        intro:'The Gita does not promise a life without uncertainty. It teaches steadiness inside uncertainty — through perspective, disciplined action, trust and freedom from being ruled by imagined outcomes.',
        dos:['Separate what is in your control from what is not.','Take the next concrete action instead of solving the entire future mentally.','Return attention to duty, preparation and present effort.'],
        donts:['Do not treat every imagined outcome as a prediction.','Do not delay all action until you feel completely certain.','Do not let fear become your only source of advice.'],
        practice:'Write two columns: “within my control” and “outside my control.” Act on one item from the first column today.',
        verses:[
          {c:2,v:56,n:'Steady wisdom is marked by a mind not shattered by sorrow or intoxicated by pleasure.'},
          {c:4,v:10,n:'Many have moved beyond fear by taking refuge in deeper understanding and devotion.'},
          {c:6,v:5,n:'The mind can become either your ally or your enemy; self-training changes that relationship.'},
          {c:18,v:66,n:'The closing teaching asks for surrender of obsessive control and trust beyond fear.'}
        ]
      },
      attachment:{
        label:'Attachment',icon:'∞',kicker:'Care deeply without clinging',
        intro:'Non-attachment in the Gita does not mean not caring. It means acting with full sincerity while refusing to make your peace dependent on one result, person, possession or identity.',
        dos:['Give full effort while accepting that outcomes have many causes.','Keep your identity larger than one role, relationship or result.','Practice gratitude without assuming permanence.'],
        donts:['Do not make success the condition for self-worth.','Do not cling harder just because something is changing.','Do not call indifference “detachment.”'],
        practice:'Choose one result you are gripping tightly. Write down the best effort you can make, then deliberately release the rest for today.',
        verses:[
          {c:2,v:47,n:'You are responsible for action, but you cannot own every outcome.'},
          {c:2,v:48,n:'Yoga is steadiness in success and failure rather than emotional dependence on either.'},
          {c:3,v:19,n:'Perform necessary action without attachment to the fruit.'},
          {c:5,v:10,n:'One who offers action without attachment is compared to a lotus untouched by water.'}
        ]
      },
      ego:{
        label:'Ego',icon:'◎',kicker:'You are not the sole doer',
        intro:'The Gita challenges the ego’s belief that “I alone am the doer.” It asks us to recognize nature, circumstance, other people and deeper forces participating in every action.',
        dos:['Credit the people and conditions that helped you.','Stay teachable even when you are skilled.','Separate your role from your entire identity.'],
        donts:['Do not assume every success proves superiority.','Do not turn every disagreement into a threat to identity.','Do not confuse humility with weakness or self-erasure.'],
        practice:'At the end of today, list three things you accomplished and one person, circumstance, or unseen support that made each possible.',
        verses:[
          {c:3,v:27,n:'Actions arise through the qualities of nature, while ego claims complete authorship.'},
          {c:13,v:29,n:'Clear seeing includes recognizing nature as the field in which action unfolds.'},
          {c:18,v:58,n:'When action is centred in the Divine rather than ego, difficulties are faced differently.'},
          {c:18,v:59,n:'Acting from egoic refusal does not free us from the deeper forces shaping our duty.'}
        ]
      },
      grief:{
        label:'Grief & Loss',icon:'☾',kicker:'How to hold loss without collapsing',
        intro:'The Gita begins in grief. Krishna does not mock Arjuna’s pain; he widens Arjuna’s perspective on life, death, identity and responsibility so grief does not become paralysis.',
        dos:['Allow grief to be felt without demanding that it disappear quickly.','Stay connected to people and simple responsibilities.','Hold the memory of what was lost without letting loss become your only identity.'],
        donts:['Do not force yourself to “be spiritual” instead of feeling pain.','Do not isolate indefinitely.','Do not assume today’s intensity will remain unchanged forever.'],
        practice:'Give grief a container: 15 quiet minutes to remember, write, pray, or sit. After that, return gently to one ordinary task.',
        verses:[
          {c:2,v:11,n:'Krishna begins by challenging the assumptions underneath Arjuna’s grief.'},
          {c:2,v:20,n:'The Self is described as unborn and undying, deeper than bodily change.'},
          {c:2,v:27,n:'Whatever is born will die; mortality is treated as part of the structure of embodied life.'},
          {c:2,v:30,n:'The indwelling Self is described as beyond destruction, offering a wider frame for loss.'}
        ]
      },
      mind:{
        label:'Mind & Overthinking',icon:'≈',kicker:'Train the mind instead of fighting it',
        intro:'The Gita treats the mind as trainable. Overthinking is not solved by one perfect thought, but by repeatedly returning attention, strengthening discipline and becoming less identified with every mental movement.',
        dos:['Return attention to one chosen task or breath when the mind wanders.','Reduce unnecessary inputs when the mind is overstimulated.','Build routines that make concentration easier.'],
        donts:['Do not debate every thought as if it deserves an answer.','Do not confuse thinking longer with thinking better.','Do not expect concentration to improve without repetition.'],
        practice:'Do one 12-minute single-task block today with notifications off. Each time the mind wanders, return without judging yourself.',
        verses:[
          {c:6,v:5,n:'The trained mind can lift you; the untrained mind can work against you.'},
          {c:6,v:26,n:'Whenever the mind wanders, the practice is simply to bring it back again.'},
          {c:6,v:35,n:'Krishna acknowledges that the mind is difficult to control, but says practice and detachment make it possible.'},
          {c:2,v:64,n:'Moving through life without compulsive attraction and aversion creates greater inner clarity.'}
        ]
      },
      duty:{
        label:'Duty & Career',icon:'→',kicker:'What is mine to do?',
        intro:'The Gita’s language of dharma is broader than career, but it is highly relevant to work: identify the responsibility that is genuinely yours, perform it well, and do not let comparison or obsession with rewards corrupt the action.',
        dos:['Define the responsibility that is actually yours today.','Measure yourself by quality of effort, preparation and integrity.','Choose work aligned with your nature and strengths where possible.'],
        donts:['Do not spend more energy comparing paths than walking your own.','Do not abandon responsibility only because the result is uncertain.','Do not confuse ambition with purpose.'],
        practice:'Write the single most important responsibility you have today. Give it your best uninterrupted 30 minutes before checking outcomes.',
        verses:[
          {c:2,v:31,n:'Arjuna is asked to look clearly at the duty arising from his actual role and situation.'},
          {c:3,v:8,n:'Necessary action is better than withdrawal from responsibility.'},
          {c:3,v:19,n:'Work fully without becoming attached to the reward.'},
          {c:18,v:47,n:'Imperfectly living one’s own path is preferable to perfectly imitating another’s.'}
        ]
      },
      devotion:{
        label:'Devotion & Faith',icon:'✦',kicker:'A relationship, not just a belief',
        intro:'Bhakti in the Gita is not blind belief. It is a reorientation of attention, action and identity toward the Divine, expressed through remembrance, offering, trust, humility and compassion.',
        dos:['Turn ordinary actions into offerings through intention.','Remember the Divine during both success and difficulty.','Let devotion make you kinder, steadier and less ego-driven.'],
        donts:['Do not use devotion to avoid practical responsibility.','Do not measure spirituality only by emotion or ritual intensity.','Do not use faith to judge people who practice differently.'],
        practice:'Before one ordinary task today, pause and inwardly offer the action. Do it carefully, then release the need for recognition.',
        verses:[
          {c:9,v:22,n:'Krishna describes care for those who remain steadily devoted and centred in Him.'},
          {c:9,v:26,n:'Even a simple offering is meaningful when given with sincere devotion.'},
          {c:12,v:13,n:'Devotion shows up ethically as compassion, friendliness and freedom from hatred.'},
          {c:18,v:65,n:'Remember, love, worship and surrender are woven together in Krishna’s closing personal teaching.'}
        ]
      }
    };

const chapterArtwork=["assets/chapter-art-1.webp", "assets/chapter-art-2.webp", "assets/chapter-art-3.webp", "assets/chapter-art-4.webp", "assets/chapter-art-5.webp", "assets/chapter-art-6.webp"];
const chapterArtMap=[0,1,2,3,4,5,1,5,1,3,3,3,1,1,4,2,5,4];
const chapters=[
['Arjuna Vishada Yoga',47,'The crisis that begins the journey.'],['Sankhya Yoga',72,'Knowledge, action and the nature of the self.'],['Karma Yoga',43,'The path of disciplined action.'],['Jnana Karma Sannyasa Yoga',42,'Wisdom, action and renunciation.'],['Karma Sannyasa Yoga',29,'Renunciation and inner freedom.'],['Dhyana Yoga',47,'Meditation, discipline and the mind.'],['Jnana Vijnana Yoga',30,'Knowing the self and the divine.'],['Akshara Brahma Yoga',28,'The imperishable and remembrance.'],['Raja Vidya Raja Guhya Yoga',34,'The royal knowledge and deepest secret.'],['Vibhuti Yoga',42,'The divine manifestations.'],['Vishvarupa Darshana Yoga',55,'The vision of the universal form.'],['Bhakti Yoga',20,'The path of devotion.'],['Kshetra Kshetrajna Vibhaga Yoga',35,'Field, knower and discernment.'],['Gunatraya Vibhaga Yoga',27,'The three qualities of nature.'],['Purushottama Yoga',20,'The supreme person and the cosmic tree.'],['Daivasura Sampad Vibhaga Yoga',24,'Divine and destructive tendencies.'],['Shraddhatraya Vibhaga Yoga',28,'Three forms of faith.'],['Moksha Sannyasa Yoga',78,'Renunciation, duty and liberation.']
];
let currentChapter=1,currentPage=1;const PAGE_SIZE=10;
function renderChapters(){const box=document.getElementById('chapterList');box.innerHTML=chapters.map((c,i)=>`<article class="chapter-item" id="ch-${i+1}"><button class="chapter-head" onclick="showChapterPage(${i+1})"><img class="chapter-illustration" src="${chapterArtwork[chapterArtMap[i]]}" alt="" aria-hidden="true"><div class="chapter-badge">${String(i+1).padStart(2,'0')}</div><div class="chapter-info"><h3>${c[0]}</h3><p>${c[2]}</p><span class="chapter-meta">${c[1]} verses</span></div><div class="chev">→</div></button><div class="verse-list"></div></article>`).join('')}
function openChapter(n){currentChapter=n;currentPage=1;document.querySelectorAll('.chapter-item').forEach(x=>x.classList.remove('open'));const el=document.getElementById(`ch-${n}`);el.classList.add('open');renderVersePage(n,el.querySelector('.verse-list'));el.scrollIntoView({behavior:'smooth',block:'start'})}
function renderVersePage(ch,container){const c=chapters[ch-1],start=(currentPage-1)*PAGE_SIZE+1,end=Math.min(start+PAGE_SIZE-1,c[1]);container.innerHTML=`<div class="chapter-open-title">Select a verse</div><div class="verse-page">${Array.from({length:end-start+1},(_,k)=>{const v=start+k;return `<button class="vrow" onclick="openVerse(${ch},${v})"><span class="vbadge">${v}</span><span>Verse ${v}</span></button>`}).join('')}</div><div class="chapter-tools"><button class="page-btn" ${currentPage===1?'disabled':''} onclick="changeVersePage(${ch},${currentPage-1})">← Previous</button><span class="page-label">${start}–${end} of ${c[1]}</span><button class="page-btn" ${end===c[1]?'disabled':''} onclick="changeVersePage(${ch},${currentPage+1})">Next →</button></div>`}
function changeVersePage(ch,page){if(page<1)return;const c=chapters[ch-1];if((page-1)*PAGE_SIZE>=c[1])return;currentPage=page;const el=document.getElementById(`ch-${ch}`);renderVersePage(ch,el.querySelector('.verse-list'));}
function filterChapters(){const q=document.getElementById('chapterSearch').value.toLowerCase().trim();let count=0;document.querySelectorAll('.chapter-item').forEach((el,i)=>{const match=!q||chapters[i][0].toLowerCase().includes(q)||String(i+1)===q||String(i+1).padStart(2,'0')===q;el.hidden=!match;if(match)count++});document.getElementById('chapterResults').textContent=`${count} chapter${count===1?'':'s'}`;document.getElementById('emptyResults').hidden=count>0}

function showChapterPage(n){currentChapter=n;currentPage=1;const c=chapters[n-1];document.getElementById('chapterKicker').textContent=`CHAPTER ${n}`;document.getElementById('chapterTitle').textContent=c[0];document.getElementById('chapterCount').textContent=`${c[1]} verses · ${c[2]}`;renderChapterPage();showScreen('chapter')}
function renderChapterPage(){document.getElementById('chapterBannerArt').src=chapterArtwork[chapterArtMap[currentChapter-1]];const c=chapters[currentChapter-1],start=(currentPage-1)*PAGE_SIZE+1,end=Math.min(start+PAGE_SIZE-1,c[1]);document.getElementById('verseRange').textContent=`${start}–${end} of ${c[1]}`;document.getElementById('pageStatus').textContent=`${currentPage} / ${Math.ceil(c[1]/PAGE_SIZE)}`;document.getElementById('prevPage').disabled=currentPage===1;document.getElementById('nextPage').disabled=end===c[1];document.getElementById('chapterVerseGrid').innerHTML=Array.from({length:end-start+1},(_,k)=>{const v=start+k;return `<button class="verse-link" onclick="openVerse(${currentChapter},${v})"><strong>Verse ${v}</strong><span aria-hidden="true">↗</span></button>`}).join('')}
function chapterPrev(){if(currentPage>1){currentPage--;renderChapterPage()}}
function chapterNext(){const c=chapters[currentChapter-1];if(currentPage*PAGE_SIZE<c[1]){currentPage++;renderChapterPage()}}
function fillPrompt(t){document.getElementById('askInput').value=t;document.getElementById('askInput').focus()}
let timer;function toast(t){const e=document.getElementById('toast');e.textContent=t;e.classList.add('show');clearTimeout(timer);timer=setTimeout(()=>e.classList.remove('show'),1800)}
renderChapters();document.querySelectorAll('[data-chapter-art]').forEach(img=>img.src=chapterArtwork[Number(img.dataset.chapterArt)]);

    function hasLifetimeAccess(){
      return !!(
        authSession?.access_token &&
        accountProfile?.access_active === true
      );
    }
    async function api(path){
      if(!hasLifetimeAccess()) throw new Error('Annual Access required');
      const r=await fetch(SUPA+'/rest/v1/'+path,{
        headers:{apikey:KEY,Authorization:'Bearer '+authSession.access_token}
      });
      if(!r.ok) throw new Error(await r.text());
      return r.json();
    }
    function cleanTranslation(t=''){
      return t.replace(/^\d+\.\d+\.?\s*/,'').trim();
    }
    function authHeaders(token){
      return {apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'};
    }
    function saveSession(session){
      if(!session || session.user?.id!==authSession?.user?.id)clearChatConversation();
      authSession=session||null;
      if(session){localStorage.setItem('gitaAuthSession',JSON.stringify(session));setMetaUser(session.user);attributeSignup();}
      else localStorage.removeItem('gitaAuthSession');
      restoreLanguagePreferences();
      updateAccountUI();
    }
    // A Google sign-in creates the account on first use, so count it as a
    // registration when the user was created in the last few minutes.
    function trackGoogleRegistration(user){return trackNewAccount(user,'google')}
    // Counts a sign-in as a registration when the account was created in the
    // last few minutes (Google and phone create the account on first use).
    function trackNewAccount(user,method){
      const created=Date.parse(user?.created_at||'');
      if(!user?.id||!created||Date.now()-created>10*60*1000)return false;
      const key='gitaMetaRegistration:'+user.id;
      try{if(localStorage.getItem(key))return false}catch(e){}
      logEvent('signup');
      if(trackMeta('CompleteRegistration',{content_name:'Gita Verse account',status:true,registration_method:method},false,'gita_reg_'+user.id)){
        try{localStorage.setItem(key,'1')}catch(e){}
      }
      return true;
    }
    // A visitor who types a question before signing up gets it answered right
    // after sign-up (their one free question). Kept for an hour so a Google
    // round-trip, which reloads the page, doesn't lose it.
    const PENDING_QUESTION_KEY='gitaPendingQuestion';
    function savePendingQuestion(q){try{localStorage.setItem(PENDING_QUESTION_KEY,JSON.stringify({q,at:Date.now()}))}catch(e){}}
    function takePendingQuestion(){
      let p=null;try{p=JSON.parse(localStorage.getItem(PENDING_QUESTION_KEY)||'null');localStorage.removeItem(PENDING_QUESTION_KEY)}catch(e){}
      return p&&typeof p.q==='string'&&Date.now()-p.at<3600000?p.q:'';
    }
    function afterSignIn(){
      const q=takePendingQuestion();
      if(q&&(hasLifetimeAccess()||accountProfile?.free_question_available)){
        showScreen('ask');$('askInput').value=q;sendAsk();return true;
      }
      showScreen('accountScreen');return false;
    }
    async function consumeOAuthHash(){
      const hash=new URLSearchParams(location.hash.replace(/^#/,''));
      const access=hash.get('access_token');
      const refresh=hash.get('refresh_token');
      if(!access||!refresh)return false;

      const userRes=await fetch(SUPA+'/auth/v1/user',{headers:authHeaders(access)});
      if(!userRes.ok)return false;
      const user=await userRes.json();

      saveSession({
        access_token:access,
        refresh_token:refresh,
        token_type:hash.get('token_type')||'bearer',
        expires_in:Number(hash.get('expires_in')||3600),
        user
      });

      history.replaceState({},document.title,location.pathname+location.search);
      await loadAccountProfile();
      trackMeta('Login',{method:'google'},true);logEvent('login');
      trackGoogleRegistration(user);
      afterSignIn();
      toast('Signed in with Google');
      return true;
    }
    async function handlePaymentReturn(){
      const params=new URLSearchParams(location.search);
      if(params.get('payment')!=='success' || !authSession?.access_token) return false;

      toast('Confirming your payment…');

      for(let i=0;i<8;i++){
        await loadAccountProfile();
        if(hasLifetimeAccess()){
          trackConfirmedPurchase();

          history.replaceState({},document.title,location.pathname);
          renderAccessState();
          showScreen('accountScreen',true);
          toast('Annual Access unlocked ✓');
          return true;
        }
        await new Promise(r=>setTimeout(r,1200));
      }

      toast('Payment is not confirmed yet. If you paid, wait a moment and refresh to check your access.');
      return false;
    }
    async function refreshAuthSession(){
      let stored=null;
      try{stored=JSON.parse(localStorage.getItem('gitaAuthSession')||'null')}catch(e){}
      if(!stored?.refresh_token){saveSession(null);return null}
      try{
        const r=await fetch(SUPA+'/auth/v1/token?grant_type=refresh_token',{
          method:'POST',
          headers:{apikey:KEY,'Content-Type':'application/json'},
          body:JSON.stringify({refresh_token:stored.refresh_token})
        });
        if(!r.ok) throw new Error('Session expired');
        const session=await r.json();
        saveSession(session);
        await loadAccountProfile();
        return session;
      }catch(e){
        saveSession(null);
        return null;
      }
    }
    async function loadAccountProfile(){
      if(!authSession?.access_token){
        accountProfile=null;
        updateAccountUI();
        return null;
      }
      try{
        const r=await fetch(SUPA+'/functions/v1/get-my-access',{
          method:'GET',
          headers:{
            apikey:KEY,
            Authorization:'Bearer '+authSession.access_token
          }
        });
        const data=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(data.error||'Could not load account access');
        accountProfile=data;
      }catch(e){
        accountProfile=null;
        console.error('loadAccountProfile failed',e);
      }
      updateAccountUI();
      return accountProfile;
    }
    function userDisplayName(){
      const u=authSession?.user||{};
      const meta=u.user_metadata||{};
      const full=(meta.full_name||meta.name||meta.user_name||'').trim();
      if(full) return full.split(' ')[0];

      const email=(
        u.email||
        accountProfile?.auth_email||
        accountProfile?.email||
        ''
      ).trim();

      if(!email) return '';

      const local=email.split('@')[0]
        .replace(/[._-]+/g,' ')
        .replace(/\d{3,}$/,'')
        .trim();

      if(!local) return email.split('@')[0];

      return local
        .split(' ')
        .filter(Boolean)
        .map(x=>x.charAt(0).toUpperCase()+x.slice(1))
        .join(' ');
    }
    function openAccount(){
      if(authSession?.access_token) showScreen('accountScreen');
      else showScreen('authScreen');
    }
    // Instagram/Facebook in-app browsers: Google blocks OAuth inside embedded
    // webviews, so these visitors get email sign-up first and a way out to a
    // real browser for Google.
    const UA=navigator.userAgent||'';
    const IN_APP_NAME=metaInAppName(UA)||(/Android/i.test(UA)&&/; wv\)/.test(UA)?'this app':'');
    const IS_ANDROID=/Android/i.test(UA);
    function chromeIntentUrl(){
      const path=(location.pathname||'/').replace(/^\//,'');
      const q='?from=inapp&vid='+encodeURIComponent(VISITOR_ID);
      return 'intent://'+location.host+'/'+path+q+'#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url='+encodeURIComponent(location.origin+'/'+path+q)+';end';
    }
    function openInChrome(){
      trackMeta('OpenInBrowser',{app:IN_APP_NAME||'unknown'},true);logEvent('open_in_browser',{keepalive:true});
      location.href=chromeIntentUrl();
    }
    function setupInAppAuth(){
      if(!IN_APP_NAME)return;
      const card=document.querySelector('.auth-page-card');
      card.classList.add('in-app');
      $('inAppNote').hidden=false;
      $('inAppTitle').textContent=IN_APP_NAME==='this app'?"You're in an in-app browser":"You're in "+IN_APP_NAME+"'s browser";
      if(IS_ANDROID)$('openInChrome').hidden=false; else $('iosTip').hidden=false;
      // Email first: move Google and the divider below the email forms.
      const anchor=$('authPageError');
      card.insertBefore($('authDividerText').parentElement,anchor);
      card.insertBefore($('googleLogin'),anchor);
      $('openInChrome').onclick=openInChrome;
    }
    async function startGoogleLogin(){
      logEvent('google_click');
      if(IN_APP_NAME){
        trackMeta('GoogleBlockedInApp',{app:IN_APP_NAME},true);logEvent('google_blocked_in_app');
        if(IS_ANDROID){openInChrome();return}
        $('authPageError').style.color='#7a3b18';
        $('authPageError').textContent='Google sign-in doesn\'t work inside '+IN_APP_NAME+'. Use your mobile number above, or tap ••• → Open in external browser.';
        $('iosTip').hidden=false;
        return;
      }
      const redirectTo=location.origin+location.pathname;
      const url=SUPA+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirectTo);
      location.href=url;
    }
    function setAuthPageMode(mode){
      authPageMode=mode;
      const signup=mode==='signup';

      $('loginTab').classList.toggle('active',!signup);
      $('signupTab').classList.toggle('active',signup);
      $('authModeTitle').textContent=signup?'Sign up':'Login';
      $('googleButtonText').textContent=signup?'Sign up with Google':'Continue with Google';
      $('authModeLead').textContent=signup
        ? 'Create a new Gita Verse account.'
        : 'Welcome back. Sign in to your existing account.';
      $('authDividerText').textContent=IN_APP_NAME?'or use Google':(signup?'or create an account with email':'or login with email');

      $('passwordLoginStep').classList.toggle('hidden',signup);
      $('passwordSignupStep').classList.toggle('hidden',!signup);
      $('authPageError').textContent='';
    }
    async function signUpWithPassword(){
      $('authPageError').textContent='';logEvent('signin_start');
      const email=$('signupEmail').value.trim();
      const password=$('signupPassword').value;

      if(!/^\S+@\S+\.\S+$/.test(email)){
        $('authPageError').textContent='Enter a valid email address';
        return;
      }
      if(password.length<6){
        $('authPageError').textContent='Password must be at least 6 characters';
        return;
      }

      const btn=$('passwordSignupBtn');
      try{
        btn.disabled=true;btn.textContent='Creating account…';
        const r=await fetch(SUPA+'/auth/v1/signup',{
          method:'POST',
          headers:{apikey:KEY,'Content-Type':'application/json'},
          body:JSON.stringify({email,password})
        });
        const data=await r.json();
        if(!r.ok) throw new Error(data.msg||data.error_description||data.message||'Could not create account');

        if(data.access_token){
          saveSession(data);
          await loadAccountProfile();
          trackMeta('CompleteRegistration',{content_name:'Gita Verse account',status:true,registration_method:'email'});
          logEvent('signup');
          toast('Account created');
          afterSignIn();
        }else{
          trackMeta('RegistrationSubmitted',{registration_method:'email'},true);
          $('authPageError').style.color='#2f7d32';
          $('authPageError').textContent='Account created. Check your email to confirm, then log in.';
          setAuthPageMode('login');
        }
      }catch(e){
        $('authPageError').style.color='#b53a20';
        $('authPageError').textContent=e.message||'Could not create account';
      }finally{
        btn.disabled=false;btn.textContent='Sign up';
      }
    }
    async function signInWithPassword(event){
      if(event?.preventDefault) event.preventDefault();logEvent('signin_start');
      $('authPageError').textContent='';
      const email=$('passwordEmail').value.trim();
      const password=$('passwordPassword').value;

      if(!/^\S+@\S+\.\S+$/.test(email)){
        $('authPageError').textContent='Enter a valid email address';
        return;
      }
      if(!password){
        $('authPageError').textContent='Enter your password';
        return;
      }

      const btn=$('passwordLoginBtn');
      try{
        btn.disabled=true;btn.textContent='Signing in…';
        const r=await fetch(SUPA+'/auth/v1/token?grant_type=password',{
          method:'POST',
          headers:{apikey:KEY,'Content-Type':'application/json'},
          body:JSON.stringify({email,password})
        });
        const data=await r.json().catch(()=>({}));
        if(!r.ok) throw new Error(
          data.msg||data.error_description||data.message||('Login failed ('+r.status+')')
        );

        saveSession(data);
        await loadAccountProfile();
        trackMeta('Login',{method:'email'},true);logEvent('login');
        toast('Signed in');
        afterSignIn();
      }catch(e){
        $('authPageError').textContent=e.message||'Could not sign in';
      }finally{
        btn.disabled=false;btn.textContent='Login';
      }
    }
    // Mobile number + OTP sign-in (Indian numbers). Supabase creates the account
    // on first use; the SMS is sent through MSG91 by the send-sms auth hook.
    let otpPhone='',resendTimer=null;
    function indianMobile(v){
      const d=String(v||'').replace(/\D/g,'').replace(/^(?:91|0)(?=\d{10}$)/,'');
      return /^[6-9]\d{9}$/.test(d)?d:'';
    }
    function authError(msg,ok){$('authPageError').style.color=ok?'#2f7d32':'#b53a20';$('authPageError').textContent=msg||'';}
    function startResendTimer(seconds=30){
      clearInterval(resendTimer);let left=seconds;const b=$('resendOtp');b.disabled=true;
      const tick=()=>{if(left<=0){clearInterval(resendTimer);b.disabled=false;b.textContent='Resend OTP';return}b.textContent='Resend OTP in '+left--+'s';};
      tick();resendTimer=setInterval(tick,1000);
    }
    async function sendOtp(){
      authError('');
      const d=indianMobile($('phoneNumber').value);
      if(!d){authError('Enter a valid 10-digit mobile number');$('phoneNumber').focus();return}
      logEvent('signin_start');
      const btn=$('sendOtpBtn');btn.disabled=true;btn.textContent='Sending OTP…';
      try{
        const r=await fetch(SUPA+'/auth/v1/otp',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({phone:'+91'+d,create_user:true})});
        const data=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(r.status===429?'Too many OTP requests. Please wait a minute and try again.':(data.msg||data.error_description||data.message||'Could not send OTP. Please try again.'));
        otpPhone='+91'+d;$('otpPhone').textContent='+91 '+d.slice(0,5)+' '+d.slice(5);
        $('otpStep').hidden=false;btn.hidden=true;$('phoneNumber').disabled=true;
        $('otpCode').value='';$('otpCode').focus();startResendTimer();
        authError('OTP sent. It may take a few seconds to arrive.',true);
      }catch(e){authError(e.message)}
      finally{btn.disabled=false;btn.textContent='Get OTP';}
    }
    function changePhone(){
      clearInterval(resendTimer);otpPhone='';$('otpStep').hidden=true;$('sendOtpBtn').hidden=false;
      $('phoneNumber').disabled=false;$('phoneNumber').focus();authError('');
    }
    async function verifyOtp(){
      authError('');
      const code=$('otpCode').value.replace(/\D/g,'');
      if(code.length!==6){authError('Enter the 6-digit OTP');$('otpCode').focus();return}
      const btn=$('verifyOtpBtn');btn.disabled=true;btn.textContent='Verifying…';
      try{
        const r=await fetch(SUPA+'/auth/v1/verify',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({type:'sms',phone:otpPhone,token:code})});
        const data=await r.json().catch(()=>({}));
        if(!r.ok||!data.access_token)throw new Error(r.status===429?'Too many attempts. Please wait a minute.':'That OTP is wrong or has expired. Check it or tap Resend OTP.');
        clearInterval(resendTimer);
        saveSession(data);
        await loadAccountProfile();
        const isNew=trackNewAccount(data.user,'phone');
        trackMeta('Login',{method:'phone'},true);logEvent('login');
        toast(isNew?'Account created':'Signed in');
        changePhone();$('phoneNumber').value='';
        afterSignIn();
      }catch(e){authError(e.message)}
      finally{btn.disabled=false;btn.textContent='Verify & continue';}
    }
    async function signOut(){
      const token=authSession?.access_token;
      accountProfile=null;saveSession(null);showScreen('home');toast('Signed out');
      try{
        if(token){
          await fetch(SUPA+'/auth/v1/logout',{method:'POST',headers:authHeaders(token)});
        }
      }catch(e){}
    }
    async function startLifetimePurchase(){
      trackMeta('CheckoutClick',annualEvent,true);logEvent('checkout_click',{keepalive:true});
      if(!authSession?.access_token){
        showScreen('authScreen');
        $('authPageError').textContent='Sign up or log in first so your annual purchase can be linked to your account.';
        return;
      }

      if(hasLifetimeAccess()){
        toast('Annual Access is already active');
        return;
      }

      const buttons=[$('buyLifetime'),$('accountUpgrade')].filter(Boolean);
      buttons.forEach(b=>{b.disabled=true;b.dataset.label=b.textContent;b.textContent='Preparing secure payment…'});

      try{
        const r=await fetch(SUPA+'/functions/v1/create-payment-link',{
          method:'POST',
          headers:{
            apikey:KEY,
            Authorization:'Bearer '+authSession.access_token,
            'Content-Type':'application/json'
          },
          body:JSON.stringify({})
        });

        const d=await r.json();
        if(!r.ok) throw new Error(d.error||d.details?.error?.description||'Could not create payment link');

        if(d.already_paid){
          await loadAccountProfile();
          toast('Annual Access is already active');
          showScreen('accountScreen');
          return;
        }

        if(!d.short_url) throw new Error('Payment link was not returned');

        trackMeta('InitiateCheckout',annualEvent);

        window.location.href=d.short_url;
      }catch(e){
        trackMeta('CheckoutError',{stage:'create_payment_link'},true);
        toast(e.message||'Could not start payment');
      }finally{
        buttons.forEach(b=>{b.disabled=false;b.textContent=b.dataset.label||'Get Annual Access →'});
      }
    }
    function themeOf(v){
      const t=(v.translation_english||'').toLowerCase();
      if(/action|work|duty|fruit|result/.test(t))return 'action';
      if(/mind|sense|desire|anger/.test(t))return 'mind';
      if(/soul|self|death|born|eternal/.test(t))return 'self';
      if(/devotion|worship|love|faith/.test(t))return 'devotion';
      if(/knowledge|wisdom|ignorance/.test(t))return 'wisdom';
      return 'balance';
    }
    // Verse texts are built from these fixed pieces plus each verse's meaning.
    // Translations are stored per piece (text_translations), and
    // tools/translation_sources.mjs reads these constants to seed them.
    const CHAPTER_LENS={
        1:'This chapter places us inside Arjuna’s moral and emotional crisis. Its deeper question is not merely what happens on the battlefield, but what happens when duty, attachment, fear, and identity collide.',
        2:'This chapter establishes the Gita’s central foundations: the enduring Self, disciplined action, equanimity, and wisdom that is not shaken by changing circumstances.',
        3:'This chapter develops Karma Yoga — acting fully in the world without becoming psychologically owned by the fruits of action.',
        4:'This chapter connects right action with knowledge, showing how understanding transforms the inner quality of what we do.',
        5:'This chapter explores renunciation as an inner freedom from possessiveness and ego, rather than simply abandoning action.',
        6:'This chapter focuses on meditation, self-mastery, and the disciplined relationship between the mind and the deeper Self.',
        7:'This chapter moves from self-discipline toward knowledge of the divine source underlying the visible world.',
        8:'This chapter examines remembrance, mortality, and the orientation of consciousness at the deepest moments of life.',
        9:'This chapter presents devotion and divine presence as intimate, accessible, and available within ordinary life.',
        10:'This chapter reveals the divine through excellence, beauty, power, order, and extraordinary expressions found throughout creation.',
        11:'This chapter confronts Arjuna with the cosmic form, expanding his perspective beyond the limits of an individual human viewpoint.',
        12:'This chapter explores Bhakti Yoga and the qualities of a person whose devotion has matured into steadiness, compassion, and freedom from ego.',
        13:'This chapter distinguishes the field of experience — body and mind — from the knower who is aware of that field.',
        14:'This chapter explains the three gunas — sattva, rajas, and tamas — as forces shaping thought, behaviour, attachment, and perception.',
        15:'This chapter uses the image of the cosmic tree to examine attachment, impermanence, and the search for the ultimate source.',
        16:'This chapter contrasts qualities that lead toward inner freedom with those that deepen confusion, ego, and bondage.',
        17:'This chapter shows how faith takes different forms according to a person’s nature and influences worship, discipline, food, and conduct.',
        18:'This final chapter integrates the paths of action, knowledge, devotion, renunciation, and surrender into a unified teaching.'
      };
    const CHAPTER_LENS_DEFAULT='This verse belongs to the Gita’s wider inquiry into right action, clear understanding, and inner freedom.';
    const DEEP_RULES=[
      [/dhritarashtra|sanjaya|army|battle|warrior|pandava|duryodhana|drona|kurukshetra/,'The verse is first of all doing narrative work: it locates people, motives, loyalties, and tensions. Its deeper value comes from noticing the psychological state behind the action — who is attached, who is afraid, who is calculating, and who is trying to see clearly.'],
      [/fruit|fruits|result|results|action|work|duty|perform/,'The key distinction here is between action and ownership of the outcome. Krishna does not argue for passivity; he asks for complete participation without making one’s peace, identity, or integrity dependent on success or failure.'],
      [/soul|self|born|death|dies|eternal|body|slain/,'This verse separates the changing body and personality from the deeper Self. The practical implication is not indifference to life, but a shift in identity: what is most essential in a person is not exhausted by physical change, status, gain, or loss.'],
      [/mind|sense|senses|desire|anger|lust|attachment/,'The verse describes an inner chain of causation. Attention becomes attachment, attachment can become craving, and unchecked craving can distort judgment. The teaching is therefore about intervening early — at the level of attention and identification — rather than only fighting the final emotion.'],
      [/yoga|meditat|concentrat|steady|still|discipline/,'Here yoga means trained steadiness rather than escape. The verse points to a mind that can remain present without being dragged around by every impulse, memory, fear, or reward. That steadiness is what makes clear action possible.'],
      [/devot|worship|love|faith|offer|surrender/,'The deeper movement here is from ego-centred action toward offering. Devotion in the Gita is not merely emotion; it changes the centre from which one acts, reducing the need to control, possess, and constantly prove oneself.'],
      [/knowledge|wisdom|know|ignorance|understand/,'The verse treats knowledge as a transformation in perception, not just information. To know truly is to see relationships, causes, and identity differently enough that one’s actions also change.'],
      [/equal|pleasure|pain|gain|loss|victory|defeat/,'The teaching here is equanimity: not flattening emotion, but refusing to let opposite experiences dictate one’s inner direction. Pleasure and pain still occur; the freedom lies in not becoming completely governed by either.'],
      [/nature|guna|sattva|rajas|tamas/,'This verse asks us to notice how behaviour is shaped by underlying tendencies. Instead of reducing everything to “my personality,” the Gita invites observation of the forces moving through the mind — clarity, restlessness, and inertia — so they can be understood rather than blindly obeyed.'],
      [/supreme|divine|lord|god|brahman|creator|creation/,'The verse widens the frame from the individual ego to a larger order. Its deeper point is that the sacred is not presented as separate from existence, but as the source, support, or intelligence through which existence becomes intelligible.']
    ];
    const DEEP_FALLBACK='Read literally first: the verse is making a precise claim about a human situation. Its deeper meaning emerges by asking what assumption about identity, control, fear, or responsibility the verse is challenging in that situation.';
    const DEEP_LABEL='Verse meaning:';
    const APPLY_TODAY={
        action:'Choose one important task today. Give it your best attention for 30 minutes without checking whether it is “working” yet. Measure yourself by the quality of your effort, not the immediate result.',
        mind:'Before your next emotional reaction, create a 10-second gap. Name what you are feeling, breathe once slowly, and then choose your response instead of letting the impulse choose for you.',
        self:'Notice one identity you are clinging to today — job title, approval, success, failure, appearance. Ask: “If this changed, what in me would still remain?”',
        devotion:'Take one ordinary action — a meal, a task, a conversation — and do it as an offering rather than as a transaction. Focus on sincerity instead of reward.',
        wisdom:'When you face a decision today, write two columns: what is temporary and what is principled. Let the principled side influence the next action.',
        balance:'When something goes unusually well or badly today, delay your conclusion about what it “means.” Return to the next right action before judging the whole situation.'
      };
    const REFLECTIONS={
        action:'Reflection: What action is mine to do, even if the outcome is uncertain?',
        mind:'Reflection: What emotion is currently asking to make a decision for me?',
        self:'Reflection: What part of me remains steady when circumstances change?',
        devotion:'Reflection: What would change if I treated this action as an offering?',
        wisdom:'Reflection: What am I seeing clearly, and what am I assuming?',
        balance:'Reflection: Can I stay steady long enough to choose rather than react?'
      };
    const TAB_REFLECTION={meaning:'Read slowly. Notice which phrase creates the strongest reaction in you.',today:'Keep the practice small enough that you can actually do it today.'};
    function deepParts(v){
      const base=cleanTranslation(v.translation_english||'').trim(),t=base.toLowerCase();
      const specific=(DEEP_RULES.find(([rx])=>rx.test(t))||[,DEEP_FALLBACK])[1];
      return {specific,lens:CHAPTER_LENS[Number(v.chapter_id||0)]||CHAPTER_LENS_DEFAULT,base};
    }
    function deepMeaning(v){
      const d=deepParts(v);
      return d.specific+'\n\n'+d.lens+'\n\n'+DEEP_LABEL+' '+d.base;
    }
    function applyToday(v){return APPLY_TODAY[themeOf(v)];}
    function reflectionFor(v){return REFLECTIONS[themeOf(v)];}
    async function fetchTTS(text,kind,verse,language=meaningLanguage){
      const r=await fetch(SUPA+'/functions/v1/tts-krishna',{
        method:'POST',
        headers:authHeaders(authSession?.access_token||''),
        cache:'no-store',
        body:JSON.stringify({
          text,
          kind,
          language,
          translated:kind!=='verse',
          chapter_id:verse?.chapter_id,
          verse_number:verse?.verse_number
        })
      });
      if(!r.ok){
        let msg='Voice generation failed';
        try{const j=await r.json();msg=j.error||msg}catch(e){}
        throw new Error(msg);
      }
      return r.blob();
    }
    function spokenExplanation(v){
      return cleanTranslation(v.translation_english||'')
        .replace(/[“”"]/g,'')
        .trim();
    }

function showScreen(id){
  const next=$(id);if(!next)return;
  if(!next.classList.contains('active'))trackMeta('ScreenView',{screen_name:id},true);
  if(id!=='detail')stopSpeech();
  document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));
  document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));
  const nav=id==='home'?'homeNav':id==='ask'?'askNav':['explore','chapter','detail'].includes(id)?'exploreNav':null;
  if(nav)$(nav).classList.add('active');
  $('offer').style.display=id==='home'&&!hasLifetimeAccess()?'flex':'none';
  window.scrollTo({top:0,behavior:'instant'});
}
function openFreeQuestionSignup(){
  showScreen('authScreen');setAuthPageMode('signup');
  $('authModeLead').textContent='Create a free account to get Krishna\'s answer to your question.';
}
function showPaywall(message='Sign in and get Annual Access to continue.'){
  logEvent('paywall_view');
  openAccount();toast(authSession?.access_token?'Get Annual Access to unlock all verses and guidance.':message);
}
function renderAccessState(){
  $('offer').style.display=$('home').classList.contains('active')&&!hasLifetimeAccess()?'flex':'none';
  const freeLeft=!hasLifetimeAccess()&&(!authSession?.access_token||accountProfile?.free_question_available);
  $('chatHint').textContent=freeLeft?'Your first question is free · Grounded in the Gita':'Grounded in the Gita · practical for life today';
  $('heroFreeNote').hidden=!freeLeft;
  // Until the free question is used, the bottom bar invites people to try it;
  // afterwards it offers Annual Access.
  const offer=freeLeft
    ?['🙏','TRY IT FREE','Ask Krishna your first question','Free with a quick sign-up · no payment','Ask free →']
    :['♕','SPECIAL 1-YEAR ACCESS','₹1,000 for 1 year','Full Gita Verse access · no monthly subscription','Get access →'];
  ['offerIcon','offerKicker','offerTitle','offerText','buyLifetime'].forEach((id,i)=>{if(!$(id).disabled)$(id).textContent=offer[i]});
  $('offer').dataset.mode=freeLeft?'free':'buy';
}
function openAskKrishna(){showScreen('ask');setTimeout(()=>$('askInput').focus({preventScroll:true}),150);}
function offerAction(){$('offer').dataset.mode==='free'?openAskKrishna():startLifetimePurchase();}
function updateAccountUI(){
  const logged=!!authSession?.access_token,paid=hasLifetimeAccess();
  $('welcomeUser').textContent=logged?'Welcome, '+(userDisplayName()||'friend')+' 🙏':'Sign in 🙏';
  const phone=authSession?.user?.phone;
  $('accountEmail').textContent=authSession?.user?.email||(phone?'+'+String(phone).replace(/^\+/,''):'—');
  $('accountProvider').textContent={phone:'Mobile',google:'Google',email:'Email'}[authSession?.user?.app_metadata?.provider]||'Email';
  $('accountPlan').textContent=paid?'Annual':'Free';
  $('accountPayment').textContent=accountProfile?.payment_status||'Unpaid';
  for(const [id,key] of [['accountPurchased','purchased_at'],['accountExpires','access_expires_at']]){
    $(id).textContent=accountProfile?.[key]?new Date(accountProfile[key]).toLocaleDateString():'—';
  }
  $('accountUpgrade').style.display=paid?'none':'block';
  $('accountAccessActive').style.display=paid?'block':'none';
  renderAccessState();
}
// Verse of the day on the home card (get_daily_verse changes it at midnight IST).
async function loadDailyVerse(){
  try{
    const r=await fetch(SUPA+'/rest/v1/rpc/get_daily_verse',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:'{}'});
    if(!r.ok)return;const [v]=await r.json();if(!v)return;
    const ch=Number(v.chapter_id),n=Number(v.verse_number);
    const line=(v.sanskrit||'').replace(/^\s*(?:(?:धृतराष्ट्र|सञ्जय|संजय|अर्जुन)\s+उवाच|श्रीभगवानुवाच)\s*[।॥|]*\s*/,'').split('\n')[0].replace(/\s*\|+\s*$/,'\u00a0।').trim();
    const meaning=cleanTranslation(v.translation_english||'');
    $('dailyTag').textContent="TODAY'S WISDOM · "+ch+'.'+n;
    if(line)$('dailySanskrit').textContent=line;
    $('dailyMeaning').textContent=meaning.length>150?meaning.slice(0,meaning.lastIndexOf(' ',147))+'…':meaning;
    $('dailyRead').onclick=()=>openVerse(ch,n);
  }catch(e){}
}
async function openVerse(ch,v){
  if(!hasLifetimeAccess()){showPaywall();return}
  const request=++verseRequest;currentChapter=Number(ch);currentPage=Math.ceil(v/PAGE_SIZE);
  renderChapterPage();
  $('chapterKicker').textContent='CHAPTER '+ch;
  $('chapterTitle').textContent=chapters[ch-1][0];
  $('chapterCount').textContent=chapters[ch-1][1]+' verses · '+chapters[ch-1][2];
  showScreen('detail');stopSpeech();selectedVerse=null;
  $('detailKicker').textContent='BHAGAVAD GITA '+ch+'.'+v;
  document.querySelector('#detail h1').textContent='';
  $('detailSanskrit').textContent='Loading verse…';$('detailTranslit').textContent='';
  $('detailMeaning').textContent='';$('audioBtn').disabled=true;$('saveVerse').disabled=true;
  try{
    let rows=verseCache.get(Number(ch));
    if(!rows){rows=await api('gita_verses?select=*&chapter_id=eq.'+Number(ch)+'&order=verse_number.asc');verseCache.set(Number(ch),rows)}
    if(request!==verseRequest)return;
    const verse=rows.find(x=>Number(x.verse_number)===Number(v));
    if(!verse)throw new Error('This verse is unavailable. Please choose another verse.');
    selectedVerse=verse;currentTab='meaning';
    trackMeta('ViewContent',{content_name:'Bhagavad Gita verse',content_category:'verse',content_ids:['gita_'+Number(ch)+'_'+Number(v)]});
    const text=verse.sanskrit||'';
    const speaker=text.match(/^\s*((?:धृतराष्ट्र|सञ्जय|संजय|अर्जुन)\s+उवाच\s*[।॥]?|श्रीभगवानुवाच\s*[।॥]?)/);
    document.querySelector('#detail h1').textContent=speaker?speaker[1]:'';
    $('detailSanskrit').textContent=speaker?text.slice(speaker[0].length).trim():text;
    $('detailTranslit').textContent=verse.transliteration||'';
    $('audioBtn').disabled=false;$('saveVerse').disabled=false;
    $('saveVerse').textContent=saved.has(verse.id)?'★ Saved':'☆ Save';
    $('prevVerse').disabled=Number(v)<=1;
    $('nextVerse').disabled=Number(v)>=chapters[ch-1][1];
    renderTab('meaning');
  }catch(e){if(request===verseRequest){$('detailSanskrit').textContent='Could not load this verse.';$('detailMeaning').textContent=e.message;}}
}
// Chat defaults to 'auto': Krishna replies in the language the user writes in.
// Meanings default to 'en-hi': English text shown instantly, narrated in Hindi
// (translated only when Listen is pressed), as before languages were added.
let chatLanguage='auto',meaningLanguage='en-hi',translationGeneration=0;
const translationCache=new Map();
let meaningReady=Promise.resolve(null),narrationGeneration=0,audioButton=null,cancelPlayback=null;
function languageKey(){return 'gitaLanguages:'+ (authSession?.user?.id||'guest');}
function restoreLanguagePreferences(){
  let saved={};try{saved=JSON.parse(localStorage.getItem(languageKey())||'{}')}catch(e){}
  chatLanguage=saved.chat==='auto'||Object.hasOwn(GITA_LANGUAGES,saved.chat)?saved.chat:'auto';
  meaningLanguage=saved.meaning==='en-hi'||Object.hasOwn(GITA_LANGUAGES,saved.meaning)?saved.meaning:'en-hi';
  $('chatLanguage').value=chatLanguage;$('meaningLanguage').value=meaningLanguage;
  if($('appLanguage').options?.length)syncAppLanguage();
  preloadTranslations();
}
function saveLanguages(){
  try{localStorage.setItem(languageKey(),JSON.stringify({chat:chatLanguage,meaning:meaningLanguage}))}catch(e){}
  syncAppLanguage();preloadTranslations();
}
// The header 🌐 picker shows one app-wide language; 'custom' when the chat
// and meaning screens were set to different languages.
function syncAppLanguage(){
  $('appLanguage').value=chatLanguage==='auto'&&meaningLanguage==='en-hi'?'default':chatLanguage===meaningLanguage?chatLanguage:'custom';
}
function toggleLanguageMenu(open=$('langMenu').hidden){
  $('langMenu').hidden=!open;$('langButton').setAttribute('aria-expanded',String(open));
  if(open)$('appLanguage').focus();
}
function setupLanguages(){
  const extra=(id,value,label,hidden)=>{const o=document.createElement('option');o.value=value;o.textContent=label;if(hidden)o.hidden=true;$(id).appendChild(o);};
  extra('chatLanguage','auto','Auto · same as your message');extra('meaningLanguage','en-hi','English text · Hindi audio');
  extra('appLanguage','default','Default');extra('appLanguage','custom','Custom (set on each screen)',true);
  for(const id of ['chatLanguage','meaningLanguage','appLanguage']){
    for(const [code,name] of Object.entries(GITA_LANGUAGES)){
      const option=document.createElement('option');option.value=code;option.textContent=name;$(id).appendChild(option);
    }
  }
  for(const id of ['chatLanguage','meaningLanguage']){
    $(id).onchange=()=>{
      stopSpeech();chatLanguage=$('chatLanguage').value;meaningLanguage=$('meaningLanguage').value;saveLanguages();
      if(id==='meaningLanguage'&&selectedVerse)renderTab(currentTab);
    };
  }
  $('appLanguage').onchange=()=>{
    const v=$('appLanguage').value;if(v==='custom')return;
    stopSpeech();
    [chatLanguage,meaningLanguage]=v==='default'?['auto','en-hi']:[v,v];
    $('chatLanguage').value=chatLanguage;$('meaningLanguage').value=meaningLanguage;saveLanguages();
    if(selectedVerse)renderTab(currentTab);
    toggleLanguageMenu(false);toast(v==='default'?'Language: default':'Language: '+GITA_LANGUAGES[v].split(' · ')[0]);
  };
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('langMenu').hidden){toggleLanguageMenu(false);$('langButton').focus();}});
  restoreLanguagePreferences();
}
// Voice language for an 'auto' chat reply, from the script it was written in.
function detectLanguage(text){
  const scripts=[[/[\u0900-\u097F]/,'hi'],[/[\u0980-\u09FF]/,'bn'],[/[\u0A00-\u0A7F]/,'pa'],[/[\u0A80-\u0AFF]/,'gu'],[/[\u0B80-\u0BFF]/,'ta'],[/[\u0C00-\u0C7F]/,'te'],[/[\u0C80-\u0CFF]/,'kn'],[/[\u0D00-\u0D7F]/,'ml'],[/[\u0600-\u06FF]/,'ur']];
  return (scripts.find(([rx])=>rx.test(text))||[,'en'])[1];
}
// Stored translations (text_translations): each language's set is loaded once,
// keyed by the SHA-256 of the English piece, so most text appears instantly.
const storedTranslations=new Map();
async function sha256Hex(text){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function loadStoredTranslations(language){
  if(language==='en'||!authSession?.access_token||!window.crypto?.subtle)return Promise.resolve(new Map());
  if(!storedTranslations.has(language)){
    const load=(async()=>{
      const map=new Map();
      for(let from=0;;from+=1000){
        const r=await fetch(SUPA+'/rest/v1/text_translations?select=source_hash,translated&language=eq.'+encodeURIComponent(language),{headers:{...authHeaders(authSession.access_token),Range:from+'-'+(from+999)}});
        if(!r.ok)throw new Error('Stored translations unavailable');
        const rows=await r.json();rows.forEach(x=>map.set(x.source_hash,x.translated));
        if(rows.length<1000)return map;
      }
    })();
    // A failed load is retried next time instead of being remembered.
    load.catch(()=>storedTranslations.delete(language));
    storedTranslations.set(language,load);
  }
  return storedTranslations.get(language).catch(()=>new Map());
}
function preloadTranslations(){
  const lang=meaningLanguage==='en-hi'?'hi':meaningLanguage;
  if(lang!=='en')loadStoredTranslations(lang);
}
async function translateText(text,language){
  if(language==='en'||!text.trim())return text;
  const key=language+'|'+text;
  if(translationCache.has(key))return translationCache.get(key);
  try{
    const stored=(await loadStoredTranslations(language)).get(await sha256Hex(text));
    if(stored){translationCache.set(key,stored);return stored;}
  }catch(e){}
  const r=await fetch(SUPA+'/functions/v1/tts-krishna',{
    method:'POST',headers:authHeaders(authSession?.access_token||''),signal:AbortSignal.timeout(30000),
    body:JSON.stringify({operation:'translate',text,language,kind:'meaning'})
  });
  const d=await r.json();if(!r.ok||!d.text)throw new Error(d.error||'Translation unavailable. Please retry.');
  if(translationCache.size>=400)translationCache.delete(translationCache.keys().next().value);
  translationCache.set(key,d.text);return d.text;
}
// Translates a tab piece by piece, the same pieces stored in text_translations.
async function translateTab(verse,tab,language){
  const reflection=tab==='deep'?reflectionFor(verse):TAB_REFLECTION[tab==='today'?'today':'meaning'];
  let parts;
  if(tab==='deep'){const d=deepParts(verse);parts=[d.specific,d.lens,DEEP_LABEL,d.base];}
  else parts=[tab==='meaning'?cleanTranslation(verse.translation_english||'Meaning unavailable.'):applyToday(verse)];
  const [out,reflect]=await Promise.all([Promise.all(parts.map(p=>translateText(p,language))),translateText(reflection,language).catch(()=>reflection)]);
  return {text:tab==='deep'?out[0]+'\n\n'+out[1]+'\n\n'+out[2]+' '+out[3]:out[0],reflection:reflect};
}
function renderTab(tab){
  if(!selectedVerse)return;currentTab=tab;stopSpeech();
  const generation=++translationGeneration,verse=selectedVerse,language=meaningLanguage==='en-hi'?'en':meaningLanguage;
  document.querySelectorAll('#meaningTabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  $('panelTitle').textContent={meaning:'MEANING',deep:'DEEP MEANING',today:'APPLY TODAY'}[tab];
  const source=tab==='meaning'?cleanTranslation(verse.translation_english||'Meaning unavailable.'):tab==='deep'?deepMeaning(verse):applyToday(verse);
  const reflection=tab==='deep'?reflectionFor(verse):TAB_REFLECTION[tab==='today'?'today':'meaning'];
  const show=(text,reflect,lang)=>{$('detailMeaning').textContent=text;$('detailMeaning').lang=lang;$('reflection').textContent=reflect;$('reflection').lang=lang;};
  $('detailMeaning').dir='auto';$('reflection').dir='auto';
  $('translationStatus').textContent='';$('retryTranslation').hidden=true;
  // Show English straight away; a translation replaces it when ready.
  show(source,reflection,'en');
  // Stored translations arrive almost instantly; only note a slow one.
  const note=language==='en'?0:setTimeout(()=>{if(generation===translationGeneration)$('translationStatus').textContent='Translating to '+GITA_LANGUAGES[language].split(' · ')[0]+'…';},300);
  // Resolves to the text and language narration should use.
  meaningReady=(async()=>{
    if(language==='en')return {text:source,language:'en',verse,tab};
    try{
      const {text,reflection:reflect}=await translateTab(verse,tab,language);
      clearTimeout(note);
      if(generation!==translationGeneration||selectedVerse!==verse)return null;
      show(text,reflect,language);$('translationStatus').textContent='';
      return {text,language,verse,tab};
    }catch(e){
      clearTimeout(note);
      if(generation!==translationGeneration||selectedVerse!==verse)return null;
      // Keep the verse readable: fall back to English and offer a retry.
      show(source,reflection,'en');$('translationStatus').textContent='Translation unavailable, showing English.';$('retryTranslation').hidden=false;
      return {text:source,language:'en',verse,tab};
    }
  })();
}

function stepVerse(delta){if(selectedVerse)openVerse(Number(selectedVerse.chapter_id),Number(selectedVerse.verse_number)+delta)}
function toggleSave(){
  if(!selectedVerse)return;const id=selectedVerse.id;
  saved.has(id)?saved.delete(id):saved.add(id);
  if(saved.has(id))trackMeta('SaveVerse',{content_category:'verse'},true);
  localStorage.setItem('savedVerses',JSON.stringify([...saved]));
  $('saveVerse').textContent=saved.has(id)?'★ Saved':'☆ Save';
  toast(saved.has(id)?'Verse saved':'Removed from saved');
}
function stopSpeech(){
  narrationGeneration++;cancelPlayback?.();cancelPlayback=null;
  if(audioButton){audioButton.textContent='▶ Listen';audioButton=null;}
  speaking=false;
  if(currentAudio){currentAudio.pause();currentAudio=null;}
  if(ambientAudio){ambientAudio.pause();ambientAudio=null;}
  if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}
  if($('audioBtn')){$('audioBtn').textContent='▶';$('audioBtn').setAttribute('aria-label','Play verse and meaning');}
}
// Safari (iPhone and Mac) only lets audio start close to a tap. Narration
// clips arrive seconds later, so one player is unlocked during the tap
// (unlockVoice) and reused for every clip.
const SILENT_AUDIO='data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let voicePlayer=null;
function unlockVoice(){
  voicePlayer=voicePlayer||new Audio();
  voicePlayer.src=SILENT_AUDIO;voicePlayer.play().catch(()=>{});
}
function playBlob(blob){return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(blob),a=voicePlayer||new Audio();a.src=url;audioUrl=url;currentAudio=a;
  const clean=()=>{URL.revokeObjectURL(url);if(currentAudio===a){currentAudio=null;audioUrl=null;}cancelPlayback=null;};
  cancelPlayback=()=>{a.onended=a.onerror=null;a.pause();clean();resolve()};
  a.onended=()=>{a.onended=a.onerror=null;clean();resolve()};a.onerror=()=>{a.onended=a.onerror=null;clean();reject(new Error('Audio playback failed'))};
  a.play().catch(e=>{clean();reject(e)});
})}
// Split long meanings into provider-sized clips without cutting a surrogate pair.
function textClips(text){const chars=Array.from(text),out=[];for(let i=0;i<chars.length;i+=3000)out.push(chars.slice(i,i+3000).join(''));return out;}
async function playText(text,language,generation,firstClip){
  // Each clip is fetched while the previous one plays, so there is no silent gap.
  const clips=textClips(text);
  let next=firstClip||fetchTTS(clips[0],'meaning',null,language);
  for(let i=0;i<clips.length;i++){
    const blob=await next;
    if(generation!==narrationGeneration)return;
    next=i+1<clips.length?fetchTTS(clips[i+1],'meaning',null,language):null;next?.catch(()=>{});
    await playBlob(blob);
    if(generation!==narrationGeneration)return;
  }
}
async function listenReply(text,language,button){
  if(!hasLifetimeAccess()){showPaywall();return;}
  if(audioButton===button){stopSpeech();return;}
  stopSpeech();unlockVoice();const generation=narrationGeneration;audioButton=button;button.textContent='■ Stop';speaking=true;
  try{await playText(text,language,generation);}
  catch(e){if(generation===narrationGeneration)toast(e.message||'Audio unavailable. Please retry.');}
  finally{if(generation===narrationGeneration)stopSpeech();}
}
async function speak(){
  if(speaking){stopSpeech();return}if(!selectedVerse||!hasLifetimeAccess())return;
  stopSpeech();const generation=narrationGeneration,v=selectedVerse,ready=meaningReady;
  // Start both players inside the tap so Safari allows them to play later.
  unlockVoice();
  ambientAudio=new Audio('/alex-morgan-indian-classical-raga-537491.mp3');ambientAudio.loop=true;ambientAudio.volume=.18;ambientAudio.play().catch(()=>{});
  speaking=true;$('audioBtn').textContent='■';$('audioBtn').setAttribute('aria-label','Stop narration');
  try{
    // The chant is Sanskrit whatever the chosen language.
    const chantClip=fetchTTS(v.sanskrit,'verse',v,'hi');chantClip.catch(()=>{});
    const meaning=await ready;if(!meaning||generation!==narrationGeneration)return;
    let {text,language}=meaning;
    if(language==='en'&&meaningLanguage==='en-hi'){({text}=await translateTab(meaning.verse,meaning.tab,'hi'));language='hi';if(generation!==narrationGeneration)return;}
    // Fetch the meaning audio while the chant plays.
    const meaningClip=fetchTTS(textClips(text)[0],'meaning',null,language);meaningClip.catch(()=>{});
    const chant=await chantClip;if(generation!==narrationGeneration)return;
    await playBlob(chant);if(generation!==narrationGeneration)return;
    await playText(text,language,generation,meaningClip);
  }catch(e){if(generation===narrationGeneration)toast(e.message||'Narration could not be played');}
  finally{if(generation===narrationGeneration)stopSpeech();}
}

function appendText(parent,tag,text,className){const el=document.createElement(tag);el.textContent=text||'';if(className)el.className=className;parent.appendChild(el);return el;}
// Recent turns sent with each question so Krishna can follow the conversation.
const chatHistory=[];
let chatGeneration=0,chatRequest=null;
function clearChatConversation(){
  stopSpeech();translationGeneration++;translationCache.clear();
  chatGeneration++;chatRequest?.abort();chatRequest=null;chatHistory.length=0;
  $('chat').replaceChildren();$('askInput').value='';
  chatBusy=false;$('sendAskButton').disabled=false;
}
function refButton(parent,ref){
  const [c,v]=ref.replace('BG ','').split('.').map(Number);
  const b=appendText(parent,'button',ref,'chat-ref');b.type='button';b.onclick=()=>openVerse(c,v);return b;
}
// Paragraph text with inline "(BG 2.47)" references turned into tappable links.
function appendWithRefs(parent,text){
  const p=document.createElement('p');
  String(text||'').split(/(BG \d+\.\d+)/).forEach(part=>{
    if(/^BG \d+\.\d+$/.test(part))refButton(p,part);else if(part)p.appendChild(document.createTextNode(part));
  });
  parent.appendChild(p);return p;
}
function replyText(d){
  return [d.title,...(d.paragraphs||[d.opening,d.explanation]),...(d.actions||[]),d.follow_up].filter(Boolean).join('\n');
}
async function sendAsk(){
  if(chatBusy)return;
  const q=$('askInput').value.trim();if(!q){toast('Write a question first');return}
  // Without Annual Access: sign up free for one question, then the paywall.
  if(!hasLifetimeAccess()){
    if(!authSession?.access_token){savePendingQuestion(q);logEvent('paywall_view');openFreeQuestionSignup();return}
    if(!accountProfile?.free_question_available){showPaywall();return}
  }
  trackMeta('AskKrishnaUsed',{},true);logEvent('ask_krishna');
  const generation=chatGeneration,language=chatLanguage==='auto'?undefined:chatLanguage;
  const controller=new AbortController();chatRequest=controller;
  chatBusy=true;$('sendAskButton').disabled=true;$('askInput').value='';
  appendText($('chat'),'div',q,'bubble user');const answer=appendText($('chat'),'div','Krishna is listening…','bubble assistant');
  answer.scrollIntoView({behavior:'smooth',block:'center'});
  try{
    const r=await fetch(SUPA+'/functions/v1/ask-krishna',{signal:controller.signal,method:'POST',headers:authHeaders(authSession.access_token),body:JSON.stringify({question:q,language,history:chatHistory.slice(-8)})});
    const d=await r.json();if(generation!==chatGeneration)return;
    if(r.status===403&&d.paywall){if(accountProfile)accountProfile.free_question_available=false;answer.remove();$('chat').lastElementChild?.remove();$('askInput').value=q;renderAccessState();showPaywall();return}
    if(!r.ok||d.error)throw new Error(d.error||'Could not reach the guide. Please try again.');
    answer.textContent='';answer.dir='auto';if(language)answer.lang=language;
    if(d.style==='krishna_inspired'){
      appendText(answer,'small','Sri Krishna says');if(d.title)appendText(answer,'h3',d.title);
      (d.paragraphs||[d.opening,d.explanation]).filter(Boolean).forEach(t=>appendWithRefs(answer,t));
      if(d.actions?.length){appendText(answer,'strong','What to do now');const ul=document.createElement('ul');d.actions.forEach(x=>appendText(ul,'li',x));answer.appendChild(ul)}
      if(d.follow_up)appendWithRefs(answer,d.follow_up).className='chat-follow-up';
      (d.verses||[]).forEach(v=>{const b=appendText(answer,'button',v.ref+' · '+(v.translation||''),'chat-verse-card');b.onclick=()=>openVerse(Number(v.chapter),Number(v.verse));});
      appendText(answer,'small',d.disclaimer||'Devotional reflection inspired by the Bhagavad Gita.');
      chatHistory.push({role:'user',text:q},{role:'assistant',text:replyText(d)});
    }else{
      answer.textContent=d.answer||'No response was returned. Please try again.';
      if(d.answer)chatHistory.push({role:'user',text:q},{role:'assistant',text:d.answer});
    }
    const spoken=d.style==='krishna_inspired'?replyText(d):d.answer;
    if(spoken){const listen=appendText(answer,'button','▶ Listen','listen-reply');listen.type='button';listen.onclick=()=>listenReply(spoken,language||detectLanguage(spoken),listen);}
    if(chatHistory.length>16)chatHistory.splice(0,chatHistory.length-16);
    if(d.free_question){
      if(accountProfile)accountProfile.free_question_available=false;renderAccessState();
      const card=appendText($('chat'),'div','','bubble assistant upgrade-card');
      appendText(card,'strong','That was your free question 🙏');
      appendText(card,'p','Keep talking with Krishna whenever you need guidance, plus all 701 verses with meaning, audio and 13 Indian languages.');
      appendText(card,'p','₹1,000 for a full year · about ₹83 a month','upgrade-price');
      const buy=appendText(card,'button','Get Annual Access →','upgrade-btn');buy.type='button';buy.onclick=startLifetimePurchase;
    }
  }catch(e){if(generation===chatGeneration){answer.textContent=e.message||'Could not reach the guide. Please try again.';if(!$('askInput').value)$('askInput').value=q;}}
  finally{if(generation===chatGeneration){chatRequest=null;chatBusy=false;$('sendAskButton').disabled=false;}}
}
function openTopic(key,title){
  if(!hasLifetimeAccess()){showPaywall();return}const t=LIFE_TOPICS[key];if(!t)return;
  $('topicTitle').textContent=title||t.label;$('topicIntro').textContent=t.intro;
  ['Dos','Donts'].forEach(kind=>{const el=$('topic'+kind);el.replaceChildren();t[kind.toLowerCase()].forEach(x=>appendText(el,'li',x));});
  $('topicPractice').textContent=t.practice;$('topicVerses').replaceChildren();
  t.verses.forEach(v=>{const b=appendText($('topicVerses'),'button','Bhagavad Gita '+v.c+'.'+v.v+' — '+v.n,'chat-verse-card');b.onclick=()=>openVerse(v.c,v.v);});
  showScreen('topicScreen');
}
$('authBack').onclick=()=>showScreen('home');$('accountBack').onclick=()=>showScreen('home');
$('googleLogin').onclick=startGoogleLogin;$('loginTab').onclick=()=>setAuthPageMode('login');$('signupTab').onclick=()=>setAuthPageMode('signup');
$('passwordLoginStep').onsubmit=signInWithPassword;$('passwordSignupBtn').onclick=signUpWithPassword;
$('sendOtpBtn').onclick=sendOtp;$('verifyOtpBtn').onclick=verifyOtp;$('resendOtp').onclick=sendOtpAgain;$('changePhone').onclick=changePhone;
$('phoneNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();sendOtp()}};
$('otpCode').oninput=()=>{if($('otpCode').value.replace(/\D/g,'').length===6)verifyOtp()};
function sendOtpAgain(){$('sendOtpBtn').hidden=false;$('phoneNumber').disabled=false;sendOtp();}
$('signupPassword').onkeydown=e=>{if(e.key==='Enter')signUpWithPassword()};
$('signOutBtn').onclick=signOut;$('accountUpgrade').onclick=startLifetimePurchase;
$('askInput').onkeydown=e=>{if(e.key==='Enter')sendAsk()};
document.querySelectorAll('#meaningTabs button').forEach(b=>b.onclick=()=>renderTab(b.dataset.tab));
document.querySelectorAll('.topic-row .topic').forEach((b,i)=>{b.onclick=()=>openTopic(['duty','love','mind','devotion','ego','mind'][i],b.querySelector('b').textContent)});
document.querySelectorAll('#home .see').forEach((b,i)=>{if(b.tagName==='SPAN'){b.tabIndex=0;b.setAttribute('role','button');b.onclick=()=>i===0?showScreen('explore'):document.querySelector('.topic-row').scrollBy({left:170,behavior:'smooth'});b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click()}}}});
window.addEventListener('beforeunload',stopSpeech);
setupLanguages();
logVisit();
setupInAppAuth();
let hadSession=false;try{hadSession=!!localStorage.getItem('gitaAuthSession')}catch(e){}
setAuthPageMode(IN_APP_NAME&&!hadSession?'signup':'login');updateAccountUI();showScreen('home');loadDailyVerse();
if(new URLSearchParams(location.search).get('from')==='inapp'){trackMeta('OpenedFromInApp',{},true);history.replaceState({},document.title,location.pathname+location.hash)}
(async()=>{const oauth=await consumeOAuthHash().catch(()=>false);if(!oauth)await refreshAuthSession();await handlePaymentReturn().catch(()=>false)})();
