const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestGet({request,env}){
 const u=new URL(request.url),address=(u.searchParams.get("address")||"").trim();
 if(!address)return json({ok:false,error:"address is required"},400);

 // Prefer Google for training/roof work because its ROOFTOP result is building-level
 // precision. Census/Nominatim remain fallbacks for general address resolution.
 const key=env?.GOOGLE_MAPS_BACKEND_KEY||env?.GOOGLE_MAPS_API_KEY||env?.GOOGLE_MAPS_BROWSER_KEY||"";
 if(key){
  try{
   const g=new URL("https://maps.googleapis.com/maps/api/geocode/json");
   g.searchParams.set("address",address);
   g.searchParams.set("key",key);
   const r=await fetch(g,{headers:{"Accept":"application/json"}});
   const d=await r.json(),m=Array.isArray(d?.results)?d.results[0]:null,xy=m?.geometry?.location;
   if(r.ok&&d?.status==="OK"&&m&&Number.isFinite(Number(xy?.lat))&&Number.isFinite(Number(xy?.lng))){
    return json({
     ok:true,source:"google",address:m.formatted_address||address,
     lat:Number(xy.lat),lng:Number(xy.lng),
     precision:m.geometry?.location_type||null,
     rooftop:m.geometry?.location_type==="ROOFTOP",
     placeId:m.place_id||null,
     partialMatch:Boolean(m.partial_match)
    });
   }
  }catch{}
 }

 try{
  const cg=new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  cg.searchParams.set("address",address);
  cg.searchParams.set("benchmark","Public_AR_Current");
  cg.searchParams.set("format","json");
  const r=await fetch(cg,{headers:{"User-Agent":"SolarisMeasure/1.0"}});
  const d=await r.json(),m=d?.result?.addressMatches?.[0],xy=m?.coordinates;
  if(r.ok&&Number.isFinite(Number(xy?.y))&&Number.isFinite(Number(xy?.x))){
   return json({ok:true,source:"census",address:m.matchedAddress||address,lat:Number(xy.y),lng:Number(xy.x),precision:"INTERPOLATED",rooftop:false});
  }
 }catch{}

 try{
  const n=new URL("https://nominatim.openstreetmap.org/search");
  n.searchParams.set("q",address);
  n.searchParams.set("format","jsonv2");
  n.searchParams.set("limit","1");
  n.searchParams.set("countrycodes","us");
  const r=await fetch(n,{headers:{"User-Agent":"SolarisMeasure/1.0 (measure.solariscos.com)","Accept":"application/json"}});
  const d=await r.json(),m=Array.isArray(d)?d[0]:null;
  if(r.ok&&m&&Number.isFinite(Number(m.lat))&&Number.isFinite(Number(m.lon))){
   return json({ok:true,source:"nominatim",address:m.display_name||address,lat:Number(m.lat),lng:Number(m.lon),precision:"APPROXIMATE",rooftop:false});
  }
 }catch{}

 return json({ok:false,error:"Address could not be geocoded by Google, Census, or OpenStreetMap."},422);
}