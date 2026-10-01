const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,80);
async function read(env,key,fallback){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return fallback;try{return JSON.parse(await o.text())}catch{return fallback}}
export async function onRequestGet({request,env}){const id=safe(new URL(request.url).searchParams.get("projectId"));return json({calibration:id?await read(env,id+"/_calibration.json",null):null});}
export async function onRequestPost({request,env}){const b=await request.json().catch(()=>({})),id=safe(b.projectId),photoKey=String(b.photoKey||""),feet=Number(b.feet),p1=b.p1||{},p2=b.p2||{};
 if(!id||!photoKey||!Number.isFinite(feet)||feet<=0||![p1.x,p1.y,p2.x,p2.y].every(v=>Number.isFinite(Number(v))))return json({error:"Invalid calibration"},400);
 const c=await read(env,id+"/_calibration.json",{references:[]});c.references||=[];c.references.push({id:crypto.randomUUID(),photoKey,feet,p1:{x:Number(p1.x),y:Number(p1.y)},p2:{x:Number(p2.x),y:Number(p2.y)},createdAt:new Date().toISOString()});c.updatedAt=new Date().toISOString();
 await env.MEASURE_PHOTOS.put(id+"/_calibration.json",JSON.stringify(c),{httpMetadata:{contentType:"application/json"}});return json({ok:true,calibration:c});}