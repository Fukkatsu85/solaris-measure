const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safeId=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
function metrics(poly,lat,cropHalfMeters=42){
  const size=Number(cropHalfMeters)*2;
  const k=Math.cos(Number(lat)*Math.PI/180);
  const pts=poly.map(p=>({x:Number(p.x)*size*k,y:Number(p.y)*size*k}));
  let area2=0,perim=0;const edges=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];
    area2+=a.x*b.y-b.x*a.y;
    const m=Math.hypot(b.x-a.x,b.y-a.y);perim+=m;
    edges.push({index:i+1,meters:+m.toFixed(3),feet:+(m*3.280839895).toFixed(2)});
  }
  const areaM2=Math.abs(area2)/2,areaFt2=areaM2*10.763910417;
  return {
    planAreaM2:+areaM2.toFixed(2),
    planAreaFt2:+areaFt2.toFixed(1),
    planSquares:+(areaFt2/100).toFixed(2),
    perimeterM:+perim.toFixed(2),
    perimeterFt:+(perim*3.280839895).toFixed(1),
    edges,
    scaleCorrection:+k.toFixed(6)
  };
}
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safeId(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 const o=await env.MEASURE_PHOTOS.get(id+"/_roof_outline_accepted.json");
 if(!o)return json({outline:null});
 return json({outline:JSON.parse(await o.text())});
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const b=await request.json().catch(()=>({}));
 const poly=Array.isArray(b.polygon)?b.polygon:[];
 if(poly.length<3)return json({error:"At least 3 polygon points are required."},400);
 const lat=Number(b.lat),lng=Number(b.lng),cropHalfMeters=Number(b.cropHalfMeters||42);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:"lat/lng required"},400);
 if(!poly.every(p=>Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))))return json({error:"Invalid polygon"},400);
 const projectId=safeId(b.projectId||("roof-"+lat.toFixed(6)+"-"+lng.toFixed(6)));
 const measurement=metrics(poly,lat,cropHalfMeters);
 const outline={
   projectId,address:b.address||"",lat,lng,
   imageryLayer:b.imageryLayer||"",imageryLabel:b.imageryLabel||"",
   projection:b.projection||"EPSG:3857",cropHalfMeters,
   polygon:poly.map(p=>({x:+Number(p.x).toFixed(7),y:+Number(p.y).toFixed(7)})),
   pointCount:poly.length,
   acceptedAt:new Date().toISOString(),
   measurement,
   status:"accepted-plan-view"
 };
 await env.MEASURE_PHOTOS.put(projectId+"/_roof_outline_accepted.json",JSON.stringify(outline),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,outline});
}