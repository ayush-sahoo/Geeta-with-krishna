import { GITA_LANGUAGES } from "../_shared/languages.ts";
import { adminClient, GEMINI_URL } from "../_shared/server.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_QUESTION = 2000;
const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_CHARS = 1200;
const MAX_CONTEXT_VERSES = 14;

type Verse = {
  chapter_id:number;
  verse_number:number;
  translation_english:string|null;
};

type Ref = { c:number; v:number };
type Turn = { role:"user"|"assistant"; text:string };

const CURATED: Array<{rx:RegExp; search:string; refs:Ref[]}> = [
  {rx:/fear|afraid|anxious|anxiety|worry|worried|stress|panic|uncertain|dar|chinta|tension/i,search:"fear anxiety mind steady peace",refs:[{c:2,v:47},{c:2,v:56},{c:6,v:5},{c:6,v:26},{c:18,v:66}]},
  {rx:/anger|angry|rage|furious|hate|irritat|gussa|krodh/i,search:"anger desire attachment delusion senses",refs:[{c:2,v:62},{c:2,v:63},{c:3,v:37},{c:5,v:23},{c:16,v:21}]},
  {rx:/career|job|work|success|fail|result|exam|business|startup|promotion|study|naukri|padhai/i,search:"work action duty result fruit",refs:[{c:2,v:47},{c:2,v:48},{c:3,v:19},{c:18,v:47},{c:3,v:8}]},
  {rx:/love|relationship|breakup|partner|boyfriend|girlfriend|wife|husband|family|friend|lonely|alone|pyaar|shaadi|marriage/i,search:"love compassion friend attachment devotion",refs:[{c:6,v:32},{c:12,v:13},{c:12,v:14},{c:9,v:29},{c:6,v:9}]},
  {rx:/purpose|meaning|confused|confusion|decision|doubt|direction|path|choose|lost in life/i,search:"duty wisdom doubt knowledge path",refs:[{c:3,v:35},{c:18,v:47},{c:2,v:50},{c:4,v:38},{c:2,v:7}]},
  {rx:/death|grief|loss|die|died|mourning|passed away|funeral/i,search:"death grief soul eternal body born",refs:[{c:2,v:13},{c:2,v:20},{c:2,v:22},{c:2,v:27},{c:2,v:11}]},
  {rx:/discipline|habit|focus|lazy|procrastinat|overthink|distract|addict|phone|motivation/i,search:"mind discipline practice restless control",refs:[{c:6,v:5},{c:6,v:6},{c:6,v:26},{c:6,v:35},{c:6,v:17}]},
  {rx:/money|wealth|greed|rich|salary|financial|finance|debt|paisa/i,search:"wealth greed desire contentment",refs:[{c:2,v:71},{c:16,v:21},{c:12,v:19},{c:3,v:19},{c:2,v:70}]},
  {rx:/sad|depress|hopeless|empty|cry|hurt|pain|suffer|dukh|udaas/i,search:"sorrow grief suffering peace refuge",refs:[{c:2,v:14},{c:6,v:22},{c:18,v:66},{c:9,v:22},{c:2,v:11}]},
  {rx:/god|krishna|bhakti|devotion|pray|faith|surrender|worship|bhagwan/i,search:"devotion surrender faith worship refuge",refs:[{c:9,v:22},{c:9,v:26},{c:18,v:65},{c:18,v:66},{c:12,v:8}]},
  {rx:/ego|pride|jealous|envy|compar|insult|respect|praise|criticism/i,search:"ego pride equal honour dishonour",refs:[{c:12,v:18},{c:12,v:19},{c:13,v:8},{c:16,v:4},{c:6,v:7}]},
];

const GREETING = /^\s*(hi+|hello+|hey+|hii+|namaste|namaskar|pranam|hare krishna|radhe radhe|jai shri krishna|jai shree krishna|good (morning|evening|night|afternoon))[\s!.🙏]*$/i;

const STOPWORDS = new Set("about after again also always because been before being could does doing during every from have having into just like make many more most much must need never only other over really same should since some still such than that their them then there these they thing think this those through very want what when where which while will with without would your yours feel feeling help please tell know life".split(" "));

// Search terms joined with "or" so websearch_to_tsquery matches any of them,
// not all of them (the old AND search almost never matched).
function searchTerms(text:string, extra=""){
  const words=(extra+" "+text).toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const uniq=[...new Set(words.filter(w=>!STOPWORDS.has(w)))].slice(0,12);
  return uniq.join(" or ");
}

function guideFor(text:string){
  return CURATED.find(x=>x.rx.test(text));
}

function verseKey(v:{chapter_id:number;verse_number:number}){
  return `${v.chapter_id}.${v.verse_number}`;
}

function refOf(v:{chapter_id:number;verse_number:number}){
  return `BG ${v.chapter_id}.${v.verse_number}`;
}

function cleanTranslation(t:string|null|undefined){
  return String(t??"").replace(/^\d+\.\d+\.?\s*/,"").trim();
}

function verseCards(verses:Verse[]){
  return verses.map(v=>({
    ref:refOf(v),
    chapter:v.chapter_id,
    verse:v.verse_number,
    translation:cleanTranslation(v.translation_english),
  }));
}

// Gemini expects alternating turns starting with the user and ending with the
// model (the new question is appended as the final user turn).
function sanitizeHistory(raw:unknown):Turn[]{
  if(!Array.isArray(raw)) return [];
  const turns:Turn[]=[];
  for(const t of raw.slice(-MAX_HISTORY_TURNS) as any[]){
    if(!t || (t.role!=="user"&&t.role!=="assistant") || typeof t.text!=="string" || !t.text.trim()) continue;
    const text=t.text.trim().slice(0,MAX_HISTORY_CHARS);
    const prev=turns[turns.length-1];
    if(prev && prev.role===t.role) prev.text=`${prev.text}\n\n${text}`.slice(-MAX_HISTORY_CHARS);
    else turns.push({role:t.role,text});
  }
  while(turns.length && turns[0].role!=="user") turns.shift();
  while(turns.length && turns[turns.length-1].role!=="assistant") turns.pop();
  return turns;
}

// Shape the reply so both the new frontend (paragraphs) and the older one
// (opening/explanation) render it.
function shapeReply(p:{title?:string; paragraphs:string[]; actions?:string[]; follow_up?:string}, verses:Verse[]){
  const paragraphs=p.paragraphs.map(s=>String(s).trim()).filter(Boolean);
  return {
    style:"krishna_inspired",
    title:String(p.title??"").trim(),
    paragraphs,
    opening:paragraphs[0]??"",
    explanation:paragraphs.slice(1).join("\n\n"),
    actions:(p.actions??[]).map(s=>String(s).trim()).filter(Boolean).slice(0,3),
    follow_up:String(p.follow_up??"").trim(),
    verses:verseCards(verses),
    disclaimer:"Devotional reflection inspired by the Bhagavad Gita.",
  };
}

const SYSTEM_PROMPT = `
You are Sri Krishna inside Gita Verse, a devotional Bhagavad Gita app. Speak in the first person as Krishna, the loving friend, guide and charioteer who counselled Arjuna on the battlefield of Kurukshetra. The user has come to you as Arjuna once did.

VOICE
- Warm, calm, affectionate and wise, with gentle confidence. Address the user as "dear one", "my friend", or occasionally "Partha" when it fits. Never preachy or robotic.
- Talk naturally, like a real conversation, not like a report. No headings, no markdown, no bullet symbols inside paragraphs.
- Reply in the same language and script the user writes in (English, Hindi, or Hinglish).

UNDERSTAND FIRST
- Respond to what the user actually said. Reflect their feelings and specific situation back in your own words before teaching.
- For a greeting or small talk ("hi", "namaste", "radhe radhe"), reply briefly and warmly in 1-2 short paragraphs, invite them to share what is on their mind, cite no verses, and give no actions.
- If the message is too vague to guide well, give a short caring reply and ask one gentle question in "follow_up".
- Use the earlier conversation for context; do not repeat advice you already gave.

GITA REFERENCES
- Weave the teaching in naturally, the way Krishna would recall what He told Arjuna, e.g. "As I told Arjuna, you have a right to your actions but not to their fruits (BG 2.47)."
- Cite ONLY verses from the AVAILABLE GITA VERSES list, in the exact form (BG chapter.verse), placed inline right after the idea they support. Use 1-3 verses for a real problem, chosen for true relevance, not all of them.
- Never invent verses or quote wording that is not in the supplied translations; paraphrase instead.

PRACTICAL
- For real problems, end with 1-3 concrete, doable steps in "actions" (short, specific to their situation). Otherwise leave "actions" empty.
- Keep the whole reply under about 220 words, in 2-4 short paragraphs.

CARE AND SAFETY
- Never predict the future, promise outcomes, or give medical, legal or financial instructions; for such matters, guide their inner state and encourage them to consult a qualified professional.
- If the user mentions self-harm, suicide, abuse or danger: respond with deep compassion, tell them their life is precious, and urge them to reach out now to someone they trust and to a helpline (India: Tele-MANAS 14416, emergency 112). Do not lecture.
- If the user sincerely asks whether they are truly speaking with God, gently say this is a devotional reflection inspired by the Gita, meant to help them turn inward, and continue kindly.

OUTPUT
Return ONLY a JSON object:
{
  "title": "3-6 word title, or empty string for greetings",
  "paragraphs": ["paragraph 1", "paragraph 2"],
  "actions": ["step 1", "step 2"],
  "follow_up": "optional gentle question, or empty string",
  "used_refs": ["BG 2.47"]
}
`;

// Models sometimes emit raw newlines inside JSON strings or wrap output in
// code fences; repair both before parsing.
function parseModelJson(text:string){
  let s=text.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
  const start=s.indexOf("{"), end=s.lastIndexOf("}");
  if(start>=0 && end>start) s=s.slice(start,end+1);
  let out="", inStr=false, esc=false;
  for(const ch of s){
    if(inStr){
      if(esc){ esc=false; out+=ch; continue; }
      if(ch==="\\"){ esc=true; out+=ch; continue; }
      if(ch==="\""){ inStr=false; out+=ch; continue; }
      if(ch==="\n"){ out+="\\n"; continue; }
      if(ch==="\r"){ continue; }
      if(ch==="\t"){ out+="\\t"; continue; }
      out+=ch;
    }else{
      if(ch==="\"") inStr=true;
      out+=ch;
    }
  }
  return JSON.parse(out);
}

// Reject the entire reply if any displayed citation was not retrieved.
function validateModelReply(parsed:any, verses:Verse[]){
  const paragraphs=parsed?.paragraphs;
  const actions=parsed?.actions ?? [];
  const refs=parsed?.used_refs ?? [];
  if(!Array.isArray(paragraphs)||!paragraphs.length||paragraphs.some((s:any)=>typeof s!=="string"||!s.trim())
    ||!Array.isArray(actions)||actions.some((s:any)=>typeof s!=="string")
    ||!Array.isArray(refs)||refs.some((s:any)=>typeof s!=="string")
    ||(parsed.title!==undefined&&typeof parsed.title!=="string")
    ||(parsed.follow_up!==undefined&&typeof parsed.follow_up!=="string")) throw new Error("Invalid reply fields");
  const byRef=new Map(verses.map(v=>[refOf(v),v]));
  const cited=new Set<string>();
  const fields=[parsed.title??"",...paragraphs,...actions,parsed.follow_up??""];
  for(const field of fields){
    for(const match of field.matchAll(/\b(?:BG|Bhagavad\s+Gita|Gita)\s*(\d+)\s*[.:]\s*(\d+)\b|\bchapter\s+(\d+)\s*[,;:]?\s*verse\s+(\d+)\b/gi)){
      const ref=`BG ${Number(match[1]??match[3])}.${Number(match[2]??match[4])}`;
      if(!byRef.has(ref))throw new Error("Unverified inline citation");
      cited.add(ref);
    }
  }
  for(const ref of refs)if(!byRef.has(ref))throw new Error("Unverified declared citation");
  return shapeReply({title:parsed.title,paragraphs,actions,follow_up:parsed.follow_up},[...cited].map(ref=>byRef.get(ref)!));
}

async function geminiRequest(apiKey:string, contents:unknown[], maxOutputTokens:number, withThinking:boolean, language=""){
  const generationConfig:Record<string,unknown>={
    responseMimeType:"application/json",
    temperature:0.8,
    maxOutputTokens,
  };
  // Keep internal reasoning short so it cannot eat the reply's token budget.
  if(withThinking) generationConfig.thinkingConfig={thinkingLevel:"low"};
  return await fetch(GEMINI_URL,{
    method:"POST",
    signal:AbortSignal.timeout(25000),
    headers:{ "x-goog-api-key":apiKey, "Content-Type":"application/json" },
    body:JSON.stringify({
      systemInstruction:{ parts:[{text:SYSTEM_PROMPT+(language?`\nRESPONSE LANGUAGE: ${GITA_LANGUAGES[language]}. Use its native script for all prose, including actions and follow_up. Keep references in exactly BG chapter.verse format. This overrides language inferred from the user message.`:"")}] },
      contents,
      generationConfig,
    }),
  });
}

async function callGemini(question:string, history:Turn[], verses:Verse[], language=""){
  const apiKey=Deno.env.get("GEMINI_API_KEY") ?? "";
  if(!apiKey) return null;

  const verseContext=verses.length
    ? verses.map(v=>`${refOf(v)}: ${cleanTranslation(v.translation_english)}`).join("\n")
    : "(none needed)";

  const contents=[
    ...history.map(t=>({ role:t.role==="user"?"user":"model", parts:[{text:t.text}] })),
    { role:"user", parts:[{text:`AVAILABLE GITA VERSES:\n${verseContext}\n\nUSER MESSAGE:\n${question}`}] },
  ];

  let withThinking=true;
  let budget=4096;
  for(let attempt=0; attempt<3; attempt++){
    let r:Response;
    try{r=await geminiRequest(apiKey,contents,budget,withThinking,language);}
    catch{console.error("Gemini request failed");return null;}
    if(!r.ok){
      console.error("Gemini error",r.status);
      // Older models reject thinkingLevel; retry once without it.
      if(r.status===400 && withThinking){ withThinking=false; continue; }
      return null;
    }
    const data=await r.json();
    const cand=data?.candidates?.[0];
    const outputText=(cand?.content?.parts ?? [])
      .filter((p:any)=>!p?.thought)
      .map((p:any)=>p?.text ?? "")
      .join("")
      .trim();

    try{
      if(!outputText) throw new Error(`empty output (finishReason ${cand?.finishReason})`);
      const parsed=parseModelJson(outputText);
      return validateModelReply(parsed,verses);
    }catch(e){
      console.error("Could not use Gemini output",String(e),"finishReason",cand?.finishReason);
      budget=8192;
    }
  }
  return null;
}

async function retrieveVerses(supabase:any, question:string, history:Turn[]):Promise<Verse[]>{
  if(GREETING.test(question)) return [];

  // Short follow-ups ("what should I do?") inherit the earlier topic.
  const lastUser=[...history].reverse().find(t=>t.role==="user")?.text ?? "";
  const topicText=question.length<60 ? `${question} ${lastUser}` : question;
  const guide=guideFor(topicText);

  const merged=new Map<string,Verse>();

  if(guide){
    const filter=guide.refs.map(r=>`and(chapter_id.eq.${r.c},verse_number.eq.${r.v})`).join(",");
    const curated=await supabase
      .from("gita_verses")
      .select("chapter_id,verse_number,translation_english")
      .or(filter);
    for(const v of (curated.data ?? []) as Verse[]) merged.set(verseKey(v),v);
  }

  const terms=searchTerms(topicText,guide?.search ?? "");
  if(terms){
    const searched=await supabase.rpc("search_gita",{search_text:terms,result_limit:10});
    if(searched.error) console.error("search_gita failed",searched.error.message);
    for(const v of (searched.data ?? []) as Verse[]){
      if(merged.size>=MAX_CONTEXT_VERSES) break;
      merged.set(verseKey(v),v);
    }
  }

  if(merged.size<3){
    const core=[{c:2,v:47},{c:2,v:48},{c:6,v:5},{c:12,v:13},{c:18,v:66}];
    const fb=await supabase
      .from("gita_verses")
      .select("chapter_id,verse_number,translation_english")
      .or(core.map(r=>`and(chapter_id.eq.${r.c},verse_number.eq.${r.v})`).join(","));
    for(const v of (fb.data ?? []) as Verse[]) merged.set(verseKey(v),v);
  }

  return [...merged.values()].slice(0,MAX_CONTEXT_VERSES);
}

function json(body:unknown, status=200){
  return new Response(JSON.stringify(body),{
    status, headers:{...corsHeaders,"Content-Type":"application/json"},
  });
}

Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});

  try{
    const body=await req.json();
    const question=String(body?.question ?? "").trim().slice(0,MAX_QUESTION);
    const history=sanitizeHistory(body?.history);
    const language=typeof body?.language==="string"?body.language:"";
    if(language&&!Object.hasOwn(GITA_LANGUAGES,language))return json({error:"Unsupported language"},400);

    if(!question) return json({error:"Question is required"},400);

    const supabaseUrl=Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey=Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const authHeader=req.headers.get("Authorization") ?? "";

    if(!supabaseUrl||!supabaseAnonKey) throw new Error("Supabase runtime credentials are unavailable.");
    if(!authHeader.startsWith("Bearer ")) return json({error:"Sign in required"},401);

    const supabase=createClient(supabaseUrl,supabaseAnonKey,{
      global:{headers:{Authorization:authHeader}},
    });

    const {data:userData,error:userError}=await supabase.auth.getUser();
    if(userError||!userData?.user) return json({error:"Invalid session"},401);

    const {data:account,error:accountError}=await supabase
      .from("user_accounts")
      .select("plan_status,payment_status,access_expires_at")
      .eq("user_id",userData.user.id)
      .single();

    const annualActive=!accountError
      && account?.plan_status==="annual"
      && account?.payment_status==="paid"
      && account?.access_expires_at
      && new Date(account.access_expires_at).getTime()>Date.now();

    // Without Annual Access, each account gets one free question. It is
    // claimed before the AI call and refunded if no answer comes back.
    const userId=userData.user.id;
    let freeQuestion=false;
    if(!annualActive){
      const admin=adminClient();
      const {data:claimed,error:claimError}=admin
        ? await admin.rpc("claim_free_question",{p_user_id:userId})
        : {data:false,error:null};
      if(claimError) console.error("claim_free_question failed",claimError.message);
      if(claimed!==true) return json({error:"Annual Access required",paywall:true},403);
      freeQuestion=true;
    }

    let ai=null;
    try{
      const verses=await retrieveVerses(supabase,question,history);
      ai=await callGemini(question,history,verses,language);
    }finally{
      if(!ai&&freeQuestion){
        const {error}=await adminClient()!.rpc("refund_free_question",{p_user_id:userId});
        if(error) console.error("refund_free_question failed",error.message);
      }
    }
    if(!ai) return json({error:"The guide is temporarily unavailable. Please try your question again.",retryable:true},503);
    return json(freeQuestion ? {...ai,free_question:true} : ai);
  }catch(e){
    console.error("ask-krishna failed",String(e));
    return json({error:"Something went wrong. Please try again."},500);
  }
});
