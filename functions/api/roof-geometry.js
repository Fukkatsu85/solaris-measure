const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safeId=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safeId(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 const o=await env.MEASURE_PHOTOS.get(id+"/_roof_geometry.json");
 if(!o)return json({geometry:null});
 return json({geometry:JSON.parse(await o.text())});
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const b=await request.json().catch(()=>({})),id=safeId(b.projectId);
 if(!id)return json({error:"projectId is required"},400);
 const lines=Array.isArray(b.lines)?b.lines:[];
 const allowed=new Set(["ridge","hip","valley","ignore","candidate"]);
 const clean=lines.filter(l=>l&&l.a&&l.b).map((l,i)=>({
   id:l.id||("line-"+(i+1)),
   type:allowed.has(l.type)?l.type:"candidate",
   a:{x:+Number(l.a.x).toFixed(7),y:+Number(l.a.y).toFixed(7)},
   b:{x:+Number(l.b.x).toFixed(7),y:+Number(l.b.y).toFixed(7)},
   score:Number.isFinite(+l.score)?+Number(l.score).toFixed(3):null
 }));
 const geometry={projectId:id,address:b.address||"",lines:clean,defaultPitch:Number(b.defaultPitch||4),savedAt:new Date().toISOString(),status:"reviewed-lines"};
 await env.MEASURE_PHOTOS.put(id+"/_roof_geometry.json",JSON.stringify(geometry),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,geometry});
}