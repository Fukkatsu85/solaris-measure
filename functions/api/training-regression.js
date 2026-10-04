import { ROOF_TRAINING_V1, findTrainingBenchmarks, LEARNED_PRIORS_V1 } from "../lib/roof-training-v1.js";
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
function currentMetrics(sm,outline,profileOverrides){
 let topology=null;
 try{topology=buildRoofTopology(sm,{profileOverrides:profileOverrides||{}})}catch{}
 const modelFacets=(sm?.model?.facets||[]).filter(f=>Number(f.slopedAreaSqFt||0)>0);
 // Match production reporting: Google DSM model is authoritative for area,
 // pitch and facet count. Topology faces are derived geometry used for line
 // solving and can overlap while the solver is still learning.
 const facetAreas=modelFacets.map(f=>num(f.slopedAreaSqFt)).filter(Number.isFinite);
 const modelArea=num(sm?.model?.slopedAreaSqFt);
 const googleWhole=num(sm?.googleWholeRoofAreaFt2);
 // Google Solar wholeRoofStats is the safest area authority for the selected
 // building. The raster-derived facet model is retained for topology/pitch, but
 // its facet areas can overlap while segmentation is still being tuned.
 const slopedArea=googleWhole!=null?googleWhole:(modelArea!=null?modelArea:facetAreas.reduce((a,b)=>a+b,0));
 const w=modelFacets.map(f=>({p:num(f.rise12),a:num(f.slopedAreaSqFt)||0})).filter(x=>x.p!=null);
 const aw=w.reduce((s,x)=>s+x.a,0);
 const avgPitch=w.length?(aw?w.reduce((s,x)=>s+x.p*x.a,0)/aw:w.reduce((s,x)=>s+x.p,0)/w.length):null;
 const edges=edgeTotals(topology,sm);
 const topologyFaces=(topology?.faces||[]).filter(f=>Number(f.slopedAreaSqFt||0)>0);
 return {
  facetCount:modelFacets.length,slopedAreaFt2:slopedArea,avgPitch12:avgPitch,
  googleSegmentCount:num(sm?.googleRoofSegmentCount),
  dsmFacetCount:modelFacets.length,
  topologyFaceCount:topologyFaces.length,
  ...edges,ridgeHipFt:Number(edges.ridgeFt||0)+Number(edges.hipFt||0),
  footprintAreaFt2:num(outline?.measurement?.planAreaFt2),
  footprintPerimeterFt:num(outline?.measurement?.perimeterFt),
  facetAreasFt2:facetAreas,
  googleWholeRoofAreaFt2:googleWhole,
  rasterFacetAreaFt2:modelArea,
  areaAuthority:googleWhole!=null?"google-whole-roof":"raster-facet-model",
  rasterToGoogleAreaRatio:(googleWhole&&modelArea)?modelArea/googleWhole:null,
  learnedProfile:topology?.learnedProfile||null,
  topologyVersion:topology?.version||null,
  facetEngineVersion:sm?.model?.facetEngineVersion||null,
  geometryMode:sm?.model?.geometryMode||null,
  planeIntersectionDiagnostics:sm?.model?.planeIntersectionDiagnostics||null
 };
}
function score(cur,ref){
 const errors={
  area:pct(cur.slopedAreaFt2,ref.slopedAreaFt2),
  facets:ref.facetCount?Math.abs(cur.facetCount-ref.facetCount)/ref.facetCount*100:null,
  pitch:pct(cur.avgPitch12,ref.avgPitch12),
  footprintArea:pct(cur.footprintAreaFt2,ref.footprintAreaFt2),
  footprintPerimeter:pct(cur.footprintPerimeterFt,ref.footprintPerimeterFt),
  googleSegments:ref.facetCount&&cur.googleSegmentCount!=null?Math.abs(cur.googleSegmentCount-ref.facetCount)/ref.facetCount*100:null,
  dsmFacets:ref.facetCount&&cur.dsmFacetCount!=null?Math.abs(cur.dsmFacetCount-ref.facetCount)/ref.facetCount*100:null,
  topologyFaces:ref.facetCount&&cur.topologyFaceCount!=null?Math.abs(cur.topologyFaceCount-ref.facetCount)/ref.facetCount*100:null
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
function effectiveScope(t){
 const explicit=String(t?.scope||"").trim();
 if(explicit)return explicit;
 const archetype=String(t?.archetype||"").toLowerCase();
 // Older corpus rows predate explicit scope metadata. Only infer whole-property
 // scope when the verified report itself was labeled as multi-structure.
 return /multi[- ]?structure|multistructure/.test(archetype)?"all-structures":"primary-building";
}
function refFor(t){return {
 slopedAreaFt2:t.slopedAreaFt2,facetCount:t.facetCount,avgPitch12:t.avgPitch12,
 perimeterFt:t.perimeterFt??null,footprintAreaFt2:t.footprintAreaFt2??null,footprintPerimeterFt:t.footprintPerimeterFt??null,
 ridgeFt:t.ridgeFt??null,hipFt:t.hipFt??null,ridgeHipFt:t.ridgeHipFt??null,valleyFt:t.valleyFt??null,eaveFt:t.eaveFt??null,rakeFt:t.rakeFt??null
}}
export async function onRequestGet({env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const optimizer=await readJson(env,"training/_topology_optimizer.json");
 const profileOverrides=optimizer?.profileOverrides||{};
 const keys=await listSolarModels(env);
 const models=[];
 for(const key of keys){
  const sm=await readJson(env,key);if(!sm?.address)continue;
  const matches=findTrainingBenchmarks(sm.address);if(!matches.length)continue;
  models.push({key,sm,matches});
 }
 const rows=[];
 for(const t of ROOF_TRAINING_V1){
  const candidates=models.filter(m=>m.matches.includes(t));
  const found=candidates.sort((a,b)=>String(b.sm.savedAt||"").localeCompare(String(a.sm.savedAt||"")))[0];
  if(!found){const scope=effectiveScope(t);rows.push({caseId:t.caseId||null,address:t.address,scope,source:t.source,archetype:t.archetype,status:"not-processed",reference:refFor(t)});continue}
  const projectId=found.key.split("/")[0],outline=await readJson(env,projectId+"/_roof_outline_accepted.json");
  const current=currentMetrics(found.sm,outline,profileOverrides),result=score(current,refFor(t));
  const scope=effectiveScope(t);
  // A training-* Solar model resolves one geocoded building. Whole-property and
  // detached-structure provider reports are useful truth, but are not directly
  // comparable until Solaris aggregates/selects the same structure scope.
  const scopeComparable=scope==="primary-building";
  rows.push({caseId:t.caseId||null,address:t.address,scope,source:t.source,archetype:t.archetype,status:scopeComparable?"scored":"scope-specific",projectId,reference:refFor(t),current,score:scopeComparable?result:null});
 }
 const scored=rows.filter(r=>r.status==="scored"&&Number.isFinite(r.score?.overall));
 const geometryRows=rows.filter(r=>r.status!=="not-processed");
 const av=k=>mean(scored.map(r=>r.score.errors[k]));
 const summary={
  trainingVersion:LEARNED_PRIORS_V1.version,totalCases:rows.length,processedCases:geometryRows.length,comparableCases:scored.length,geometryProcessedCases:geometryRows.length,
  pendingCases:rows.filter(r=>r.status==="not-processed").length,scopeSpecificCases:rows.filter(r=>r.status==="scope-specific").length,
  averageScore:mean(scored.map(r=>r.score.overall)),medianScore:median(scored.map(r=>r.score.overall)),
  averageAreaErrorPct:av("area"),averageFacetErrorPct:av("facets"),averageEdgeErrorPct:av("edges"),
  averagePitchErrorPct:av("pitch"),averageFootprintAreaErrorPct:av("footprintArea"),averageFootprintPerimeterErrorPct:av("footprintPerimeter"),
  averageGoogleSegmentFacetErrorPct:av("googleSegments"),averageDsmFacetErrorPct:av("dsmFacets"),averageTopologyFaceErrorPct:av("topologyFaces"),
  regressionGate:{maxAreaErrorPct:8,maxFacetErrorPct:25,maxEdgeErrorPct:25,minOverallScore:70},
  topologyOptimizerVersion:optimizer?.version||null,
  optimizedProfiles:Object.keys(profileOverrides).length
 };
 for(const r of rows)if(r.status==="scored"){
  const e=r.score.errors,g=summary.regressionGate;
  r.gatePass=(r.score.overall>=g.minOverallScore)&&(e.area==null||e.area<=g.maxAreaErrorPct)&&(e.facets==null||e.facets<=g.maxFacetErrorPct)&&(e.edges==null||e.edges<=g.maxEdgeErrorPct);
 }
 return json({ok:true,summary,rows});
}