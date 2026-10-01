const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,80);
async function read(env,key,fallback){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return fallback;try{return JSON.parse(await o.text())}catch{return fallback}}
const canonical=v=>v==="front"||v==="front-left"||v==="front-right"?"front":v==="rear"||v==="rear-left"||v==="rear-right"?"rear":v==="left"?"left":v==="right"?"right":null;
const neighbors={front:["front-left","front","front-right"],right:["front-right","right","rear-right"],rear:["rear-right","rear","rear-left"],left:["rear-left","left","front-left"]};
export async function onRequestGet({request,env}){const id=safe(new URL(request.url).searchParams.get("projectId"));if(!id)return json({error:"projectId required"},400);return json({readiness:await read(env,id+"/_readiness.json",null)});}
export async function onRequestPost({request,env}){const b=await request.json().catch(()=>({})),id=safe(b.projectId);if(!id)return json({error:"projectId required"},400);
 const geometry=await read(env,id+"/_geometry.json",{photos:{}}),project=await read(env,id+"/_project.json",{photoViews:{}}),verified=await read(env,id+"/_verified.json",null);
 const photoKeys=new Set([...Object.keys(project.photoViews||{}),...Object.keys(geometry.photos||{})]);
 const photos=[...photoKeys].map(key=>({key,view:project.photoViews?.[key]||"unassigned",walls:(geometry.photos?.[key]||[]).filter(s=>s.type==="wall").length}));
 const elevations={};
 for(const name of ["front","right","rear","left"]){
   const candidates=photos.filter(p=>neighbors[name].includes(p.view)&&p.walls>0);
   const direct=candidates.filter(p=>p.view===name);
   const corner=candidates.filter(p=>p.view!==name);
   let status="missing",score=0,recommendation="Capture a clear "+name+" elevation photo.";
   if(candidates.length){score=direct.length?60:35;score+=Math.min(25,(candidates.length-1)*15);score+=Math.min(15,candidates.reduce((n,p)=>n+p.walls,0)*3);score=Math.min(100,score);status=score>=75?"good":"limited";
     recommendation=status==="good"?"Coverage is sufficient for reconstruction matching.":(!direct.length?"Add a straight "+name+" elevation photo.":"Add an overlapping "+name+"-side or corner photo.");}
   elevations[name]={status,score,usableViews:candidates.length,directViews:direct.length,cornerViews:corner.length,wallPlanes:candidates.reduce((n,p)=>n+p.walls,0),recommendation,photos:candidates.map(p=>({key:p.key,view:p.view,walls:p.walls}))};
 }
 const pairs=[];const order=["front","front-right","right","rear-right","rear","rear-left","left","front-left"],rank=v=>order.indexOf(v);
 for(let i=0;i<photos.length;i++)for(let j=i+1;j<photos.length;j++){const a=photos[i],c=photos[j],ra=rank(a.view),rb=rank(c.view);if(ra<0||rb<0)continue;const d=Math.min(Math.abs(ra-rb),8-Math.abs(ra-rb));if(d<=2&&a.walls&&c.walls)pairs.push({a:a.key,b:c.key,viewA:a.view,viewB:c.view,relationship:d===0?"same-view":d===1?"adjacent":"nearby",status:"candidate"});}
 const summary={good:Object.values(elevations).filter(x=>x.status==="good").length,limited:Object.values(elevations).filter(x=>x.status==="limited").length,missing:Object.values(elevations).filter(x=>x.status==="missing").length,candidatePairs:pairs.length};
 const out={version:1,createdAt:new Date().toISOString(),projectId:id,verifiedObjectsAvailable:!!verified,elevations,candidatePairs:pairs,summary,nextStage:"pixel-feature-matching"};
 await env.MEASURE_PHOTOS.put(id+"/_readiness.json",JSON.stringify(out),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,readiness:out});
}