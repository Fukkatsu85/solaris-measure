import { findTrainingBenchmark } from "../lib/roof-training-v1.js";
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
async function read(env,key){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?Math.abs(a-b)/Math.abs(b)*100:null;
const clamp=v=>Math.max(0,Math.min(100,v));
function metricScore(errorPct,soft=5,hard=25){
 if(!Number.isFinite(errorPct))return null;
 if(errorPct<=soft)return 100;
 if(errorPct>=hard)return 0;
 return 100-(errorPct-soft)/(hard-soft)*100;
}
function facetAreaComparison(solaris,reference){
 const a=(solaris||[]).map(Number).filter(v=>Number.isFinite(v)&&v>0).sort((x,y)=>y-x);
 const b=(reference||[]).map(Number).filter(v=>Number.isFinite(v)&&v>0).sort((x,y)=>y-x);
 if(!a.length||!b.length)return {available:false};
 const n=Math.max(a.length,b.length),rows=[];
 for(let i=0;i<n;i++){
  const s=a[i]??null,r=b[i]??null,e=(s!=null&&r!=null)?pct(s,r):100;
  rows.push({rank:i+1,solarisFt2:s,referenceFt2:r,errorPct:e});
 }
 const mean=rows.reduce((sum,r)=>sum+Number(r.errorPct||0),0)/rows.length;
 return {available:true,meanAbsoluteErrorPct:mean,score:metricScore(mean,4,28),rows};
}
function edgeMetric(name,solar,reference){
 const s=num(solar),r=num(reference);
 if(s==null||r==null)return {name,available:false,solaris:s,reference:r,errorPct:null,score:null};
 const e=pct(s,r);
 return {name,available:true,solaris:s,reference:r,errorPct:e,score:metricScore(e,5,30)};
}
function buildSolaris(sm,planes,outline){
 const facets=Array.isArray(sm?.model?.facets)&&sm.model.facets.length?sm.model.facets:(planes?.planes||[]).filter(p=>p.accepted);
 const isDsm=Array.isArray(sm?.model?.facets)&&sm.model.facets.length>0;
 const facetAreas=facets.map(f=>num(isDsm?f.slopedAreaSqFt:f.slopedAreaFt2)).filter(Number.isFinite);
 const slopedArea=isDsm?num(sm?.model?.slopedAreaSqFt):facetAreas.reduce((a,b)=>a+b,0);
 const weights=facets.map((f,i)=>({pitch:num(isDsm?f.rise12:f.pitch12),area:facetAreas[i]||0})).filter(x=>x.pitch!=null);
 const wsum=weights.reduce((a,x)=>a+x.area,0);
 const avgPitch=weights.length?(wsum>0?weights.reduce((a,x)=>a+x.pitch*x.area,0)/wsum:weights.reduce((a,x)=>a+x.pitch,0)/weights.length):null;
 const m=sm?.measurements||{};
 return {
  facetCount:facets.length,
  slopedAreaFt2:slopedArea,
  avgPitch12:avgPitch,
  perimeterFt:num(m.perimeterFt),
  footprintAreaFt2:num(outline?.measurement?.planAreaFt2),
  footprintPerimeterFt:num(outline?.measurement?.perimeterFt),
  ridgeFt:num(m.ridgeFt),hipFt:num(m.hipFt),ridgeHipFt:(num(m.ridgeFt)!=null||num(m.hipFt)!=null)?Number(num(m.ridgeFt)||0)+Number(num(m.hipFt)||0):null,
  valleyFt:num(m.valleyFt),eaveFt:num(m.eaveFt),rakeFt:num(m.rakeFt),
  facetAreasFt2:facetAreas
 };
}
function scoreBenchmark(solaris,reference){
 const areaErr=pct(solaris.slopedAreaFt2,reference.slopedAreaFt2);
 const facetErr=(Number.isFinite(reference.facetCount)&&reference.facetCount>0)?Math.abs((solaris.facetCount||0)-reference.facetCount)/reference.facetCount*100:null;
 const pitchErr=(Number.isFinite(solaris.avgPitch12)&&Number.isFinite(reference.avgPitch12)&&reference.avgPitch12>0)?Math.abs(solaris.avgPitch12-reference.avgPitch12)/reference.avgPitch12*100:null;
 const topologyScore=facetErr==null?null:metricScore(facetErr,0,35);
 const areaScore=metricScore(areaErr,2,15);
 const pitchScore=metricScore(pitchErr,4,25);
 const facetAreas=facetAreaComparison(solaris.facetAreasFt2,reference.facetAreasFt2);
 const edgeKeys=(reference.ridgeHipFt!=null?["ridgeHipFt"]:["ridgeFt","hipFt"]).concat(["valleyFt","eaveFt","rakeFt","perimeterFt"]);
 const edges=edgeKeys.map(k=>edgeMetric(k,solaris[k],reference[k]));
 const edgeScores=edges.filter(x=>x.score!=null).map(x=>x.score);
 const edgeScore=edgeScores.length?edgeScores.reduce((a,b)=>a+b,0)/edgeScores.length:null;
 const footprintAreaErr=pct(solaris.footprintAreaFt2,reference.footprintAreaFt2);
 const footprintPerimErr=pct(solaris.footprintPerimeterFt,reference.footprintPerimeterFt);
 const footprintScores=[metricScore(footprintAreaErr,3,18),metricScore(footprintPerimErr,3,18)].filter(v=>v!=null);
 const footprintScore=footprintScores.length?footprintScores.reduce((a,b)=>a+b,0)/footprintScores.length:null;
 const componentScores={
  topology:topologyScore,
  edges:edgeScore,
  pitch:pitchScore,
  facetAreas:facetAreas.available?facetAreas.score:null,
  totalArea:areaScore,
  footprint:footprintScore
 };
 const weights={topology:.30,edges:.20,pitch:.10,facetAreas:.10,totalArea:.15,footprint:.15};
 let weighted=0,used=0;
 for(const [k,w] of Object.entries(weights)){const s=componentScores[k];if(s!=null){weighted+=s*w;used+=w}}
 const overall=used?weighted/used:null;
 const issues=[];
 if(Number.isFinite(facetErr)&&facetErr>8)issues.push({type:"topology",message:"Facet count differs from the reference; investigate split/merge topology."});
 if(Number.isFinite(areaErr)&&areaErr>5)issues.push({type:"area",message:"Total sloped area differs materially from the reference."});
 if(Number.isFinite(edgeScore)&&edgeScore<70)issues.push({type:"edges",message:"Roof-line totals differ materially; review ridge/hip/valley classification and intersections."});
 if(facetAreas.available&&facetAreas.meanAbsoluteErrorPct>10)issues.push({type:"facet-area",message:"Per-facet areas are not matching closely; inspect facet boundaries and shared junctions."});
 if(Number.isFinite(footprintAreaErr)&&footprintAreaErr>6)issues.push({type:"footprint-area",message:"Plan-view roof footprint area differs materially from the verified reference."});
 if(Number.isFinite(footprintPerimErr)&&footprintPerimErr>6)issues.push({type:"footprint-perimeter",message:"Plan-view perimeter differs materially; perimeter extraction needs correction before topology tuning."});
 return {overallScore:overall==null?null:+overall.toFixed(1),componentScores:Object.fromEntries(Object.entries(componentScores).map(([k,v])=>[k,v==null?null:+v.toFixed(1)])),errors:{totalAreaPct:areaErr==null?null:+areaErr.toFixed(2),facetCountPct:facetErr==null?null:+facetErr.toFixed(2),pitchPct:pitchErr==null?null:+pitchErr.toFixed(2),footprintAreaPct:footprintAreaErr==null?null:+footprintAreaErr.toFixed(2),footprintPerimeterPct:footprintPerimErr==null?null:+footprintPerimErr.toFixed(2)},edgeMetrics:edges,facetAreaComparison:facetAreas,issues,weights};
}
export async function onRequestGet({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const u=new URL(request.url),id=safe(u.searchParams.get("projectId"));
 if(!id)return json({error:"projectId is required"},400);
 let b=await read(env,id+"/_benchmark.json");
 if(!b){
  const [outline,sm,planes]=await Promise.all([
   read(env,id+"/_roof_outline_accepted.json"),
   read(env,id+"/_google_solar_roof_model.json"),
   read(env,id+"/_roof_planes.json")
  ]);
  const address=String(outline?.address||sm?.address||"");
  let seed=findTrainingBenchmark(address);
  if(!seed&&(address.toLowerCase().includes("1324 forest circle")||address.toLowerCase().includes("1324 forest cir"))){
   seed={address:"1324 Forest Circle, Burnsville, MN 55306",source:"Roofr",slopedAreaFt2:2580,facetCount:15,avgPitch12:8,perimeterFt:292.4167,ridgeFt:69.5833,hipFt:20.75,valleyFt:26.6667,eaveFt:156.25,rakeFt:136.1667,facetAreasFt2:[]};
  }
  if(seed&&(sm||planes)){
   const reference={
    source:seed.source||"Roofr",slopedAreaFt2:seed.slopedAreaFt2,facetCount:seed.facetCount,avgPitch12:seed.avgPitch12,
    perimeterFt:seed.perimeterFt??null,footprintAreaFt2:seed.footprintAreaFt2??null,footprintPerimeterFt:seed.footprintPerimeterFt??null,
    ridgeFt:seed.ridgeFt??null,hipFt:seed.hipFt??null,ridgeHipFt:seed.ridgeHipFt??null,valleyFt:seed.valleyFt??null,eaveFt:seed.eaveFt??null,rakeFt:seed.rakeFt??null,
    flatAreaFt2:seed.flatAreaFt2??null,pitchAreas:seed.pitchAreas||null,facetAreasFt2:Array.isArray(seed.facetAreasFt2)?seed.facetAreasFt2:[]
   };
   const solaris=buildSolaris(sm,planes,outline),score=scoreBenchmark(solaris,reference);
   b={version:2,projectId:id,address:address||seed.address,createdAt:new Date().toISOString(),reference,solaris,score,archetype:seed.archetype||null,seededFrom:"Verified roof-report training corpus supplied by user"};
   await Promise.all([
    env.MEASURE_PHOTOS.put(id+"/_benchmark.json",JSON.stringify(b),{httpMetadata:{contentType:"application/json"}}),
    env.MEASURE_PHOTOS.put("benchmarks/"+id+".json",JSON.stringify(b),{httpMetadata:{contentType:"application/json"}})
   ]);
  }
 }
 return json({benchmark:b});
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const b=await request.json().catch(()=>({})),id=safe(b.projectId);
 if(!id)return json({error:"projectId is required"},400);
 const reference={
  source:String(b.source||"Roofr").slice(0,80),
  slopedAreaFt2:num(b.slopedAreaFt2),
  facetCount:num(b.facetCount),
  avgPitch12:num(b.avgPitch12),
  perimeterFt:num(b.perimeterFt),footprintAreaFt2:num(b.footprintAreaFt2),footprintPerimeterFt:num(b.footprintPerimeterFt),
  ridgeFt:num(b.ridgeFt),hipFt:num(b.hipFt),ridgeHipFt:num(b.ridgeHipFt),valleyFt:num(b.valleyFt),eaveFt:num(b.eaveFt),rakeFt:num(b.rakeFt),
  facetAreasFt2:Array.isArray(b.facetAreasFt2)?b.facetAreasFt2.map(Number).filter(v=>Number.isFinite(v)&&v>0):[]
 };
 if(reference.slopedAreaFt2==null||reference.facetCount==null)return json({error:"Reference sloped area and facet count are required."},400);
 const [sm,planes,outline]=await Promise.all([
  read(env,id+"/_google_solar_roof_model.json"),
  read(env,id+"/_roof_planes.json"),
  read(env,id+"/_roof_outline_accepted.json")
 ]);
 if(!sm&&!planes)return json({error:"No Solaris roof model exists for this project yet."},404);
 const solaris=buildSolaris(sm,planes,outline),score=scoreBenchmark(solaris,reference);
 const out={version:2,projectId:id,address:b.address||outline?.address||sm?.address||"",createdAt:new Date().toISOString(),reference,solaris,score};
 await Promise.all([
  env.MEASURE_PHOTOS.put(id+"/_benchmark.json",JSON.stringify(out),{httpMetadata:{contentType:"application/json"}}),
  env.MEASURE_PHOTOS.put("benchmarks/"+id+".json",JSON.stringify(out),{httpMetadata:{contentType:"application/json"}})
 ]);
 return json({ok:true,benchmark:out});
}