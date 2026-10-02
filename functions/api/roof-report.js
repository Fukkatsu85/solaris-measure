const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safeId=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
async function read(env,key){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safeId(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 const [outline,planes,geometry]=await Promise.all([
  read(env,id+"/_roof_outline_accepted.json"),
  read(env,id+"/_roof_planes.json"),
  read(env,id+"/_roof_geometry.json")
 ]);
 if(!outline)return json({error:"Accepted roof outline not found."},404);
 return json({ok:true,projectId:id,outline,planes,geometry});
}