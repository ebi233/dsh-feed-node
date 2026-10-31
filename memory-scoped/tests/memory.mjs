import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const h=mkdtempSync(join(tmpdir(),'scoped-memory-'));process.env.DSH_HOME=h;
globalThis.fetch=async()=>{throw Error('No network or models in memory tests')};
const save=(n,v)=>{mkdirSync(join(h,n,'..'),{recursive:true});writeFileSync(join(h,n),JSON.stringify(v));};
const conf={主人号码:'100001',私聊QQ:'100001',私聊会话:'session-owner',绑定:[{类型:'私聊',号码:'100001',会话:'session-owner'},{类型:'群',号码:'300001',会话:'session-group'}]};
save('qq-bridge-config.json',conf);save('guests.json',{'200001':{session:'session-guest',first:Date.now()-60000}});save('group-session-seals.json',{version:1,sessions:{'session-group':{group:'300001',sealedAt:new Date(Date.now()-60000).toISOString(),emptyHistoryVerified:true}}});
const actor=id=>({id,session:{header:{id},snapshotEvents:()=>[]}}),owner=actor('session-owner'),guest=actor('session-guest'),group=actor('session-group');
const now=Date.now(),day=86400000;let seq=0;
const event=(type,data,at=now-1000)=>({type,seq:++seq,time:new Date(at).toISOString(),data});
function turn(n,text,source='qq',kind='completed',at=now-1000){return [event('turn/start',{turn:n},at),event('user/message',{message:{source:{kind:source},content:[{type:'text',text}]}},at),event('assistant/message',{turn:n,message:{content:[{type:'reasoning',text:'HIDDEN_REASONING 香蕉'},{type:'text',text:kind==='completed'?'回应 '+text:'FAILED_REPLY_SECRET 香蕉'}]}},at),event('turn/end',{turn:n,reason:{kind}},at)];}
const path=sid=>join(h,'sessions','workspace',sid,'session.v4.jsonl');
function store(sid,ev){const p=path(sid);mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,[{type:'session',version:4,id:sid},...ev].map(x=>JSON.stringify(x)).join('\n')+'\n');}
store('session-owner',[...turn(1,'SEED_PRIVATE 香蕉','user'),...turn(2,'OWNER_PRIVATE 香蕉'),...Array.from({length:2100},()=>event('tool/result',{message:{content:[{type:'text',text:'TOOL_PRIVATE 香蕉'}]}})),...turn(3,'香蕉新消息'),...turn(4,'FAIL_PRIVATE 香蕉','qq','error'),...turn(5,'很久以前的望远镜','qq','completed',now-60*day),...turn(6,'HTTP_BRIDGE 香蕉','user')]);
store('session-guest',[...turn(1,'SEED_PRIVATE 苹果','user','completed',now-day),...turn(2,'GUEST_PRIVATE苹果','user')]);store('session-group',turn(1,'GROUP_PUBLIC西瓜','user'));
writeFileSync(join(h,'memory-long.md'),'- 永久香蕉事实\n- 已被纠正的香蕉偏好\n');
const key='owner:100001:session-owner',digest=x=>createHash('sha256').update(x).digest('hex');
save('conversation-notes/'+digest(key)+'.json',{version:1,scope:key,superseded:[digest('- 已被纠正的香蕉偏好')],items:[{id:'fact',kind:'fact',key:'favorite fruit',text:'香蕉明确事实',confidence:'explicit',updatedAt:now-90*day,expiresAt:now+day,evidence:{quote:'我喜欢香蕉'}},{id:'expired',kind:'fact',text:'香蕉过期事实',confidence:'explicit',updatedAt:now-day,expiresAt:now-1},{id:'closed',kind:'topic',text:'香蕉已结束话题',updatedAt:now-day,expiresAt:now+day,status:'closed'}]});
const {markPromptGuardReady}=await import('../lib/group-privacy.mjs');markPromptGuardReady(()=>true);
const {recallConversation}=await import('../lib/memory-read.mjs');
let r=await recallConversation(owner,{query:'OWNER_PRIVATE',layer:'records'},now);assert(r.historyRead);assert(JSON.stringify(r).includes('OWNER_PRIVATE'));assert(r.historyMessages>=6); // earlier than last 2000 events
assert.doesNotMatch(JSON.stringify(await recallConversation(owner,{query:'香蕉',limit:6},now)),/SEED_PRIVATE|HIDDEN_REASONING|TOOL_PRIVATE|FAILED_REPLY_SECRET|GUEST_PRIVATE|GROUP_PUBLIC/);
assert((await recallConversation(owner,{query:'HTTP_BRIDGE'},now)).items.some(x=>x.origin==='local_or_bridge'));
assert.equal((await recallConversation(owner,{query:'望远镜',layer:'short'},now)).items.length,0);
assert((await recallConversation(owner,{query:'望远镜',layer:'records'},now)).items.length>0);
r=await recallConversation(owner,{query:'香蕉',layer:'important'},now);assert(r.items.some(x=>x.source==='evidence_note'&&x.retentionWeight===1));assert.doesNotMatch(JSON.stringify(r),/过期事实|被纠正|已结束/);assert.equal(r.historyRead,false);
for(const [a,query,allowed] of [[owner,'OWNER_PRIVATE','OWNER_PRIVATE'],[guest,'GUEST_PRIVATE','GUEST_PRIVATE'],[group,'GROUP_PUBLIC','GROUP_PUBLIC']]){
 const result=await recallConversation(a,{query,session:'session-owner',path:'/not/allowed',limit:6},now);
 assert(JSON.stringify(result).includes(allowed));assert(!result.items.some(x=>x.text.includes(a===owner?'GUEST_PRIVATE':'OWNER_PRIVATE')));
}
await assert.rejects(()=>recallConversation(actor('session-unknown'),{query:'香蕉'},now));
for(const args of [{limit:1.5},{limit:7},{days:0},{days:-1},{query:'a'},{layer:'global'}])await assert.rejects(()=>recallConversation(owner,{query:'香蕉',...args},now));
const before=readFileSync(join(h,'conversation-notes',digest(key)+'.json'));await recallConversation(owner,{query:'香蕉'},now);await recallConversation(owner,{query:'香蕉'},now);assert.deepEqual(readFileSync(join(h,'conversation-notes',digest(key)+'.json')),before);
const controller=new AbortController();controller.abort();await assert.rejects(()=>recallConversation(owner,{query:'香蕉'},now,controller.signal));
if(process.platform!=='win32'){
 const p=path('session-owner');renameSync(p,p+'.fixture');writeFileSync(p+'.zstd',execFileSync('zstd',['-q','-c',p+'.fixture']));assert((await recallConversation(owner,{query:'OWNER_PRIVATE'},now)).historyRead);
 unlinkSync(p+'.zstd');symlinkSync(p+'.fixture',p+'.zstd');await assert.rejects(()=>recallConversation(owner,{query:'香蕉'},now),/INVALID_SESSION_PATH/);unlinkSync(p+'.zstd');renameSync(p+'.fixture',p);
}
// A binding change during asynchronous disk access must not release results.
const pending=recallConversation(owner,{query:'香蕉'},now);save('guests.json',{'200001':{session:'session-owner'}});await assert.rejects(()=>pending);save('guests.json',{'200001':{session:'session-guest'}});
const root=process.env.DSH_HOST_MODULES||'/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const {Context}=await import(root+'/cordis/lib/index.js'),{SystemPrompt}=await import(root+'/dsh-system-prompt/lib/index.js'),{ToolRuntime}=await import(root+'/dsh-tools/lib/index.js'),{assembleContextFor}=await import(root+'/dsh-agent/lib/index.js'),{bindScopeParent}=await import(root+'/dsh-scope/lib/index.js');
const {apply}=await import('../lib/index.js');
const ctx=new Context();await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native',maxParallelSubCalls:1});ctx.webServer={register:()=>()=>{}};
ctx.systemPrompt.section({name:'persona',order:0,complete:true,text:'PRIVATE_PERSONA\n【边界】UNCHANGED_BOUNDARY'});apply(ctx);
const signal=new AbortController().signal;
let assembled=JSON.stringify(await ctx.systemPrompt.assemble(assembleContextFor(owner,signal)));assert(assembled.includes('UNCHANGED_BOUNDARY'));assert(!/OWNER_PRIVATE|永久香蕉|香蕉明确事实/.test(assembled));
assembled=JSON.stringify(await ctx.systemPrompt.assemble(assembleContextFor(group,signal)));assert(!/PRIVATE_PERSONA|UNCHANGED_BOUNDARY|OWNER_PRIVATE|永久香蕉|香蕉明确事实/.test(assembled));
const run=a=>ctx.tools.execute({name:'conversation_recall',agent:a,arguments:{query:'香蕉'},signal,callId:'memory-test'});
assert.match(JSON.stringify(await run(owner)),/scoped-bm25-time-v1/);assert.doesNotMatch(JSON.stringify(await run(guest)),/OWNER_PRIVATE/);
const child={id:'session-child'};bindScopeParent(child,owner);assert.match(JSON.stringify(await run(child)),/directly bound/);
console.log('PASS native retrieval: old persisted events, ISO time, layered lookup, expired/corrected exclusion, private isolation, unknown/inherited denied, cancelled/racing requests, zstd, symlink rejection, no read reinforcement, native prompt/tool registration, unchanged boundary; modelCalls=0; QQSends=0');
