// Seeds users on the mock (:3160) and writes Playwright storage states for the wired prod build (:3161).
import fs from "fs";
const SB="http://localhost:3160/e2e-mock/supabase", SERVICE="e2e-service", RUN=Date.now();
const svc={apikey:SERVICE,authorization:`Bearer ${SERVICE}`,"content-type":"application/json"};
async function seed(email, sub){
  await fetch(`${SB}/auth/v1/otp`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
  const {url}=await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
  const s=await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({auth_code:new URL(url).searchParams.get("code")})})).json();
  if (sub) await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify(sub)});
  const t=new Date().toISOString();
  await fetch(`${SB}/rest/v1/profiles?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify({accepted_terms_at:t,onboarded_at:t,first_bets_at:t})});
  return s;
}
const plans={free:[`audit4-st-free-${RUN}@example.com`,null],pro:[`audit4-st-pro-${RUN}@example.com`,{tier:"pro",status:"active"}],premium:[`audit4-st-prem-${RUN}@example.com`,{tier:"premium",status:"active"}],beta:[`audit4-st-beta-${RUN}@example.com`,{comp_tier:"premium",comp_expires_at:new Date(Date.now()+864e5).toISOString()}],admin:["audit4-admin@example.com",null]};
for (const [k,[email,sub]] of Object.entries(plans)){
  const s=await seed(email,sub);
  const value=`base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;
  fs.writeFileSync(`states/${k}.json`,JSON.stringify({cookies:[{name:"sb-localhost-auth-token",value,domain:"localhost",path:"/",expires:-1,httpOnly:false,secure:false,sameSite:"Lax"}],origins:[]}));
  const me=await (await fetch("http://localhost:3161/api/me",{headers:{cookie:`sb-localhost-auth-token=${value}`}})).json();
  console.log(k, JSON.stringify(me).slice(0,200));
}
