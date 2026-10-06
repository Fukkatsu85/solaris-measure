import { ROOF_TRAINING_V1, findTrainingBenchmarks } from "../lib/roof-training-v1.js";
import { buildRoofTopology } from "../../assets/js/roof-topology.js";

const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const num=v=>(v===null||v===undefined||v==='')?null:(Number.isFinite(Number(v))?Number(v):null);
const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?Math.abs(a-b)/Math.abs(b)*100:null;
const mean=a=>{const v=a.filter(Number.isFinite);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};

async function readJson(env,key){const o=await env.MEASURE_PHOTOS.get(key);if(!o)return null;try{return JSON.parse(await o.text())}catch{return null}}
async function listModels(env){
 let cursor,keys=[];
 do{
  const p=await env.MEASURE_PHOTOS.list({cursor,limit:1000});
  for(const o of p.objects||[])if(o.key.endsWith("/_google_solar_roof_model.json"))keys.push(o.key);
  cursor=p.truncated?p.cursor:undefined;
 }while(cursor);
 return keys;
}
function edgeTotals(topo){
 const out={ridgeFt:0,hipFt:0,valleyFt:0,eaveFt:0,rakeFt:0,transitionFt:0,perimeterFt:0};
 for(const e of topo?.edges||[]){
  const k=e.type==="ridge"?"ridgeFt":e.type==="hip"?"hipFt":e.type==="valley"?"valleyFt":e.type==="elevation_break"?"transitionFt":e.type==="eave"?"eaveFt":e.type==="rake"?"rakeFt":e.type==="perimeter"?"perimeterFt":null;
  if(k)out[k]+=Number(e.lengthMeters||0)*3.280839895;
 }
 return out;
}
function topoRidgeStructure(topo){
 const verts=topo?.vertices||[],ridges=(topo?.edges||[]).filter(e=>e.type==="ridge");
 const lines=ridges.map(e=>{
  const a=verts[e.a]?.xy||verts[e.a],b=verts[e.b]?.xy||verts[e.b];
  if(!a||!b)return null;
  let ang=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;ang=((ang%180)+180)%180;
  return {angle:ang,lengthFt:Number(e.lengthMeters||0)*3.280839895};
 }).filter(Boolean);
 const fam=[];
 for(const l of lines){
  let g=fam.find(x=>{const d=Math.abs(l.angle-x.angle)%180;return Math.min(d,180-d)<=15});
  if(!g)fam.push({angle:l.angle,count:1});else g.count++;
 }
 return {count:lines.length,familyCount:fam.length,lengthsFt:lines.map(x=>x.lengthFt).sort((a,b)=>b-a)};
}
function rankedError(cur,ref){
 if(!Array.isArray(ref)||!ref.length)return null;
 const a=(cur||[]).slice().sort((x,y)=>y-x),b=ref.slice().map(Number).filter(Number.isFinite).sort((x,y)=>y-x),n=Math.max(a.length,b.length);
 let sum=0;
 for(let i=0;i<n;i++){
  if(a[i]==null||b[i]==null){sum+=100;continue}
  sum+=Math.abs(a[i]-b[i])/Math.max(1,Math.abs(b[i]))*100;
 }
 return sum/n;
}

function scoreTopology(topo,ref){
 if(!topo)return {score:0,facetErr:100,edgeErr:100};
 const facetCount=(topo.faces||[]).length;
 const facetErr=ref.facetCount?Math.abs(facetCount-ref.facetCount)/ref.facetCount*100:null;
 const e=edgeTotals(topo);
 const keys=(ref.ridgeHipFt!=null?["ridgeHipFt"]:["ridgeFt","hipFt"]).concat(["valleyFt","eaveFt","rakeFt"]);
 if(ref.ridgeHipFt!=null)e.ridgeHipFt=Number(e.ridgeFt||0)+Number(e.hipFt||0);
 const pairs=keys.filter(k=>ref[k]!=null&&Number.isFinite(Number(e[k]))).map(k=>({ref:Number(ref[k]),cur:Number(e[k])}));
 const refTotal=pairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const absErr=pairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 const edgeErr=refTotal>0?absErr/refTotal*100:null;
 const rs=topoRidgeStructure(topo);
 const ridgeCountErr=ref.ridgeCount?Math.abs(rs.count-ref.ridgeCount)/ref.ridgeCount*100:null;
 const ridgeFamilyErr=ref.ridgeFamilyCount?Math.abs(rs.familyCount-ref.ridgeFamilyCount)/ref.ridgeFamilyCount*100:null;
 const ridgeLengthErr=rankedError(rs.lengthsFt,ref.ridgeLengthsFt);
 const transitionErr=ref.transitionFt!=null?Math.abs(Number(e.transitionFt||0)-Number(ref.transitionFt))/Math.max(1,Math.abs(Number(ref.transitionFt)))*100:null;
 const facetScore=facetErr==null?50:Math.max(0,100-facetErr*2);
 const edgeScore=edgeErr==null?50:Math.max(0,100-edgeErr*1.5);
 const structErrs=[ridgeCountErr,ridgeFamilyErr,ridgeLengthErr,transitionErr].filter(Number.isFinite);
 const structureErr=structErrs.length?mean(structErrs):null;
 const structureScore=structureErr==null?50:Math.max(0,100-structureErr*1.35);
 return {score:facetScore*.38+edgeScore*.27+structureScore*.35,facetErr,edgeErr,structureErr,facetCount,edges:e,ridgeStructure:rs};
}
function effectiveScope(t){
 const explicit=String(t?.scope||"").trim();
 if(explicit)return explicit;
 const archetype=String(t?.archetype||"").toLowerCase();
 if(/garage/.test(archetype))return "detached-garage";
 return /multi[- ]?structure|multistructure/.test(archetype)?"all-structures":"primary-building";
}
function refFor(t){return {facetCount:t.facetCount,ridgeFt:t.ridgeFt??null,hipFt:t.hipFt??null,ridgeHipFt:t.ridgeHipFt??null,valleyFt:t.valleyFt??null,eaveFt:t.eaveFt??null,rakeFt:t.rakeFt??null,transitionFt:t.transitionFt??null,ridgeCount:t.ridgeCount??null,ridgeLengthsFt:Array.isArray(t.ridgeLengthsFt)?t.ridgeLengthsFt:[],ridgeFamilyCount:t.ridgeFamilyCount??null,majorGableSystems:t.majorGableSystems??null,crossGableCount:t.crossGableCount??null,topologyPattern:t.topologyPattern||null}}
function stableHash(s){
 let h=2166136261>>>0;
 for(const ch of String(s||"")){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}
 return h>>>0;
}
function splitItems(items){
 const sorted=[...items].sort((a,b)=>stableHash(a.t.caseId||a.t.address)-stableHash(b.t.caseId||b.t.address));
 if(sorted.length<3)return {train:sorted,validation:[]};
 const validation=[];
 const train=[];
 sorted.forEach((item,i)=>{
  // Stable ~30% holdout with at least one validation case per sufficiently
  // populated profile. The split is deterministic across optimizer runs.
  if(i%3===0)validation.push(item);else train.push(item);
 });
 if(!validation.length&&train.length>2)validation.push(train.shift());
 if(!train.length&&validation.length>1)train.push(validation.pop());
 return {train,validation};
}
function evalVariant(items,v){
 const scores=[];
 for(const item of items){
  let topo=null;try{topo=buildRoofTopology(item.sm,{profileOverride:v.o})}catch{}
  scores.push(scoreTopology(topo,refFor(item.t)));
 }
 return {
  cases:items.length,
  score:mean(scores.map(x=>x.score)),
  facetErrorPct:mean(scores.map(x=>x.facetErr)),
  edgeErrorPct:mean(scores.map(x=>x.edgeErr)),
  structureErrorPct:mean(scores.map(x=>x.structureErr))
 };
}
function variants(base){
 const n=(v,f,min)=>Math.max(min,typeof v==="number"?v*f:min);
 return [
  {name:"current",o:{}},
  {name:"conservative",o:{maxCandidateAdds:Math.max(1,Math.round(base.maxCandidateAdds*.65)),maxLineExtensionM:n(base.maxLineExtensionM,.82,3),candidateConnectM:n(base.candidateConnectM,.85,2.8),minFaceAreaM2:n(base.minFaceAreaM2,1.35,.2),nodeSnapM:n(base.nodeSnapM,1.12,.22)}},
  {name:"very-conservative",o:{maxCandidateAdds:Math.max(1,Math.round(base.maxCandidateAdds*.45)),maxLineExtensionM:n(base.maxLineExtensionM,.72,3),candidateConnectM:n(base.candidateConnectM,.75,2.6),minFaceAreaM2:n(base.minFaceAreaM2,1.7,.25),nodeSnapM:n(base.nodeSnapM,1.2,.24)}},
  {name:"aggressive",o:{maxCandidateAdds:Math.max(2,Math.round(base.maxCandidateAdds*1.35)),maxLineExtensionM:n(base.maxLineExtensionM,1.15,3),candidateConnectM:n(base.candidateConnectM,1.12,2.8),minFaceAreaM2:n(base.minFaceAreaM2,.72,.18),nodeSnapM:n(base.nodeSnapM,.9,.2)}},
  {name:"smaller-faces",o:{maxCandidateAdds:Math.max(2,Math.round(base.maxCandidateAdds*1.2)),minFaceAreaM2:n(base.minFaceAreaM2,.5,.16),nodeSnapM:n(base.nodeSnapM,.92,.2)}},
  {name:"larger-faces",o:{maxCandidateAdds:Math.max(1,Math.round(base.maxCandidateAdds*.8)),minFaceAreaM2:n(base.minFaceAreaM2,1.55,.22),nodeSnapM:n(base.nodeSnapM,1.1,.22)}},
  {name:"tight-junctions",o:{candidateConnectM:n(base.candidateConnectM,.82,2.6),maxLineExtensionM:n(base.maxLineExtensionM,.85,3),nodeSnapM:n(base.nodeSnapM,1.22,.24)}},
  {name:"loose-junctions",o:{candidateConnectM:n(base.candidateConnectM,1.18,3),maxLineExtensionM:n(base.maxLineExtensionM,1.12,3),nodeSnapM:n(base.nodeSnapM,.82,.18)}}
 ];
}
export async function onRequestGet({env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS missing"},500);
 const config=await readJson(env,"training/_topology_optimizer.json");
 const valid=config?.version==="topology-opt-4-grammar-holdout"&&config?.scopePolicy==="primary-building-only"&&config?.validationPolicy==="deterministic-profile-holdout";
 return json({ok:true,config:valid?config:null,staleVersion:valid?null:(config?.version||null)});
}
export async function onRequestPost({env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS missing"},500);
 const keys=await listModels(env),cases=[];
 for(const key of keys){
  const sm=await readJson(env,key);if(!sm?.address)continue;
  const matches=findTrainingBenchmarks(sm.address);
  // Optimize only against references that describe the same single building
  // returned by Google Solar. Whole-property and detached-garage truth would
  // otherwise teach the solver to compensate for a scope mismatch.
  const t=matches.find(x=>effectiveScope(x)==="primary-building");
  if(!t)continue;
  let base;try{base=buildRoofTopology(sm)}catch{continue}
  if(!base?.baseLearnedProfile?.name)continue;
  cases.push({sm,t,profile:base.baseLearnedProfile.name,baseProfile:base.baseLearnedProfile});
 }
 const groups={};for(const c of cases)(groups[c.profile]||(groups[c.profile]=[])).push(c);
 const profileOverrides={},results=[];
 for(const [profile,items] of Object.entries(groups)){
  const base=items[0].baseProfile,tests=variants(base),ranked=[];
  const {train,validation}=splitItems(items);
  for(const v of tests){
   const tr=evalVariant(train,v),va=validation.length?evalVariant(validation,v):tr;
   ranked.push({
    name:v.name,override:v.o,cases:items.length,
    trainCases:train.length,validationCases:validation.length,
    score:tr.score,facetErrorPct:tr.facetErrorPct,edgeErrorPct:tr.edgeErrorPct,structureErrorPct:tr.structureErrorPct,
    validationScore:va.score,validationFacetErrorPct:va.facetErrorPct,validationEdgeErrorPct:va.edgeErrorPct,validationStructureErrorPct:va.structureErrorPct
   });
  }
  ranked.sort((a,b)=>(b.score||0)-(a.score||0));
  const trainBest=ranked[0],baseline=ranked.find(x=>x.name==="current");
  let promoted=null;
  if(trainBest&&trainBest.name!=="current"){
   const validationImprovement=Number(trainBest.validationScore||0)-Number(baseline?.validationScore||0);
   const facetRegression=Number(trainBest.validationFacetErrorPct||0)-Number(baseline?.validationFacetErrorPct||0);
   const edgeRegression=Number(trainBest.validationEdgeErrorPct||0)-Number(baseline?.validationEdgeErrorPct||0);
   // Production promotion requires an actual holdout set. Profiles with
   // fewer than 2 validation roofs are diagnostic-only and cannot self-promote.
   const hasRealHoldout=validation.length>=2;
   const passesHoldout=hasRealHoldout
     &&validationImprovement>=1.5
     &&facetRegression<=8
     &&edgeRegression<=8;
   if(passesHoldout){profileOverrides[profile]=trainBest.override;promoted=trainBest}
  }
  results.push({
   profile,cases:items.length,trainCases:train.length,validationCases:validation.length,
   best:promoted||baseline,trainBest,baseline,
   promotionEligible:validation.length>=2,
   promotionBlockedReason:validation.length>=2?null:"insufficient-holdout",
   promoted:Boolean(promoted),candidates:ranked
  });
 }
 const config={
  version:"topology-opt-4-grammar-holdout",createdAt:new Date().toISOString(),trainingCases:cases.length,
  scopePolicy:"primary-building-only",validationPolicy:"deterministic-profile-holdout",objective:"facet-edge-structure-grammar",
  profileOverrides,results
 };
 await env.MEASURE_PHOTOS.put("training/_topology_optimizer.json",JSON.stringify(config),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,config});
}