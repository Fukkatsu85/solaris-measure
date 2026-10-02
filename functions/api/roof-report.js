const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safeId=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
async function read(env,key){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
async function solarCrosscheck(env,outline,planes){
 const lat=Number(outline?.lat),lng=Number(outline?.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return {available:false,error:"Roof coordinates are missing."};
 const key=env.GOOGLE_MAPS_BACKEND_KEY||env.GOOGLE_MAPS_API_KEY||env.GOOGLE_MAPS_BROWSER_KEY||"";
 if(!key)return {available:false,error:"Google Solar key is not configured."};
 const api=new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
 api.searchParams.set("location.latitude",String(lat));api.searchParams.set("location.longitude",String(lng));api.searchParams.set("requiredQuality","BASE");api.searchParams.set("key",key);
 try{
  const r=await fetch(api.toString(),{headers:{Accept:"application/json"}}),d=await r.json().catch(()=>({}));
  if(!r.ok)return {available:false,error:d?.error?.message||"Google Solar Building Insights unavailable.",status:r.status};
  const stats=d.solarPotential?.wholeRoofStats||{},segments=Array.isArray(d.solarPotential?.roofSegmentStats)?d.solarPotential.roofSegmentStats:[];
  const googleAreaM2=Number(stats.areaMeters2),googleAreaFt2=Number.isFinite(googleAreaM2)?googleAreaM2*10.7639104167:null;
  const accepted=(planes?.planes||[]).filter(p=>p.accepted);
  const solarSegments=segments.map((s,i)=>({
   id:i+1,pitchDegrees:Number(s.pitchDegrees),azimuthDegrees:Number(s.azimuthDegrees),
   areaFt2:Number.isFinite(Number(s.stats?.areaMeters2))?Number(s.stats.areaMeters2)*10.7639104167:null,
   groundAreaFt2:Number.isFinite(Number(s.stats?.groundAreaMeters2))?Number(s.stats.groundAreaMeters2)*10.7639104167:null,
   center:s.center||null
  }));
  const solarPitchWeights=solarSegments.filter(s=>Number.isFinite(s.pitchDegrees)&&Number.isFinite(s.areaFt2)&&s.areaFt2>0);
  const googlePitch=solarPitchWeights.length?solarPitchWeights.reduce((a,s)=>a+s.pitchDegrees*s.areaFt2,0)/solarPitchWeights.reduce((a,s)=>a+s.areaFt2,0):null;
  const lidarWeights=accepted.filter(p=>Number.isFinite(Number(p.slopeDeg))&&Number.isFinite(Number(p.slopedAreaFt2))&&Number(p.slopedAreaFt2)>0);
  const lidarPitch=lidarWeights.length?lidarWeights.reduce((a,p)=>a+Number(p.slopeDeg)*Number(p.slopedAreaFt2),0)/lidarWeights.reduce((a,p)=>a+Number(p.slopedAreaFt2),0):null;
  const lidarArea=accepted.reduce((a,p)=>a+Number(p.slopedAreaFt2||0),0);
  const areaDifferencePct=googleAreaFt2&&lidarArea?100*Math.abs(lidarArea-googleAreaFt2)/googleAreaFt2:null;
  const pitchDifferenceDeg=Number.isFinite(googlePitch)&&Number.isFinite(lidarPitch)?Math.abs(lidarPitch-googlePitch):null;
  const warnings=[];
  if(Number.isFinite(areaDifferencePct)&&areaDifferencePct>8)warnings.push("LiDAR/report area differs from Google Solar whole-roof area by "+areaDifferencePct.toFixed(1)+"%.");
  if(Number.isFinite(pitchDifferenceDeg)&&pitchDifferenceDeg>3)warnings.push("Weighted average pitch differs from Google Solar by "+pitchDifferenceDeg.toFixed(1)+"°.");
  if(accepted.length&&solarSegments.length&&Math.abs(accepted.length-solarSegments.length)>=2)warnings.push("Facet count differs materially between LiDAR planes and Google Solar segments.");
  return {
   available:true,imageryQuality:d.imageryQuality||null,imageryDate:d.imageryDate||null,
   googleWholeRoofAreaFt2:googleAreaFt2,googleGroundAreaFt2:Number.isFinite(Number(stats.groundAreaMeters2))?Number(stats.groundAreaMeters2)*10.7639104167:null,
   googleWeightedPitchDeg:googlePitch,lidarWeightedPitchDeg:lidarPitch,areaDifferencePct,pitchDifferenceDeg,
   googleSegments:solarSegments,lidarFacetCount:accepted.length,googleFacetCount:solarSegments.length,warnings
  };
 }catch(e){return {available:false,error:"Google Solar cross-check failed: "+String(e?.message||e)}}
}
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safeId(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 const [outline,planes,geometry,solarModel]=await Promise.all([
  read(env,id+"/_roof_outline_accepted.json"),
  read(env,id+"/_roof_planes.json"),
  read(env,id+"/_roof_geometry.json"),
  read(env,id+"/_google_solar_roof_model.json")
 ]);
 if(!outline)return json({error:"Accepted roof outline not found."},404);
 const validation=await solarCrosscheck(env,outline,planes);
 return json({ok:true,projectId:id,outline,planes,geometry,solarModel,validation});
}