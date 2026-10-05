const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safeId=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safeId(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 const o=await env.MEASURE_PHOTOS.get(id+"/_roof_planes.json");
 if(!o)return json({planes:null});
 return json({planes:JSON.parse(await o.text())});
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const b=await request.json().catch(()=>({})),id=safeId(b.projectId);
 if(!id)return json({error:"projectId is required"},400);
 const planes=Array.isArray(b.planes)?b.planes:[];
 const clean=planes.map((p,i)=>({
  id:p.id||("facet-"+(i+1)),
  accepted:p.accepted!==false,
  pointCount:Number(p.pointCount||0),
  pitch12:+Number(p.pitch12||0).toFixed(2),
  slopeDeg:+Number(p.slopeDeg||0).toFixed(2),
  azimuthDeg:+Number(p.azimuthDeg||0).toFixed(1),
  rmse:+Number(p.rmse||0).toFixed(3),
  originX:Number.isFinite(Number(p.originX))?Number(p.originX):null,
  originY:Number.isFinite(Number(p.originY))?Number(p.originY):null,
  mercatorGroundScale:Number.isFinite(Number(p.mercatorGroundScale))?Number(p.mercatorGroundScale):null,
  coefficients:{a:+Number(p.coefficients?.a||0).toFixed(8),b:+Number(p.coefficients?.b||0).toFixed(8),c:+Number(p.coefficients?.c||0).toFixed(5)},
  bounds:p.bounds||null,
  polygon:Array.isArray(p.polygon)?p.polygon.map(q=>({x:+Number(q.x).toFixed(7),y:+Number(q.y).toFixed(7)})):[],
  planAreaFt2:+Number(p.planAreaFt2||0).toFixed(1),
  slopedAreaFt2:+Number(p.slopedAreaFt2||0).toFixed(1)
 }));
 const result={projectId:id,address:b.address||"",planes:clean,acceptedCount:clean.filter(p=>p.accepted).length,savedAt:new Date().toISOString(),status:"accepted-lidar-planes"};
 await env.MEASURE_PHOTOS.put(id+"/_roof_planes.json",JSON.stringify(result),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,planes:result});
}