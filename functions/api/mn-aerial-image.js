const ALLOWED=new Set(["dak23","hen22","rams20","wash13","scott13","rice23","wab25","lake24","lyon24","belt23","doug22","mcle22","steele22","carlton21","lesueur21","met25","fsa2025"]);
function mercator(lat,lng){const x=6378137*lng*Math.PI/180;const y=6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));return{x,y}}
function build(url,layer,lat,lng){const {x,y}=mercator(lat,lng),h=42,u=new URL(url);for(const[k,v]of Object.entries({SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetMap",LAYERS:layer,STYLES:"",SRS:"EPSG:3857",BBOX:[x-h,y-h,x+h,y+h].join(","),WIDTH:"1400",HEIGHT:"1400",FORMAT:"image/jpeg"}))u.searchParams.set(k,v);return u}
async function fetchImage(layer,lat,lng){
 let r=await fetch(build("https://imageserver.gisdata.mn.gov/cgi-bin/wmsll",layer,lat,lng),{headers:{"User-Agent":"Solaris-Measure/1.0"}});
 const type=(r.headers.get("content-type")||"").toLowerCase();
 if(r.ok&&type.includes("image"))return r;
 r=await fetch(build("https://imageserver.gisdata.mn.gov/cgi-bin/mncomp","mncomp",lat,lng),{headers:{"User-Agent":"Solaris-Measure/1.0"}});
 return r;
}
export async function onRequestGet({request}){
 const url=new URL(request.url),lat=Number(url.searchParams.get("lat")),lng=Number(url.searchParams.get("lng"));
 let layer=url.searchParams.get("layer")||"fsa2025";if(!ALLOWED.has(layer))layer="fsa2025";
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return new Response("lat/lng required",{status:400});
 const r=await fetchImage(layer,lat,lng);if(!r.ok)return new Response("MnGeo imagery unavailable",{status:502});
 return new Response(r.body,{headers:{"Content-Type":r.headers.get("content-type")||"image/jpeg","Cache-Control":"public, max-age=86400","X-Solaris-Imagery-Layer":layer}});
}