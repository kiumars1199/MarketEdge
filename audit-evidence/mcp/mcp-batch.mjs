// Run 4: both results of a JSON-RPC batch (invalid + valid) end with the disclaimer. Wired bd21cc6 on :3161, mock :3160.
import fs from "node:fs";
const W="http://localhost:3161", SB="http://localhost:3160/e2e-mock/supabase", SERVICE="e2e-service";
const DISC="Market analytics, not financial advice. Based on past results. 18+.";
const b64u=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const email=`audit4-batch-${Date.now()}@example.com`;
await fetch(`${SB}/auth/v1/otp`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
const {url}=await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
const s=await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({auth_code:new URL(url).searchParams.get("code")})})).json();
const svc={apikey:SERVICE,authorization:`Bearer ${SERVICE}`,"content-type":"application/json"};
await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify({tier:"premium",status:"active"})});
const t=new Date().toISOString();
await fetch(`${SB}/rest/v1/profiles?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify({accepted_terms_at:t,onboarded_at:t,first_bets_at:t})});
const tok=`${b64u({alg:"none",typ:"JWT"})}.${b64u({sub:s.user.id,email,role:"authenticated",aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600,client_id:"client-audit4",session_id:"s1"})}.mock`;
const batch=[{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"best_bets",arguments:{limit:0}}},{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"best_bets",arguments:{limit:1}}},{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"track_record",arguments:{}}}];
const r=await fetch(`${W}/api/mcp`,{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-06-18",authorization:`Bearer ${tok}`},body:JSON.stringify(batch)});
const body=await r.text();
let msgs; try{msgs=[JSON.parse(body)].flat();}catch{msgs=body.split("\n").filter(l=>l.startsWith("data:")).map(l=>JSON.parse(l.slice(5))).flat();}
const out=[`batch of 3 (best_bets limit 0, best_bets limit 1, track_record): http ${r.status} ${r.headers.get("content-type")}, ${msgs.length} responses`];
for(const m of msgs){const txt=(m.result?.content??[]).filter(c=>c.type==="text").map(c=>c.text).join("\n");out.push(`  id ${m.id}: isError=${!!m.result?.isError} ${txt.trimEnd().endsWith(DISC)?"ends-with-disclaimer":"NO-DISCLAIMER-AT-END"} | ${txt.split("\n")[0].slice(0,100)}`);}
fs.writeFileSync(process.argv[2],out.join("\n")+"\n");console.log(out.join("\n"));
