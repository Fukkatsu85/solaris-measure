const MODEL="@cf/moondream/moondream3.1-9B-A2B";
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
function b64(bytes){let out="",n=0x8000;for(let i=0;i<bytes.length;i+=n)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+n,bytes.length)));return btoa(out)}
function box(o){const x=o?.box||o?.bbox||o?.bounding_box||o||{};let x1=x.x_min??x.xmin??x.x1??x.left??x.x,y1=x.y_min??x.ymin??x.y1??x.top??x.y,x2=x.x_max??x.xmax??x.x2??x.right,y2=x.y_max??x.ymax??x.y2??x.bottom;if(x2==null&&x.width!=null)x2=+x1 + +x.width;if(y2==null&&x.height!=null)y2=+y1 + +x.height;if([x1,y1,x2,y2].some(v=>!Number.isFinite(+v)))return null;x1=+x1;y1=+y1;x2=+x2;y2=+y2;const m=Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2));if(m>1.5&&m<=100){x1/=100;y1/=100;x2/=100;y2/=100}return{x1,y1,x2,y2}}
const ALLOWED=new Set(["dak23","hen22","rams20","wash13","scott13","rice23","wab25","lake24","lyon24","belt23","doug22","mcle22","steele22","carlton21","lesueur21","met25","fsa2025"]);
function mercator(lat,lng){return{x:6378137*lng*Math.PI/180,y:6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))}}
function wms(lat,lng,layer){const {x,y}=mercator(lat,lng),h=42,u=new URL("https://imageserver.gisdata.mn.gov/cgi-bin/wmsll"),p={SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetMap",LAYERS:layer,STYLES:"",SRS:"EPSG:3857",BBOX:[x-h,y-h,x+h,y+h].join(","),WIDTH:"1400",HEIGHT:"1400",FORMAT:"image/jpeg"};for(const[k,v]of Object.entries(p))u.searchParams.set(k,v);return u}
export async function onRequestPost({request,env}){
 if(!env.AI)return json({error:"Workers AI binding AI is not configured."},500);
 const d=await request.json().catch(()=>({})),lat=+d.lat,lng=+d.lng;if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:"lat/lng required"},400);
 let layer=ALLOWED.has(d.layer)?d.layer:"fsa2025";
 let r=await fetch(wms(lat,lng,layer));let type=(r.headers.get("content-type")||"").toLowerCase();
 if(!r.ok||!type.includes("image")){layer="fsa2025";r=await fetch(wms(lat,lng,layer))}
 if(!r.ok)return json({error:"MnGeo imagery unavailable"},502);
 const bytes=new Uint8Array(await r.arrayBuffer()),image="data:image/jpeg;base64,"+b64(bytes);
 const targets=["roof of the residential building centered in the image","main house roof centered in the aerial image","building roof"];
 let boxes=[],matchedTarget="";
 for(const target of targets){const a=await env.AI.run(MODEL,{task:"detect",image,target,max_objects:12,stream:false});boxes=(a?.objects||a?.result?.objects||[]).map(box).filter(Boolean).filter(q=>q.x2>q.x1&&q.y2>q.y1);if(boxes.length){matchedTarget=target;break}}
 if(!boxes.length)return json({ok:false,error:"No roof was confidently detected. Try a clearer aerial image or use manual outline."},422);
 // Prefer the detected roof whose center is nearest the image center.
 boxes.sort((a,b)=>Math.hypot((a.x1+a.x2)/2-.5,(a.y1+a.y2)/2-.5)-Math.hypot((b.x1+b.x2)/2-.5,(b.y1+b.y2)/2-.5));
 const q=boxes[0],pad=.008,x1=Math.max(0,q.x1-pad),y1=Math.max(0,q.y1-pad),x2=Math.min(1,q.x2+pad),y2=Math.min(1,q.y2+pad);
 const polygon=[{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}];
 const result={ok:true,model:MODEL,matchedTarget,box:q,polygon,confidence:"proposal",reviewRequired:true,lat,lng,imageryLayer:layer,cropHalfMeters:42,projection:"EPSG:3857",createdAt:new Date().toISOString()};
 if(env.MEASURE_PHOTOS){const id="roof-"+lat.toFixed(6)+"-"+lng.toFixed(6);await env.MEASURE_PHOTOS.put(id+"/_roof_outline.json",JSON.stringify(result),{httpMetadata:{contentType:"application/json"}})}
 return json(result);
}