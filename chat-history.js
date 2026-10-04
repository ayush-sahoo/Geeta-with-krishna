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
  const account=document.getElementById('accountChats');
  if(account)account.hidden=!authSession?.user?.id;
}
// Deletes every saved conversation of the signed-in user (rows are the user's
// own under RLS). Waits for in-flight saves so none lands after the delete.
async function deleteSavedChats(){
  const owner=authSession?.user?.id;if(!owner)return;
  if(!confirm('Delete all your saved conversations with Krishna? This cannot be undone.'))return;
  const button=$('deleteChatsBtn');button.disabled=true;
  // Clearing first stops saves of the current conversation (they belong to the
  // old epoch). The delete then runs in the save queue, so a message sent while
  // it runs is saved after it, never half-deleted with it. One request: deleting
  // the conversations removes their messages too (on delete cascade), all or nothing.
  clearChatConversation();
  const run=savedChatQueue.catch(()=>{}).then(()=>chatStoreRequest('chat_threads?user_id=eq.'+encodeURIComponent(owner),{method:'DELETE'},owner));
  savedChatQueue=run.catch(()=>{});
  try{await run;toast('Your chat history has been deleted.');}
  catch(e){toast('Could not delete your chat history. Please try again.');}
  finally{button.disabled=false;}
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
  $('chat').before(controls,list);
  const remove=document.getElementById('deleteChatsBtn');if(remove)remove.onclick=deleteSavedChats;
  updateChatHistoryUI();
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
function savedChatDateLabel(value){
  const date=new Date(value),today=new Date(),yesterday=new Date();
  yesterday.setDate(today.getDate()-1);
  if(date.toDateString()===today.toDateString())return 'Today';
  if(date.toDateString()===yesterday.toDateString())return 'Yesterday';
  return date.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
async function loadSavedChatList(offset=0){
  const owner=authSession?.user?.id,epoch=savedChatEpoch,request=++historyLoadGeneration;
  if(!owner)return;
  const list=$('chatHistoryList');
  if(!offset){list.dataset.dateLabel='';list.replaceChildren();appendText(list,'p','Loading conversations…');}
  const current=()=>owner===authSession?.user?.id&&epoch===savedChatEpoch&&request===historyLoadGeneration;
  try{
    const response=await chatStoreRequest('chat_threads?select=id,title,updated_at&user_id=eq.'+encodeURIComponent(owner)+'&order=updated_at.desc,id.desc&limit=50&offset='+offset,{method:'GET'},owner);
    const threads=await response.json();if(!current())return;
    if(!offset){
      list.replaceChildren();
      appendText(list,'h3','Your conversations','history-list-title');
      appendText(list,'p','Pick a conversation to continue where you left off.','history-list-intro');
      if(!threads.length)appendText(list,'p','Your saved conversations will appear here.');
    }
    for(const thread of threads){
      const label=savedChatDateLabel(thread.updated_at);
      if(list.dataset.dateLabel!==label){appendText(list,'h4',label,'history-date-label');list.dataset.dateLabel=label;}
      const button=appendText(list,'button','','saved-chat-item');button.type='button';button.onclick=()=>openSavedChat(thread);
      appendText(button,'span',thread.title||'Conversation with Krishna','history-chat-title');
      appendText(button,'small',new Date(thread.updated_at).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'}),'history-chat-time');
      appendText(button,'span','Continue →','history-chat-continue');
    }
    if(threads.length===50){
      const more=appendText(list,'button','Show older conversations','history-button history-load-more');more.type='button';
      more.onclick=async()=>{more.disabled=true;more.remove();await loadSavedChatList(offset+50);};
    }
  }catch(e){
    if(current()){
      if(!offset)list.replaceChildren();
      appendText(list,'p','Could not load history. Please try again.');
      const retry=appendText(list,'button','Retry','history-button');retry.onclick=()=>loadSavedChatList(offset);
    }
  }
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
