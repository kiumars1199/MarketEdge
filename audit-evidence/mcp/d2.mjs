const W="http://localhost:3161", SB="http://localhost:3160/e2e-mock/supabase";
const b64u=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const email=`audit4-d2-${Date.now()}@example.com`;
await fetch(`${SB}/auth/v1/otp`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
const {url}=await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
const s=await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({auth_code:new URL(url).searchParams.get("code")})})).json();
const svc={apikey:"e2e-service",authorization:"Bearer e2e-service","content-type":"application/json"};
await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify({tier:process.argv[2]??"premium",status:"active"})});
const tok=`${b64u({alg:"none",typ:"JWT"})}.${b64u({sub:s.user.id,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600,client_id:"c"})}.mock`;
const cookie=`sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;
async function mcp(name,args){const r=await fetch(`${W}/api/mcp`,{method:"POST",headers:{authorization:`Bearer ${tok}`,"content-type":"application/json",accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})});const t=await r.text();return JSON.parse(t.split("\n").find(l=>l.startsWith("data:")).slice(5)).result.content[0].text;}
for (const [label,args,qs] of [["best_bets default",{limit:25},"ps=25&g=0"],["best_bets tier all, sports",{limit:25,tier:"all",categories:["sports"]},"ps=25&g=0&tier=all&c=sports"],["search bitcoin",null,"q=bitcoin&ps=25&g=0"]]){
  const text= args? await mcp("best_bets",args): await mcp("search_markets",{query:"bitcoin",limit:25});
  const ids=[...text.matchAll(/\/m\/([^\s]+)/g)].map(m=>m[1]);
  const path= args? "/api/flags":"/api/markets";
  const api=await (await fetch(`${W}${path}?${qs}`,{headers:{cookie}})).json();
  const aids=api.rows.map(r=>r.market.id);
  console.log(`${process.argv[2]??"premium"} ${label}: mcp ${ids.length} rows, ${path}?${qs} ${aids.length} rows, same ids in same order: ${JSON.stringify(ids)===JSON.stringify(aids)}; mcp total line: ${text.split("\n")[2]} | api total ${api.total}`);
  if (JSON.stringify(ids)!==JSON.stringify(aids)) console.log("  mcp",ids.slice(0,8).join(","),"\n  api",aids.slice(0,8).join(","));
}
const api=await (await fetch(`${W}/api/markets/6674492`,{headers:{cookie}})).json();
console.log("execution.best_ask",api.market.execution?.best_ask,"best.ask",api.market.best.ask);
