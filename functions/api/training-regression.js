import { ROOF_TRAINING_V1, findTrainingBenchmark, LEARNED_PRIORS_V1 } from "../lib/roof-training-v1.js";
import { buildRoofTopology } from "../../assets/js/roof-topology.js";

const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?Math.abs(a-b)/Math.abs(b)*100:null;
const metric=(e,soft=5,hard=25)=>e==null?null:e<=soft?100:e>=hard?0:100-(e-soft)/(hard-soft)*100;
const mean=a=>{const v=a.filter(Number.isFinite);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};
const median=a=>{const v=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2};

async function readJson(env,key){
 const o=await env.MEASURE_PHOTOS.get(key);if(!o)return null;
 try{return JSON.parse(await o.text())}catch{return null}
}
async function listSolarModels(env){
 let cursor,keys=[];
 do{
  const page=await env.MEASURE_PHOTOS.list({cursor,limit:1000});
  for(const o of page.objects||[])if(o.key.endsWith("/_google_solar_roof_model.json"))keys.push(o.key);
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 return keys;
}
function edgeTotals(topology,sm){
 const out={ridgeFt:0,hipFt:0,valleyFt:0,eaveFt:0,rakeFt:0,perimeterFt:0};
 if(topology?.edges?.length){
  for(const e of topology.edges){
   const k=e.type==="ridge"?"ridgeFt":e.type==="hip"?"hipFt":e.type==="valley"?"valleyFt":e.type==="eave"?"eaveFt":e.type==="rake"?"rakeFt":e.type==="perimeter"?"perimeterFt":null;
   if(k)out[k]+=Number(e.lengthMeters||0)*3.280839895;
  }
 }
 const m=sm?.measurements||{};
 for(const k of ["ridgeFt","hipFt","valleyFt","eaveFt","rakeFt"])if(!(out[k]>0)&&num(m[k])!=null)out[k]=num(m[k]);
 return out;
}
function currentMetrics(sm,outline){
 let topology=null;
 try{topology=buildRoofTopology(sm)}catch{}
 const faces=(topology?.faces||[]).filter(f=>Number(f.slopedAreaSqFt||0)>0);
 const modelFacets=sm?.model?.facets||[];
 const used=faces.length?faces:modelFacets;
 const facetAreas=used.map(f=>num(f.slopedAreaSqFt)).filter(Number.isFinite);
 const slopedArea=faces.length?facetAreas.reduce((a,b)=>a+b,0):num(sm?.model?.slopedAreaSqFt);
 const w=used.map(f=>({p:num(f.rise12),a:num(f.slopedAreaSqFt)||0})).filter(x=>x.p!=null);
 const aw=w.reduce((s,x)=>s+x.a,0);
 const avgPitch=w.length?(aw?w.reduce((s,x)=>s+x.p*x.a,0)/aw:w.reduce((s,x)=>s+x.p,0)/w.length):null;
 const edges=edgeTotals(topology,sm);
 return {
  facetCount:used.length,slopedAreaFt2:slopedArea,avgPitch12:avgPitch,
  ...edges,ridgeHipFt:Number(edges.ridgeFt||0)+Number(edges.hipFt||0),
  footprintAreaFt2:num(outline?.measurement?.planAreaFt2),
  footprintPerimeterFt:num(outline?.measurement?.perimeterFt),
  facetAreasFt2:facetAreas,
  learnedProfile:topology?.learnedProfile||null,
  topologyVersion:topology?.version||null
 };
}
function score(cur,ref){
 const errors={
  area:pct(cur.slopedAreaFt2,ref.slopedAreaFt2),
  facets:ref.facetCount?Math.abs(cur.facetCount-ref.facetCount)/ref.facetCount*100:null,
  pitch:pct(cur.avgPitch12,ref.avgPitch12),
  footprintArea:pct(cur.footprintAreaFt2,ref.footprintAreaFt2),
  footprintPerimeter:pct(cur.footprintPerimeterFt,ref.footprintPerimeterFt)
 };
 const edgeKeys=(ref.ridgeHipFt!=null?["ridgeHipFt"]:["ridgeFt","hipFt"]).concat(["valleyFt","eaveFt","rakeFt","perimeterFt"]);
 const edgeErrors=edgeKeys.map(k=>ref[k]!=null?pct(cur[k],ref[k]):null).filter(Number.isFinite);
 errors.edges=mean(edgeErrors);
 const comp={
  topology:metric(errors.facets,0,35),
  edges:metric(errors.edges,5,30),
  pitch:metric(errors.pitch,4,25),
  totalArea:metric(errors.area,2,15),
  footprint:mean([metric(errors.footprintArea,3,18),metric(errors.footprintPerimeter,3,18)])
 };
 const weights={topology:.35,edges:.20,pitch:.10,totalArea:.20,footprint:.15};
 let total=0,used=0;for(const[k,w]of Object.entries(weights))if(comp[k]!=null){total+=comp[k]*w;used+=w}
 return {overall:used?total/used:null,errors,components:comp};
}
function refFor(t){return {
 slopedAreaFt2:t.slopedAreaFt2,facetCount:t.facetCount,avgPitch12:t.avgPitch12,
 perimeterFt:t.perimeterFt??null,footprintAreaFt2:t.footprintAreaFt2??null,footprintPerimeterFt:t.footprintPerimeterFt??null,
 ridgeFt:t.ridgeFt??null,hipFt:t.hipFt??null,ridgeHipFt:t.ridgeHipFt??null,valleyFt:t.valleyFt??null,eaveFt:t.eaveFt??null,rakeFt:t.rakeFt??null
}}
export async function onRequestGet({env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const keys=await listSolarModels(env);
 const byAddress=new Map();
 for(const key of keys){
  const sm=await readJson(env,key);if(!sm?.address)continue;
  const training=findTrainingBenchmark(sm.address);if(!training)continue;
  const existing=byAddress.get(training.address);
  if(!existing||String(sm.savedAt||"")>String(existing.sm.savedAt||""))byAddress.set(training.address,{key,sm,training});
 }
 const rows=[];
 for(const t of ROOF_TRAINING_V1){
  const found=byAddress.get(t.address);
  if(!found){rows.push({address:t.address,source:t.source,archetype:t.archetype,status:"not-processed",reference:refFor(t)});continue}
  const projectId=found.key.split("/")[0],outline=await readJson(env,projectId+"/_roof_outline_accepted.json");
  const current=currentMetrics(found.sm,outline),result=score(current,refFor(t));
  rows.push({address:t.address,source:t.source,archetype:t.archetype,status:"scored",projectId,reference:refFor(t),current,score:result});
 }
 const scored=rows.filter(r=>r.status==="scored"&&Number.isFinite(r.score?.overall));
 const av=k=>mean(scored.map(r=>r.score.errors[k]));
 const summary={
  trainingVersion:LEARNED_PRIORS_V1.version,totalCases:rows.length,processedCases:scored.length,pendingCases:rows.length-scored.length,
  averageScore:mean(scored.map(r=>r.score.overall)),medianScore:median(scored.map(r=>r.score.overall)),
  averageAreaErrorPct:av("area"),averageFacetErrorPct:av("facets"),averageEdgeErrorPct:av("edges"),
  averagePitchErrorPct:av("pitch"),averageFootprintAreaErrorPct:av("footprintArea"),averageFootprintPerimeterErrorPct:av("footprintPerimeter"),
  regressionGate:{maxAreaErrorPct:8,maxFacetErrorPct:25,maxEdgeErrorPct:25,minOverallScore:70}
 };
 for(const r of rows)if(r.status==="scored"){
  const e=r.score.errors,g=summary.regressionGate;
  r.gatePass=(r.score.overall>=g.minOverallScore)&&(e.area==null||e.area<=g.maxAreaErrorPct)&&(e.facets==null||e.facets<=g.maxFacetErrorPct)&&(e.edges==null||e.edges<=g.maxEdgeErrorPct);
 }
 return json({ok:true,summary,rows});
}