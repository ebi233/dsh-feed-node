import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,existsSync,symlinkSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const h=mkdtempSync(join(tmpdir(),'assistant-friend-test-'));process.env.DSH_HOME=h;
globalThis.fetch=async()=>{throw Error('No network in tests')};
const save=(n,v)=>writeFileSync(join(h,n),JSON.stringify(v));
const owner={session:{header:{id:'session-owner'}}},guest={session:{header:{id:'session-friend'}}},group={session:{header:{id:'session-group'}}};
const conf={主人号码:'100001',私聊QQ:'100001',私聊会话:'session-owner',绑定:[{类型:'私聊',号码:'100001',会话:'session-owner'},{类型:'群',号码:'300001',会话:'session-group'}]};
let peers={'200001':{session:'session-friend',name:'星星'},'200002':{session:'session-other',name:'小云'}};
save('qq-bridge-config.json',conf);save('guests.json',peers);save('group-session-seals.json',{version:1,sessions:{'session-group':{group:'300001',emptyHistoryVerified:true}}});
const dir=join(h,'sessions','workspace','session-friend');mkdirSync(dir,{recursive:true});
const file=join(dir,'session.v4.jsonl');
let seq=0;const now=Date.now();
const e=(type,data)=>({type,seq:++seq,time:now-10000+seq,data});
const input=(kind,text)=>e('user/message',{message:{source:{kind},content:[{type:'text',text}]}});
const reply=(turn,text)=>e('assistant/message',{turn,message:{content:[{type:'reasoning',text:'HIDDEN_REASONING'},{type:'text',text}]}});
const start=n=>e('turn/start',{turn:n}),end=(n,kind='completed')=>e('turn/end',{turn:n,reason:{kind}});
const events=[{type:'session',version:4,id:'session-friend'},start(1),input('user','SEED_PRIVATE'),reply(1,'SEED_REPLY'),end(1),
 start(2),e('system/message',{text:'SYSTEM_PRIVATE'}),input('qq','我最近想学天文望远镜'),reply(2,'天文望远镜可以先看月球'),end(2),
 start(3),input('qq','今天看到了土星'),reply(3,'旧的中间答复'),reply(3,'土星的光环很漂亮'),end(3),
 start(4),input('user','MANUAL_PRIVATE'),reply(4,'MANUAL_REPLY'),end(4),
 start(5),input('qq','怎么选择镜片'),reply(5,'FAILED_REPLY'),end(5,'error'),
 start(6),input('qq','这个价格如何'),reply(6,'UNFINISHED_REPLY')];
const write=ev=>writeFileSync(file,ev.map(v=>JSON.stringify(v)).join('\n')+'\n');write(events);
const {recallFriend,projectFriendEvents,selectFriendMessages}=await import('../lib/friend-recall.mjs');
const {markPromptGuardReady}=await import('../lib/group-privacy.mjs');markPromptGuardReady(()=>true);
let result=await recallFriend(owner,{friend:'200001',limit:16});
assert.equal(result.peer.qq,'200001');assert.equal(result.items.length,6);
assert.doesNotMatch(JSON.stringify(result),/SEED_|SYSTEM_PRIVATE|HIDDEN_REASONING|MANUAL_|FAILED_REPLY|UNFINISHED_REPLY|旧的中间/);
assert.ok(result.items.every(x=>x.at&&Number.isInteger(x.seq)));
assert.ok(result.items.filter(x=>x.role==='assistant').every(x=>x.delivery==='generated_not_delivery_receipt'));
assert.equal((await recallFriend(owner,{friend:'星星'})).peer.qq,'200001');
for(const actor of [guest,group,{session:{header:{id:'session-unknown'}}}])await assert.rejects(()=>recallFriend(actor,{friend:'200001'}),/OWNER_PRIVATE_CHAT_ONLY/);
await assert.rejects(()=>recallFriend(owner,{friend:'100001'}),/FRIEND_NOT_REGISTERED/);
await assert.rejects(()=>recallFriend(owner,{friend:'../secret'}),/FRIEND_NOT_REGISTERED/);
peers['200002'].name='星星';save('guests.json',peers);await assert.rejects(()=>recallFriend(owner,{friend:'星星'}),/AMBIGUOUS_FRIEND/);
peers['200002'].name='小云';save('guests.json',peers);
let page=await recallFriend(owner,{friend:'200001',limit:2});assert.ok(page.hasMore);const seen=page.items.map(x=>x.seq);
let page2=await recallFriend(owner,{friend:'200001',limit:2,beforeSeq:page.nextBeforeSeq});assert.ok(page2.items.every(x=>!seen.includes(x.seq)));
result=await recallFriend(owner,{friend:'200001',query:'望远镜'});assert.ok(result.items.some(x=>x.text.includes('望远镜')));
assert.equal((await recallFriend(owner,{friend:'200001',query:'不存在的关键词'})).items.length,0);
for(const args of [{days:0},{days:91},{days:2.1},{limit:100},{query:'x'.repeat(81)},{beforeSeq:-1}])await assert.rejects(()=>recallFriend(owner,{friend:'200001',...args}),/INVALID_QUERY_RANGE/);
const long=projectFriendEvents(events,'session-friend').map(x=>({...x,text:'文'.repeat(10000)}));
assert.ok(selectFriendMessages(long,{limit:16}).items.reduce((s,x)=>s+x.text.length,0)<=6000);
const bad=structuredClone(events);bad[0].id='session-owner';write(bad);await assert.rejects(()=>recallFriend(owner,{friend:'200001'}),/INVALID_SESSION_HEADER/);write(events);
peers['200001'].session='session-owner';save('guests.json',peers);await assert.rejects(()=>recallFriend(owner,{friend:'200001'}),/OWNER_PRIVATE_CHAT_ONLY|INVALID_FRIEND_BINDING/);
peers['200001'].session='session-friend';save('guests.json',peers);
const racing=recallFriend(owner,{friend:'200001'});peers['200001'].session='session-other';save('guests.json',peers);
await assert.rejects(()=>racing,/INVALID_FRIEND_BINDING|BINDING_CHANGED/);peers['200001'].session='session-friend';save('guests.json',peers);
const otherDir=join(h,'sessions','second','session-friend');mkdirSync(otherDir,{recursive:true});writeFileSync(join(otherDir,'session.v4.jsonl'),JSON.stringify(events[0]));
await assert.rejects(()=>recallFriend(owner,{friend:'200001'}),/AMBIGUOUS_SESSION_FILES/);renameSync(join(otherDir,'session.v4.jsonl'),join(otherDir,'not-active.fixture'));
const cancel=new AbortController();cancel.abort();await assert.rejects(()=>recallFriend(owner,{friend:'200001'},cancel.signal));
if(process.platform!=='win32'){
 renameSync(file,file+'.plain-fixture');writeFileSync(file+'.zstd',execFileSync('zstd',['-q','-c',file+'.plain-fixture']));
 assert.equal((await recallFriend(owner,{friend:'200001',limit:16})).items.length,6,'actual zstd decompression');
 unlinkSync(file+'.zstd');symlinkSync(file+'.plain-fixture',file+'.zstd');await assert.rejects(()=>recallFriend(owner,{friend:'200001'}),/INVALID_SESSION_PATH/);unlinkSync(file+'.zstd');renameSync(file+'.plain-fixture',file);
}
const root=process.env.DSH_HOST_MODULES||'/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
if(existsSync(root)){
 const {Context}=await import(root+'/cordis/lib/index.js');const {SystemPrompt}=await import(root+'/dsh-system-prompt/lib/index.js');const {ToolRuntime}=await import(root+'/dsh-tools/lib/index.js');
 const {assembleContextFor}=await import(root+'/dsh-agent/lib/index.js');const {bindScopeParent}=await import(root+'/dsh-scope/lib/index.js');
 const {apply}=await import('../lib/index.js');
 const ctx=new Context();await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native',maxParallelSubCalls:1});ctx.webServer={register:()=>()=>{}};apply(ctx);
 const signal=new AbortController().signal;
 const run=actor=>ctx.tools.execute({name:'friend_conversation_recall',agent:actor,arguments:{friend:'200001'},signal,callId:'friend-test'});
 assert.match(JSON.stringify(await run(owner)),/天文望远镜/);
 for(const actor of [guest,group]){assert.equal((await run(actor)).isError,true);assert.ok(!(await ctx.systemPrompt.assemble(assembleContextFor(actor,signal))).tools.some(t=>t.name==='friend_conversation_recall'));}
 assert.ok((await ctx.systemPrompt.assemble(assembleContextFor(owner,signal))).tools.some(t=>t.name==='friend_conversation_recall'));
 const child={id:'session-child'};bindScopeParent(child,owner);assert.match(JSON.stringify(await run(child)),/OWNER_PRIVATE_CHAT_ONLY/);
 console.log('PASS native tool runtime: owner registration, guest/group hidden and denied, inherited owner denied');
}
console.log('PASS friend recall: exact peer binding, QQ/name lookup, ambiguity, projection, time/query/paging bounds, no hidden/seed/failed replies, header/path validation and cancellation; QQSends=0');
