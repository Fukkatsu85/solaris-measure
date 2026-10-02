const MODEL="@cf/moondream/moondream3.1-9B-A2B";
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
function b64(bytes){let out="",n=0x8000;for(let i=0;i<bytes.length;i+=n)out+=String.fromCharCode(...bytes.subarray(i,Math.min(i+n,bytes.length)));return btoa(out)}
function box(o){const x=o?.box||o?.bbox||o?.bounding_box||o||{};let x1=x.x_min??x.xmin??x.x1??x.left??x.x,y1=x.y_min??x.ymin??x.y1??x.top??x.y,x2=x.x_max??x.xmax??x.x2??x.right,y2=x.y_max??x.ymax??x.y2??x.bottom;if(x2==null&&x.width!=null)x2=+x1 + +x.width;if(y2==null&&x.height!=null)y2=+y1 + +x.height;if([x1,y1,x2,y2].some(v=>!Number.isFinite(+v)))return null;x1=+x1;y1=+y1;x2=+x2;y2=+y2;const m=Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2));if(m>1.5&&m<=100){x1/=100;y1/=100;x2/=100;y2/=100}return{x1,y1,x2,y2}}
function wms(lat,lng){const half=.00042,u=new URL("https://imageserver.gisdata.mn.gov/cgi-bin/mncomp"),p={SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetMap",LAYERS:"mncomp",STYLES:"",SRS:"EPSG:4326",BBOX:[lng-half,lat-half,lng+half,lat+half].join(","),WIDTH:"1200",HEIGHT:"1200",FORMAT:"image/jpeg"};for(const[k,v]of Object.entries(p))u.searchParams.set(k,v);return u}
export async function onRequestPost({request,env}){
 if(!env.AI)return json({error:"Workers AI binding AI is not configured."},500);
 const d=await request.json().catch(()=>({})),lat=+d.lat,lng=+d.lng;if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:"lat/lng required"},400);
 const r=await fetch(wms(lat,lng));if(!r.ok)return json({error:"MnGeo imagery unavailable"},502);
 const bytes=new Uint8Array(await r.arrayBuffer()),image="data:image/jpeg;base64,"+b64(bytes);
 const targets=["roof of the residential building centered in the image","main house roof centered in the aerial image","building roof"];
 let boxes=[],matchedTarget="";
 for(const target of targets){const a=await env.AI.run(MODEL,{task:"detect",image,target,max_objects:12,stream:false});boxes=(a?.objects||a?.result?.objects||[]).map(box).filter(Boolean).filter(q=>q.x2>q.x1&&q.y2>q.y1);if(boxes.length){matchedTarget=target;break}}
 if(!boxes.length)return json({ok:false,error:"No roof was confidently detected. Try a clearer aerial image or use manual outline."},422);
 // Prefer the detected roof whose center is nearest the image center.
 boxes.sort((a,b)=>Math.hypot((a.x1+a.x2)/2-.5,(a.y1+a.y2)/2-.5)-Math.hypot((b.x1+b.x2)/2-.5,(b.y1+b.y2)/2-.5));
 const q=boxes[0],pad=.008,x1=Math.max(0,q.x1-pad),y1=Math.max(0,q.y1-pad),x2=Math.min(1,q.x2+pad),y2=Math.min(1,q.y2+pad);
 const polygon=[{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}];
 const result={ok:true,model:MODEL,matchedTarget,box:q,polygon,confidence:"proposal",reviewRequired:true,lat,lng,createdAt:new Date().toISOString()};
 if(env.MEASURE_PHOTOS){const id="roof-"+lat.toFixed(6)+"-"+lng.toFixed(6);await env.MEASURE_PHOTOS.put(id+"/_roof_outline.json",JSON.stringify(result),{httpMetadata:{contentType:"application/json"}})}
 return json(result);
}