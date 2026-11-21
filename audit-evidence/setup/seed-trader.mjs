const SB="http://localhost:3160/e2e-mock/supabase";const email="audit4-premium@example.com";
await fetch(`${SB}/auth/v1/otp`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
const {url}=await (await fetch(`${SB}/_inbox?email=${encodeURIComponent(email)}`)).json();
const s=await (await fetch(`${SB}/auth/v1/token?grant_type=pkce`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({auth_code:new URL(url).searchParams.get("code")})})).json();
const svc={apikey:"e2e-service",authorization:"Bearer e2e-service","content-type":"application/json"};
await fetch(`${SB}/rest/v1/subscriptions?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify({tier:"premium",status:"active"})});
const t=new Date().toISOString();await fetch(`${SB}/rest/v1/profiles?user_id=eq.${s.user.id}`,{method:"PATCH",headers:svc,body:JSON.stringify({accepted_terms_at:t,onboarded_at:t,first_bets_at:t})});
console.log(`sb-localhost-auth-token=base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`);
