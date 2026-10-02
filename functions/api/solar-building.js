const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});

export async function onRequestGet(context){
  const url=new URL(context.request.url);
  const lat=Number(url.searchParams.get("lat"));
  const lng=Number(url.searchParams.get("lng"));
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({ok:false,error:"Valid lat/lng required."},400);

  const key=context.env.GOOGLE_MAPS_BACKEND_KEY||context.env.GOOGLE_MAPS_API_KEY||context.env.GOOGLE_MAPS_BROWSER_KEY||"";
  if(!key)return json({ok:false,error:"Google Maps backend key is not configured."},503);

  const api=new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
  api.searchParams.set("location.latitude",String(lat));
  api.searchParams.set("location.longitude",String(lng));
  api.searchParams.set("requiredQuality","BASE");
  api.searchParams.set("key",key);

  let response;
  try{response=await fetch(api.toString(),{headers:{"Accept":"application/json"}});}
  catch{return json({ok:false,error:"Solar API could not be reached."},502);}

  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const msg=data?.error?.message||"No Solar API building result was found.";
    return json({ok:false,error:msg,code:response.status},response.status===404?404:502);
  }

  const box=data.boundingBox||data.solarPotential?.wholeRoofStats?.boundingBox||null;
  const center=data.center||null;
  const stats=data.solarPotential?.wholeRoofStats||null;
  const segments=Array.isArray(data.solarPotential?.roofSegmentStats)?data.solarPotential.roofSegmentStats:[];

  return json({
    ok:true,
    center,
    boundingBox:box,
    imageryQuality:data.imageryQuality||null,
    imageryDate:data.imageryDate||null,
    roofAreaMeters2:stats?.areaMeters2??null,
    groundAreaMeters2:stats?.groundAreaMeters2??null,
    roofSegments:segments.map(s=>({
      pitchDegrees:s.pitchDegrees??null,
      azimuthDegrees:s.azimuthDegrees??null,
      center:s.center||null,
      boundingBox:s.boundingBox||null,
      areaMeters2:s.stats?.areaMeters2??null,
      groundAreaMeters2:s.stats?.groundAreaMeters2??null,
      planeHeightAtCenterMeters:s.planeHeightAtCenterMeters??null
    }))
  });
}
