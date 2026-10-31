const DAY=86400000;
const STOP=new Set(['之前','以前','记得','记忆','什么','怎么','那个','这个','我们','你们','他们','她们','一下','一些','是否','可以','时候','最近','说过','提过','提到','帮我','查询','检索','还有','的是','的事','了吗','了吧','the','and','that','this','with','about']);
export function tokenize(value){
 const text=String(value||'').normalize('NFKC').toLowerCase(),out=[];
 for(const chunk of text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]+/g)||[]){
  if(/^[a-z0-9_]/.test(chunk)){if(!STOP.has(chunk))out.push(chunk);continue;}
  for(let i=0;i<chunk.length-1;i++){const word=chunk.slice(i,i+2);if(!STOP.has(word))out.push(word);}
 }
 return out.slice(0,8000);
}
export function timestamp(value){
 if(!value)return null;
 const n=typeof value==='string'&&!/^\d+(\.\d+)?$/.test(value)?Date.parse(value):Number(value);
 return Number.isFinite(n)&&n>0?(n<1e11?n*1000:n):null;
}
export function retention(item,now){
 if(item.layer==='important')return 1;
 const at=timestamp(item.at);if(!at)return .6;
 const half=item.layer==='short'?7:30;
 // Ranking only: never erase records or make old evidence impossible to find.
 return .35+.65*Math.pow(.5,Math.max(0,now-at)/(half*DAY));
}
function excerpt(text,queryTerms,budget){
 if(budget<=0)return {text:'',truncated:true};
 if(text.length<=budget)return {text,truncated:false};
 const lower=text.toLowerCase(),hits=queryTerms.map(t=>lower.indexOf(t)).filter(x=>x>=0);
 const start=Math.max(0,(hits.length?Math.min(...hits):0)-100);
 return {text:(start?'…':'')+text.slice(start,start+budget-(start?1:0)),truncated:true};
}
export function rankMemory(items,query,{limit=4,now=Date.now(),characters=4000}={}){
 const terms=[...new Set(tokenize(query))].slice(0,80);if(!terms.length)return {items:[],reason:'Use specific keywords'};
 const unique=new Map();
 for(const x of items){if(!x.text)continue;const key=x.text.normalize('NFKC').trim();const prev=unique.get(key);if(!prev||x.layer==='important'||(x.at||0)>(prev.at||0)&&prev.layer!=='important')unique.set(key,x);}
 const docs=[...unique.values()].map(item=>{const words=tokenize((item.topicKey||'')+' '+item.text),freq=new Map();for(const t of words)freq.set(t,(freq.get(t)||0)+1);return {item,freq,len:words.length||1};});
 const avg=docs.reduce((n,d)=>n+d.len,0)/(docs.length||1),df=new Map(terms.map(t=>[t,docs.filter(d=>d.freq.has(t)).length]));
 const scored=docs.map(({item,freq,len})=>{
  let lexical=0,matched=0;
  for(const term of terms){const tf=freq.get(term)||0;if(!tf)continue;matched++;const idf=Math.log(1+(docs.length-df.get(term)+.5)/(df.get(term)+.5));lexical+=idf*(tf*2.2)/(tf+1.2*(.25+.75*len/avg));}
  if(!matched)return null;
  const exact=item.text.toLowerCase().includes(query.trim().toLowerCase())?1.3:1;
  const evidence=item.layer==='important'?1.7:item.source==='legacy_summary'?.55:1;
  return {...item,score:lexical*(.5+.5*matched/terms.length)*exact*evidence*retention(item,now),match:'keyword',decay:retention(item,now)};
 }).filter(Boolean).sort((a,b)=>b.score-a.score||(b.at||0)-(a.at||0));
 const chosen=scored.slice(0,limit);
 // A small association step: one adjacent public message from the same scoped
 // transcript, never another person's memory or a chain of inferred facts.
 if(chosen.length&&chosen.length<limit){
  const anchor=chosen.find(x=>x.source==='native_record');
  if(anchor){
   const neighbour=items.filter(x=>x.source==='native_record'&&Math.abs(x.recordIndex-anchor.recordIndex)===1&&x.at&&anchor.at&&Math.abs(x.at-anchor.at)<=120000&&!chosen.some(y=>y.id===x.id)).sort((a,b)=>Math.abs(a.recordIndex-anchor.recordIndex)-Math.abs(b.recordIndex-anchor.recordIndex))[0];
   if(neighbour)chosen.push({...neighbour,match:'adjacent_context',linkedTo:anchor.id,score:0,decay:retention(neighbour,now)});
  }
 }
 let remaining=characters;
 return {items:chosen.map(({recordIndex,topicKey,score,decay,...x})=>{
  const part=excerpt(x.text,terms,Math.min(1000,remaining));remaining-=part.text.length;
  return {...x,...part,retentionWeight:Math.round(decay*1000)/1000};
 }).filter(x=>x.text),matched:scored.length,hasMore:scored.length>limit};
}
