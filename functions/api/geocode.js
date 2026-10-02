const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export async function onRequestGet({request}){
 const u=new URL(request.url),address=(u.searchParams.get("address")||"").trim();
 if(!address)return json({ok:false,error:"address is required"},400);

 try{
  const cg=new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  cg.searchParams.set("address",address);
  cg.searchParams.set("benchmark","Public_AR_Current");
  cg.searchParams.set("format","json");
  const r=await fetch(cg,{headers:{"User-Agent":"SolarisMeasure/1.0"}});
  const d=await r.json(),m=d?.result?.addressMatches?.[0],xy=m?.coordinates;
  if(r.ok&&Number.isFinite(Number(xy?.y))&&Number.isFinite(Number(xy?.x))){
   return json({ok:true,source:"census",address:m.matchedAddress||address,lat:Number(xy.y),lng:Number(xy.x)});
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
   return json({ok:true,source:"nominatim",address:m.display_name||address,lat:Number(m.lat),lng:Number(m.lon)});
  }
 }catch{}

 return json({ok:false,error:"Address could not be geocoded by the Census or OpenStreetMap fallback."},422);
}