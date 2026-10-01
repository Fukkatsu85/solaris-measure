const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,80);
async function read(env,k,f){const o=await env.MEASURE_PHOTOS.get(k);if(!o)return f;try{return JSON.parse(await o.text())}catch{return f}}
const area=pts=>{if(!pts?.length)return 0;let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p.x*q.y-q.x*p.y}return Math.abs(a/2)};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const boxCenter=b=>({x:(Number(b.x1)+Number(b.x2))/2,y:(Number(b.y1)+Number(b.y2))/2});
const pointIn=(p,poly)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y+1e-12)+a.x))c=!c}return c};
const canonical=v=>v==="front"||v==="front-left"||v==="front-right"?"front":v==="rear"||v==="rear-left"||v==="rear-right"?"rear":v==="left"?"left":v==="right"?"right":null;
const bench={front:445,right:394,left:410,rear:417};
export async function onRequestPost({request,env}){try{const b=await request.json().catch(()=>({})),id=safe(b.projectId);if(!id)return json({error:"projectId required"},400);
 const [g,v,p,c]=await Promise.all([read(env,id+"/_geometry.json",{photos:{}}),read(env,id+"/_verified.json",null),read(env,id+"/_project.json",{photoViews:{}}),read(env,id+"/_calibration.json",{references:[]})]);
 if(!v)return json({error:"Preserve verified objects first."},400);
 const refs=(c.references||[]).filter(r=>r.p1&&r.p2&&Number(r.feet)>0),lastLine=[...refs].reverse().find(r=>r.type!=="rectangle")||refs[refs.length-1];
 if(!lastLine)return json({error:"One known-length reference is still required for absolute scale."},400);
 const scale=Number(lastLine.feet)/dist(lastLine.p1,lastLine.p2),photos=[];
 const verifiedPhotos=Array.isArray(v.photos)?v.photos:Object.entries(v.photos||{}).map(([key,value])=>({key,...(value||{})}));\n for(const vp of verifiedPhotos){const photoKey=vp.key||vp.photoKey; if(!photoKey)continue; const shapes=g.photos?.[photoKey]||[],walls=shapes.filter(s=>s.type==="wall"),view=p.photoViews?.[photoKey]||vp.view||"unassigned",elev=canonical(view);if(!walls.length)continue;
  const wallImageArea=walls.reduce((n,w)=>n+area(w.points),0),gross=wallImageArea*scale*scale,objects=[];
  for(const type of ["window","door","shutter","vent"])for(const box of vp.detections?.[type]||[]){const center=boxCenter(box),wall=walls.find(w=>pointIn(center,w.points));objects.push({type,center,onWall:!!wall,wallId:wall?.id||null});}
  photos.push({photoKey,view,elevation:elev,wallCount:walls.length,grossAreaFt2:gross,objects,confidence:elev&&walls.length?"medium":"low"});
 }
 const elevations={};for(const name of ["front","right","left","rear"]){const candidates=photos.filter(x=>x.elevation===name);if(!candidates.length){elevations[name]={areaFt2:null,benchmark:bench[name],status:"needs_view"};continue;}const exact=candidates.find(x=>x.view===name)||candidates.sort((a,b)=>b.wallCount-a.wallCount)[0];elevations[name]={areaFt2:exact.grossAreaFt2,benchmark:bench[name],differenceFt2:exact.grossAreaFt2-bench[name],errorPct:(exact.grossAreaFt2-bench[name])/bench[name]*100,sourceView:exact.view,wallCount:exact.wallCount,confidence:exact.confidence,status:"estimated"};}
 const vals=Object.values(elevations).filter(x=>Number.isFinite(x.areaFt2)),total=vals.reduce((n,x)=>n+x.areaFt2,0),out={version:1,createdAt:new Date().toISOString(),method:"automated single-reference diagnostic",referenceFeet:lastLine.feet,photos,elevations,totalAreaFt2:total,benchmarkTotal:1666,totalDifferenceFt2:total-1666,totalErrorPct:(total-1666)/1666*100,complete:vals.length===4,warning:"Diagnostic auto-measure. A single photographic scale cannot fully resolve perspective/depth; benchmark values are comparison-only and are not used to calculate Solaris areas."};
 await env.MEASURE_PHOTOS.put(id+"/_auto_measure.json",JSON.stringify(out),{httpMetadata:{contentType:"application/json"}});return json({ok:true,result:out});}catch(e){return json({error:e?.message||String(e),stage:"auto-reconstruction"},500)}}