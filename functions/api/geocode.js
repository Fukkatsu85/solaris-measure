const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestGet({request,env}){
 const u=new URL(request.url),address=(u.searchParams.get("address")||"").trim();
 if(!address)return json({ok:false,error:"address is required"},400);
 let googleError="";
 const key=env.GOOGLE_MAPS_BACKEND_KEY||env.GOOGLE_MAPS_API_KEY||"";
 if(key){
  try{
   const g=new URL("https://maps.googleapis.com/maps/api/geocode/json");
   g.searchParams.set("address",address);g.searchParams.set("key",key);
   const r=await fetch(g),d=await r.json();
   const hit=d?.results?.[0],loc=hit?.geometry?.location;
   if(r.ok&&d.status==="OK"&&Number.isFinite(Number(loc?.lat))&&Number.isFinite(Number(loc?.lng))){
    return json({ok:true,source:"google",address:hit.formatted_address||address,lat:Number(loc.lat),lng:Number(loc.lng)});
   }
   googleError=d?.error_message||d?.status||"";
  }catch(e){googleError=String(e?.message||e)}
 }
 try{
  const cg=new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  cg.searchParams.set("address",address);cg.searchParams.set("benchmark","Public_AR_Current");cg.searchParams.set("format","json");
  const r=await fetch(cg,{headers:{"User-Agent":"SolarisMeasure/1.0"}});
  const d=await r.json(),m=d?.result?.addressMatches?.[0],xy=m?.coordinates;
  if(r.ok&&Number.isFinite(Number(xy?.y))&&Number.isFinite(Number(xy?.x))){
   return json({ok:true,source:"census",address:m.matchedAddress||address,lat:Number(xy.y),lng:Number(xy.x)});
  }
 }catch{}
 return json({ok:false,error:googleError||"Address could not be geocoded."},422);
}