// Drive N turns through the real client in the Chromium cdp.mjs started
// (port 9333) and sample the Host's RSS and CPU per turn.
// Usage: node turns.mjs <client url with ?token=> <host pid> <turns>
import { execSync } from 'node:child_process';
const [,, url, hostPid, nTurns] = process.argv;
const rss=()=>Math.round(Number(execSync(`ps -o rss= -p ${hostPid}`).toString().trim())/1024);
const cpu=()=>execSync(`ps -o time= -p ${hostPid}`).toString().trim();
const t = await (await fetch('http://127.0.0.1:9333/json/new?about:blank',{method:'PUT'})).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id=0; const pend=new Map();
ws.onmessage=(m)=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
const ev=async(e)=>(await send('Runtime.evaluate',{expression:e,returnByValue:true}))?.result?.value;
await new Promise(r=>ws.onopen=r); await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate',{url});
for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100)); if(await ev("!!document.querySelector('textarea,[contenteditable=true]')"))break;}
console.log('client loaded; host rss MB', rss(), 'cpu', cpu());
const count=()=>ev("(document.body.innerText.match(/consectetur/g)||[]).length");
let peak=0;
for(let k=1;k<=Number(nTurns);k++){
  const before=await count();
  await ev("(()=>{const el=document.querySelector('textarea,[contenteditable=true]'); el.focus(); return true})()");
  await send('Input.insertText',{text:'turn '+k+' please write a long answer'});
  await new Promise(r=>setTimeout(r,200));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  const t0=Date.now(); let last=-1, stable=0;
  while(Date.now()-t0<30000){ await new Promise(r=>setTimeout(r,250)); peak=Math.max(peak,rss()); const c=await count(); if(c>before && c===last){ if(++stable>=6) break;} else stable=0; last=c; }
  console.log(`turn ${k}: done in ${Date.now()-t0}ms, mentions ${await count()}, host rss MB ${rss()}, peak ${peak}, cpu ${cpu()}`);
}
const txt=await ev("document.body.innerText.slice(0,300)"); console.log(txt.replace(/\s+/g,' '));
process.exit(0);
