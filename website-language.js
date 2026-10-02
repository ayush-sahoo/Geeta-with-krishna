// UI localization is independent of chatLanguage and meaningLanguage.
let websiteLanguage='en',websiteDictionary={},websiteLanguageGeneration=0,websiteObserver;
const websiteOriginals=new WeakMap(),websiteAttributes=new WeakMap();
function websiteTextExcluded(element){return !element||!!element.closest('script,style,select,textarea,#chat,#chatHistoryList,#detailSanskrit,#detailTranslit,#detailMeaning,#reflection,#topicVerses');}
function websiteTranslateText(text){
  const trim=text.trim();if(!trim)return text;
  let value=websiteDictionary[trim];
  if(!value){
    // Dynamic labels retain their numbers and account name.
    const verse=trim.match(/^(Verse|Chapter) (\d+)(.*)$/);
    if(verse)value=(websiteDictionary[verse[1]]||verse[1])+' '+verse[2]+verse[3];
    const welcome=trim.match(/^Welcome[,]?\s+(.+)$/i);
    if(welcome)value=(websiteDictionary['Welcome']||'Welcome')+' '+welcome[1];
  }
  return value?text.replace(trim,value):text;
}
function applyWebsiteLanguage(){
  websiteObserver?.disconnect();
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
    if(websiteTextExcluded(node.parentElement))continue;
    let record=websiteOriginals.get(node);
    if(!record||node.nodeValue!==record.output)record={source:node.nodeValue,output:node.nodeValue};
    record.output=websiteLanguage==='en'?record.source:websiteTranslateText(record.source);
    if(node.nodeValue!==record.output)node.nodeValue=record.output;
    websiteOriginals.set(node,record);
  }
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(element=>{
    if(websiteTextExcluded(element))return;
    const records=websiteAttributes.get(element)||{};
    for(const key of ['placeholder','title','aria-label']){
      if(!element.hasAttribute(key))continue;
      const text=element.getAttribute(key);let r=records[key];
      if(!r||text!==r.output)r={source:text,output:text};
      r.output=websiteLanguage==='en'?r.source:websiteTranslateText(r.source);
      if(text!==r.output)element.setAttribute(key,r.output);records[key]=r;
    }
    websiteAttributes.set(element,records);
  });
  document.documentElement.lang=websiteLanguage;
  websiteObserver?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label']});
}
async function setWebsiteLanguage(language){
  const generation=++websiteLanguageGeneration;
  if(language==='en'){
    websiteLanguage='en';websiteDictionary={};localStorage.setItem('gitaWebsiteLanguage','en');applyWebsiteLanguage();return;
  }
  if(!Object.hasOwn(GITA_LANGUAGES,language))return;
  $('appLanguage').disabled=true;$('websiteLanguageStatus').textContent='Loading website language…';
  try{
    let data;
    try{
      const cached=await fetch('/locales/'+encodeURIComponent(language)+'.json',{cache:'force-cache',signal:AbortSignal.timeout(10000)});
      if(cached.ok)data=await cached.json();
    }catch(e){}
    if(generation!==websiteLanguageGeneration)return;
    for(let attempt=0;!data&&attempt<8;attempt++){
      const response=await fetch(SUPA+'/functions/v1/website-language?language='+encodeURIComponent(language),{headers:{apikey:KEY,Authorization:'Bearer '+KEY},signal:AbortSignal.timeout(90000)});
      if(generation!==websiteLanguageGeneration)return;
      if(response.status===202){await new Promise(resolve=>setTimeout(resolve,1500));continue;}
      if(!response.ok)throw new Error('Website translation unavailable');data=await response.json();break;
    }
    if(!data?.translations)throw new Error('Website translation is still preparing. Please try again.');
    if(generation!==websiteLanguageGeneration)return;
    websiteLanguage=language;websiteDictionary=data.translations;
    localStorage.setItem('gitaWebsiteLanguage',language);applyWebsiteLanguage();$('websiteLanguageStatus').textContent='';
  }catch(e){if(generation===websiteLanguageGeneration){$('appLanguage').value=websiteLanguage;$('websiteLanguageStatus').textContent='Could not load this language. Please try again.';}}
  finally{if(generation===websiteLanguageGeneration)$('appLanguage').disabled=false;}
}
function setupWebsiteLanguage(){
  const select=$('appLanguage');select.replaceChildren();
  for(const [code,name] of Object.entries(GITA_LANGUAGES)){const option=document.createElement('option');option.value=code;option.textContent=name;select.appendChild(option);}
  select.onchange=()=>setWebsiteLanguage(select.value);
  let saved='en';try{saved=localStorage.getItem('gitaWebsiteLanguage')||'en';}catch(e){}
  if(!Object.hasOwn(GITA_LANGUAGES,saved)){saved='en';try{localStorage.setItem('gitaWebsiteLanguage',saved);}catch(e){}}
  select.value=saved;websiteObserver=new MutationObserver(()=>applyWebsiteLanguage());applyWebsiteLanguage();
  if(saved!=='en')setWebsiteLanguage(saved);
}
