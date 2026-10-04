import { ROOF_TRAINING_V1, findTrainingBenchmarks } from "../lib/roof-training-v1.js";
import { buildRoofTopology } from "../../assets/js/roof-topology.js";

const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const num=v=>Number.isFinite(Number(v))?Number(v):null;
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
 const out={ridgeFt:0,hipFt:0,valleyFt:0,eaveFt:0,rakeFt:0,perimeterFt:0};
 for(const e of topo?.edges||[]){
  const k=e.type==="ridge"?"ridgeFt":e.type==="hip"?"hipFt":e.type==="valley"?"valleyFt":e.type==="eave"?"eaveFt":e.type==="rake"?"rakeFt":e.type==="perimeter"?"perimeterFt":null;
  if(k)out[k]+=Number(e.lengthMeters||0)*3.280839895;
 }
 return out;
}
function scoreTopology(topo,ref){
 if(!topo)return {score:0,facetErr:100,edgeErr:100};
 const facetCount=(topo.faces||[]).length;
 const facetErr=ref.facetCount?Math.abs(facetCount-ref.facetCount)/ref.facetCount*100:null;
 const e=edgeTotals(topo);
 const keys=(ref.ridgeHipFt!=null?["ridgeHipFt"]:["ridgeFt","hipFt"]).concat(["valleyFt","eaveFt","rakeFt"]);
 if(ref.ridgeHipFt!=null)e.ridgeHipFt=Number(e.ridgeFt||0)+Number(e.hipFt||0);
 const errs=keys.map(k=>ref[k]!=null?pct(e[k],ref[k]):null).filter(Number.isFinite);
 const edgeErr=mean(errs);
 const facetScore=facetErr==null?50:Math.max(0,100-facetErr*2);
 const edgeScore=edgeErr==null?50:Math.max(0,100-edgeErr*1.5);
 return {score:facetScore*.6+edgeScore*.4,facetErr,edgeErr,facetCount,edges:e};
}
function effectiveScope(t){
 const explicit=String(t?.scope||"").trim();
 if(explicit)return explicit;
 const archetype=String(t?.archetype||"").toLowerCase();
 if(/garage/.test(archetype))return "detached-garage";
 return /multi[- ]?structure|multistructure/.test(archetype)?"all-structures":"primary-building";
}
function refFor(t){return {facetCount:t.facetCount,ridgeFt:t.ridgeFt??null,hipFt:t.hipFt??null,ridgeHipFt:t.ridgeHipFt??null,valleyFt:t.valleyFt??null,eaveFt:t.eaveFt??null,rakeFt:t.rakeFt??null}}
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
 const valid=config?.version==="topology-opt-2-scope-aware"&&config?.scopePolicy==="primary-building-only";
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
  for(const v of tests){
   const scores=[];
   for(const item of items){
    let topo=null;try{topo=buildRoofTopology(item.sm,{profileOverride:v.o})}catch{}
    scores.push(scoreTopology(topo,refFor(item.t)));
   }
   ranked.push({name:v.name,override:v.o,cases:items.length,score:mean(scores.map(x=>x.score)),facetErrorPct:mean(scores.map(x=>x.facetErr)),edgeErrorPct:mean(scores.map(x=>x.edgeErr))});
  }
  ranked.sort((a,b)=>(b.score||0)-(a.score||0));
  const best=ranked[0];
  if(best&&best.name!=="current")profileOverrides[profile]=best.override;
  results.push({profile,cases:items.length,best,baseline:ranked.find(x=>x.name==="current"),candidates:ranked});
 }
 const config={version:"topology-opt-2-scope-aware",createdAt:new Date().toISOString(),trainingCases:cases.length,scopePolicy:"primary-building-only",profileOverrides,results};
 await env.MEASURE_PHOTOS.put("training/_topology_optimizer.json",JSON.stringify(config),{httpMetadata:{contentType:"application/json"}});
 return json({ok:true,config});
}