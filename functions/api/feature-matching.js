const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,80);
async function read(env,key,fallback){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return fallback;try{return JSON.parse(await o.text())}catch{return fallback}}
const center=b=>({x:(Number(b.x1)+Number(b.x2))/2,y:(Number(b.y1)+Number(b.y2))/2});
const flat=p=>Object.entries(p?.detections||{}).flatMap(([type,list])=>(list||[]).filter(b=>["window","door","vent","shutter"].includes(type)).map((b,i)=>({type,index:i,...center(b),w:Math.abs(Number(b.x2)-Number(b.x1)),h:Math.abs(Number(b.y2)-Number(b.y1))})));
const similarity=(a,b)=>{if(a.type!==b.type)return 0;const size=Math.min(a.w*b.h,b.w*a.h)/Math.max(a.w*b.h,b.w*a.h,1e-6);const shape=Math.min(a.w/Math.max(a.h,1e-6),b.w/Math.max(b.h,1e-6))/Math.max(a.w/Math.max(a.h,1e-6),b.w/Math.max(b.h,1e-6));return .55*size+.45*shape};
export async function onRequestGet({request,env}){const id=safe(new URL(request.url).searchParams.get("projectId"));if(!id)return json({error:"projectId required"},400);return json({featureMatching:await read(env,id+"/_feature_matches.json",null)});}
export async function onRequestPost({request,env}){const b=await request.json().catch(()=>({})),id=safe(b.projectId);if(!id)return json({error:"projectId required"},400);
 const readiness=await read(env,id+"/_readiness.json",null),verified=await read(env,id+"/_verified.json",null);if(!readiness)return json({error:"Run Check Photo Coverage first."},400);if(!verified)return json({error:"Preserve verified objects first."},400);
 let vp=[];if(Array.isArray(verified.photos))vp=verified.photos;else if(verified.photos&&typeof verified.photos==="object")vp=Object.entries(verified.photos).map(([key,v])=>Object.assign({key},v||{}));
 const byKey=new Map(vp.map(p=>[p.key,p])),results=[];
 for(const pair of readiness.candidatePairs||[]){const A=flat(byKey.get(pair.a)),B=flat(byKey.get(pair.b)),candidates=[];for(const a of A)for(const bb of B){const score=similarity(a,bb);if(score>=.58)candidates.push({type:a.type,aIndex:a.index,bIndex:bb.index,score:Number(score.toFixed(3)),a:{x:a.x,y:a.y},b:{x:bb.x,y:bb.y}})}candidates.sort((x,y)=>y.score-x.score);
  const usedA=new Set(),usedB=new Set(),matches=[];for(const m of candidates){const ak=m.type+":"+m.aIndex,bk=m.type+":"+m.bIndex;if(usedA.has(ak)||usedB.has(bk))continue;usedA.add(ak);usedB.add(bk);matches.push(m)}
  const strong=matches.filter(m=>m.score>=.78).length,score=Math.min(100,Math.round(matches.length*12+strong*8));const status=score>=65?"usable":score>=30?"weak":"insufficient";
  results.push({...pair,objectCountA:A.length,objectCountB:B.length,matches,strongMatches:strong,score,status});
 }
 const summary={usable:results.filter(x=>x.status==="usable").length,weak:results.filter(x=>x.status==="weak").length,insufficient:results.filter(x=>x.status==="insufficient").length,total:results.length};
 const out={version:1,createdAt:new Date().toISOString(),projectId:id,method:"semantic-object-correspondence-v1",results,summary,note:"This stage establishes automatic cross-view semantic correspondences. Pixel-level keypoint geometry and camera pose are the next reconstruction stage."};
 await env.MEASURE_PHOTOS.put(id+"/_feature_matches.json",JSON.stringify(out),{httpMetadata:{contentType:"application/json"}});return json({ok:true,featureMatching:out});
}