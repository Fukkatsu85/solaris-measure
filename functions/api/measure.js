const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,80);
async function read(env,k,f){const o=await env.MEASURE_PHOTOS.get(k);if(!o)return f;try{return JSON.parse(await o.text())}catch{return f}}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const polyArea=pts=>{let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y}return Math.abs(a/2)};
export async function onRequestPost({request,env}){const b=await request.json().catch(()=>({})),id=safe(b.projectId);if(!id)return json({error:"projectId required"},400);
 const g=await read(env,id+"/_geometry.json",{photos:{}}),c=await read(env,id+"/_calibration.json",{references:[]}),p=await read(env,id+"/_project.json",{photoViews:{}});
 const ref=c.references?.[c.references.length-1];if(!ref)return json({error:"Add a known-length calibration first."},400);
 const shapes=g.photos?.[ref.photoKey]||[],walls=shapes.filter(s=>s.type==="wall"),gables=shapes.filter(s=>s.type==="gable");if(!walls.length)return json({error:"No wall polygons found on calibrated photo."},400);
 const px=dist(ref.p1,ref.p2);if(!px)return json({error:"Calibration endpoints are invalid."},400);const feetPerNorm=ref.feet/px;
 // Baseline estimate only: normalized-image scale assumes calibration and wall are approximately coplanar. Perspective solver follows.
 const wallGross=walls.reduce((n,s)=>n+polyArea(s.points)*feetPerNorm*feetPerNorm,0);
 const gableTagged=gables.reduce((n,s)=>n+polyArea(s.points)*feetPerNorm*feetPerNorm,0);
 const out={projectId:id,photoKey:ref.photoKey,view:p.photoViews?.[ref.photoKey]||"unassigned",referenceFeet:ref.feet,feetPerNormalizedUnit:feetPerNorm,wallCount:walls.length,gableCount:gables.length,grossWallArea:wallGross,gableTaggedArea:gableTagged,benchmarkFrontArea:445,errorPct:(wallGross-445)/445*100,method:"single-plane baseline",warning:"Baseline only. Perspective distortion is not yet rectified; do not use for ordering."};
 await env.MEASURE_PHOTOS.put(id+"/_measurements.json",JSON.stringify(out),{httpMetadata:{contentType:"application/json"}});return json({ok:true,measurement:out});}