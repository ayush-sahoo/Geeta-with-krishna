// Account-owned conversations. Database RLS is the access boundary.
let savedChatThread=null,savedChatEpoch=0,savedChatQueue=Promise.resolve(),unsavedChatBatches=[];
let historyLoadGeneration=0;
function resetSavedChatState(){
  savedChatThread=null;savedChatEpoch++;unsavedChatBatches=[];
  historyLoadGeneration++;setChatSaveStatus('');
  if(document.getElementById('chatHistoryList'))$('chatHistoryList').replaceChildren();
}
function updateChatHistoryUI(){
  const controls=document.getElementById('chatHistoryControls');
  if(controls)controls.hidden=!authSession?.user?.id;
}
function setupChatHistory(){
  const controls=document.createElement('div');controls.id='chatHistoryControls';controls.className='chat-history-controls';
  const history=appendText(controls,'button','Chat history','history-button');history.type='button';
  history.setAttribute('aria-expanded','false');history.setAttribute('aria-controls','chatHistoryList');
  history.onclick=()=>{const list=$('chatHistoryList');list.hidden=!list.hidden;history.setAttribute('aria-expanded',String(!list.hidden));if(!list.hidden)loadSavedChatList();};
  const fresh=appendText(controls,'button','New chat','history-button');fresh.type='button';
  fresh.onclick=()=>{if(chatBusy)return toast('Please wait for Krishna’s reply.');if(unsavedChatBatches.length)return toast('Please save this conversation before starting a new chat.');clearChatConversation();showScreen('ask');$('askInput').focus();setChatSaveStatus('New conversation');};
  const status=appendText(controls,'span','','chat-save-status');status.id='chatSaveStatus';status.setAttribute('role','status');
  const retry=appendText(controls,'button','Retry saving','history-button');retry.id='chatSaveRetry';retry.type='button';retry.hidden=true;retry.onclick=()=>retryChatSaving();
  const list=document.createElement('div');list.id='chatHistoryList';list.className='chat-history-list';list.hidden=true;
  $('chat').before(controls,list);updateChatHistoryUI();
}
function setChatSaveStatus(text,failed=false){
  if(!document.getElementById('chatSaveStatus'))return;
  $('chatSaveStatus').textContent=text;$('chatSaveRetry').hidden=!failed;
}
async function chatStoreRequest(path,options,owner){
  await freshSession();
  if(authSession?.user?.id!==owner)throw new Error('Account changed');
  const response=await timedFetch(SUPA+'/rest/v1/'+path,{...options,headers:{...authHeaders(authSession.access_token),Prefer:'resolution=ignore-duplicates,return=minimal',...options?.headers}});
  if(!response.ok)throw new Error('Could not save or load your conversation');
  return response;
}
function persistChatTurns(turns){
  const owner=authSession?.user?.id;if(!owner||!turns.length)return Promise.resolve();
  const first=turns.find(t=>t.role==='user')?.text||'Conversation with Krishna';
  savedChatThread||={id:crypto.randomUUID(),title:first.slice(0,100),owner};
  const thread={...savedChatThread},epoch=savedChatEpoch;
  const now=Date.now();
  const rows=turns.map((turn,i)=>({id:crypto.randomUUID(),thread_id:thread.id,user_id:owner,role:turn.role,content:turn.text,cited_verses:turn.verses||[],created_at:new Date(now+i).toISOString()}));
  const batch={thread,rows,epoch,owner};unsavedChatBatches.push(batch);
  setChatSaveStatus('Saving conversation…');
  return queueChatSave(batch);
}
function queueChatSave(batch){
  const {thread,rows,epoch,owner}=batch;
  const current=()=>epoch===savedChatEpoch&&authSession?.user?.id===owner;
  savedChatQueue=savedChatQueue.catch(()=>{}).then(async()=>{
    if(!current())return;
    try{
      await chatStoreRequest('chat_threads',{method:'POST',body:JSON.stringify({id:thread.id,user_id:owner,title:thread.title})},owner);
      if(!current())return;
      await chatStoreRequest('chat_messages',{method:'POST',body:JSON.stringify(rows)},owner);
      if(!current())return;
      await chatStoreRequest('chat_threads?id=eq.'+encodeURIComponent(thread.id)+'&user_id=eq.'+encodeURIComponent(owner),{method:'PATCH',body:JSON.stringify({updated_at:new Date().toISOString()})},owner);
      if(!current())return;
      unsavedChatBatches=unsavedChatBatches.filter(item=>item!==batch);
      setChatSaveStatus(unsavedChatBatches.length?'Some messages need saving':'Conversation saved',!!unsavedChatBatches.length);
    }catch(e){if(current())setChatSaveStatus('Not saved yet. Your conversation is still here.',true);}
  });
  return savedChatQueue;
}
function retryChatSaving(){for(const batch of [...unsavedChatBatches])queueChatSave(batch);}
async function loadSavedChatList(){
  const owner=authSession?.user?.id,epoch=savedChatEpoch,request=++historyLoadGeneration;
  if(!owner)return;
  const list=$('chatHistoryList');list.replaceChildren();appendText(list,'p','Loading conversations…');
  const current=()=>owner===authSession?.user?.id&&epoch===savedChatEpoch&&request===historyLoadGeneration;
  try{
    const response=await chatStoreRequest('chat_threads?select=id,title,updated_at&user_id=eq.'+encodeURIComponent(owner)+'&order=updated_at.desc&limit=100',{method:'GET'},owner);
    const threads=await response.json();if(!current())return;
    list.replaceChildren();if(!threads.length)appendText(list,'p','Your saved conversations will appear here.');
    for(const thread of threads){
      const button=appendText(list,'button',thread.title||'Conversation with Krishna','saved-chat-item');button.type='button';button.onclick=()=>openSavedChat(thread);
      appendText(button,'small',new Date(thread.updated_at).toLocaleDateString());
    }
  }catch(e){if(current()){list.replaceChildren();appendText(list,'p','Could not load history. Please try again.');const retry=appendText(list,'button','Retry','history-button');retry.onclick=loadSavedChatList;}}
}
async function openSavedChat(thread){
  if(chatBusy)return toast('Please wait for Krishna’s reply.');
  if(unsavedChatBatches.length)return toast('Save this conversation using Retry saving before switching.');
  const owner=authSession?.user?.id,epoch=savedChatEpoch,request=++historyLoadGeneration;
  try{
    // A newest-first page keeps the most recent context even for long chats.
    const response=await chatStoreRequest('chat_messages?select=role,content,cited_verses,created_at,id&thread_id=eq.'+encodeURIComponent(thread.id)+'&user_id=eq.'+encodeURIComponent(owner)+'&order=created_at.desc,id.desc&limit=500',{method:'GET'},owner);
    const messages=(await response.json()).reverse();
    if(epoch!==savedChatEpoch||owner!==authSession?.user?.id||request!==historyLoadGeneration||chatBusy)return;
    clearChatConversation();savedChatThread={id:thread.id,title:thread.title,owner};
    for(const message of messages){
      if(!['user','assistant'].includes(message.role))continue;
      const bubble=appendText($('chat'),'div','','bubble '+(message.role==='user'?'user':'assistant'));bubble.dir='auto';
      if(message.role==='assistant')appendWithRefs(bubble,message.content);else bubble.textContent=message.content;
      chatHistory.push({role:message.role,text:message.content});
    }
    if(chatHistory.length>16)chatHistory.splice(0,chatHistory.length-16);
    $('chatHistoryList').hidden=true;showScreen('ask');setChatSaveStatus('Conversation saved');$('askInput').focus();
  }catch(e){if(owner===authSession?.user?.id&&epoch===savedChatEpoch)toast('Could not open this conversation. Please try again.');}
}
