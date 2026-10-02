const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
const R=6378137;
const merc=(lat,lng)=>({x:R*Number(lng)*Math.PI/180,y:R*Math.log(Math.tan(Math.PI/4+Number(lat)*Math.PI/360))});
function groundMetrics(poly){
 if(!Array.isArray(poly)||poly.length<3)return null;
 const lat0=poly.reduce((s,p)=>s+Number(p.lat),0)/poly.length;
 const lng0=poly.reduce((s,p)=>s+Number(p.lng),0)/poly.length;
 const cos=Math.max(.2,Math.cos(lat0*Math.PI/180));
 const pts=poly.map(p=>({x:(Number(p.lng)-lng0)*111320*cos,y:(Number(p.lat)-lat0)*111320}));
 let a2=0,per=0;const edges=[];
 for(let i=0;i<pts.length;i++){
  const a=pts[i],b=pts[(i+1)%pts.length],m=Math.hypot(b.x-a.x,b.y-a.y);
  a2+=a.x*b.y-b.x*a.y;per+=m;edges.push({index:i+1,meters:+m.toFixed(3),feet:+(m*3.280839895).toFixed(2)});
 }
 const areaM2=Math.abs(a2)/2,areaFt2=areaM2*10.763910417;
 return {planAreaM2:+areaM2.toFixed(2),planAreaFt2:+areaFt2.toFixed(1),planSquares:+(areaFt2/100).toFixed(2),perimeterM:+per.toFixed(2),perimeterFt:+(per*3.280839895).toFixed(1),edges};
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const b=await request.json().catch(()=>({})),id=safe(b.projectId),lat=Number(b.lat),lng=Number(b.lng),outline=Array.isArray(b.outline)?b.outline:[];
 if(!id||!Number.isFinite(lat)||!Number.isFinite(lng)||outline.length<3)return json({error:"projectId, lat/lng and outline are required."},400);
 if(!outline.every(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))))return json({error:"Invalid lat/lng outline."},400);
 const half=Number(b.cropHalfMeters||42),center=merc(lat,lng),size=half*2;
 const polygon=outline.map(p=>{const m=merc(p.lat,p.lng);return{x:+(.5+(m.x-center.x)/size).toFixed(7),y:+(.5-(m.y-center.y)/size).toFixed(7)}});
 const measurement=groundMetrics(outline);
 const record={projectId:id,address:String(b.address||""),lat,lng,imageryLayer:"google-solar-mask",imageryLabel:"Google Solar DSM/mask training bootstrap",projection:"EPSG:3857",cropHalfMeters:half,polygon,latLngOutline:outline.map(p=>({lat:+Number(p.lat).toFixed(8),lng:+Number(p.lng).toFixed(8)})),pointCount:polygon.length,acceptedAt:new Date().toISOString(),measurement,status:"training-auto-dsm"};
 await env.MEASURE_PHOTOS.put(id+"/_roof_outline_accepted.json",JSON.stringify(record),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,outline:record});
}