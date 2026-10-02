const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safeId=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safeId(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 const o=await env.MEASURE_PHOTOS.get(id+"/_google_solar_roof_model.json");
 if(!o)return json({model:null});
 return json({model:JSON.parse(await o.text())});
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const b=await request.json().catch(()=>({})),id=safeId(b.projectId);
 if(!id)return json({error:"projectId is required"},400);
 if(!b.model||typeof b.model!=="object")return json({error:"model is required"},400);
 const data={projectId:id,address:String(b.address||""),accepted:Boolean(b.accepted),savedAt:new Date().toISOString(),...b.model};
 await env.MEASURE_PHOTOS.put(id+"/_google_solar_roof_model.json",JSON.stringify(data),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,model:data});
}