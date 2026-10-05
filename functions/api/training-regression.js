import { ROOF_TRAINING_V1, findTrainingBenchmarks, LEARNED_PRIORS_V1 } from "../lib/roof-training-v1.js";
import { buildRoofTopology, buildFacetPartitionTopology } from "../../assets/js/roof-topology.js";

const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const num=v=>(v===null||v===undefined||v==='')?null:(Number.isFinite(Number(v))?Number(v):null);
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
function localOffsetMeters(p,c){
 const plat=num(p?.lat??p?.latitude),plng=num(p?.lng??p?.longitude),clat=num(c?.lat??c?.latitude),clng=num(c?.lng??c?.longitude);
 if([plat,plng,clat,clng].some(v=>v==null))return null;
 const lat0=clat*Math.PI/180;
 return {east:(plng-clng)*111320*Math.cos(lat0),north:(plat-clat)*111320};
}
function facetHeightAtSaved(f,p){
 const o=localOffsetMeters(p,f?.center);
 if(!o)return null;
 const z=num(f?.z0),ge=num(f?.gradientEast),gn=num(f?.gradientNorth);
 if(z==null||ge==null||gn==null)return null;
 return z-ge*o.east-gn*o.north;
}
function physicalExteriorTotals(sm){
 const edges=sm?.measurements?.exteriorEdges||[],facets=sm?.model?.facets||[];
 if(!edges.length||!facets.length)return null;
 let eaveFt=0,rakeFt=0,used=0;
 for(const ed of edges){
  const len=num(ed?.lengthFt); if(!(len>=0))continue;
  const facet=facets.find(f=>Number(f?.index)===Number(ed?.facetIndex));
  let type=ed?.type==="rake"?"rake":"eave";
  if(facet&&ed?.a&&ed?.b){
   const zs=(facet.outline||[]).map(p=>facetHeightAtSaved(facet,p)).filter(Number.isFinite);
   const za=facetHeightAtSaved(facet,ed.a),zb=facetHeightAtSaved(facet,ed.b);
   if(zs.length>=2&&Number.isFinite(za)&&Number.isFinite(zb)){
    const mn=Math.min(...zs),mx=Math.max(...zs),range=Math.max(.05,mx-mn);
    const verticalSpan=Math.abs(zb-za)/range;
    const midpointLevel=(((za+zb)/2)-mn)/range;
    type=verticalSpan>=.15&&midpointLevel>=.05?"rake":"eave";
   }
  }
  if(type==="rake")rakeFt+=len;else eaveFt+=len;
  used++;
 }
 return used?{eaveFt,rakeFt,perimeterFt:eaveFt+rakeFt}:null;
}
function confidenceFilteredValleyFt(sm){
 let total=0;
 for(const l of sm?.model?.roofLines||[]){
  if(l?.type!=="valley")continue;
  const trace=Number(l.traceStrength||0);
  const crease=Math.abs(Number(l.creaseStrength||0));
  // Holdout-tested valley rule: valley evidence needs both a visible DSM trace
  // and a strong crease. No minimum length is imposed because legitimate short
  // valleys occur on dormers and compound roofs.
  if(trace<.15||crease<.10)continue;
  total+=Number(l.length3dMeters||l.lengthMeters||0)*3.280839895;
 }
 return total;
}
function confidenceFilteredHipFt(sm){
 let total=0;
 for(const l of sm?.model?.roofLines||[]){
  if(l?.type!=="hip")continue;
  const lenFt=Number(l.length3dMeters||l.lengthMeters||0)*3.280839895;
  const plane=Math.abs(Number(l.planeStrength||0));
  const crease=Math.abs(Number(l.creaseStrength||0));
  // Shadow rule selected by deterministic 5-fold validation. Require a
  // meaningful hip length plus strong plane and crease evidence.
  if(lenFt<5||plane<.45||crease<.06)continue;
  total+=lenFt;
 }
 return total;
}
function topologyInternalTotals(topology){
 const out={ridgeFt:0,hipFt:0,valleyFt:0};
 for(const e of topology?.edges||[]){
  const ft=Number(e.lengthMeters||0)*3.280839895;
  if(e.type==="ridge")out.ridgeFt+=ft;
  else if(e.type==="hip")out.hipFt+=ft;
  else if(e.type==="valley")out.valleyFt+=ft;
 }
 return out;
}
function edgeTotals(topology,sm){
 const out={ridgeFt:0,hipFt:0,valleyFt:0,eaveFt:0,rakeFt:0,perimeterFt:0};
 // Match the actual production report: saved Solar/DSM measurements are the
 // primary line source. Topology is only a fallback when an older model lacks
 // a saved measurement.
 const m=sm?.measurements||{};
 for(const k of ["ridgeFt","hipFt","valleyFt","eaveFt","rakeFt"]){
  const v=num(m[k]); if(v!=null)out[k]=v;
 }
 const physicalExterior=physicalExteriorTotals(sm);
 if(physicalExterior){
  out.eaveFt=physicalExterior.eaveFt;
  out.rakeFt=physicalExterior.rakeFt;
 }
 // Production exterior calibration: apply only to complex roofs. The >=7 facet
 // guard protects simple roofs that already measure well while retaining the
 // large holdout improvement on complex geometry.
 if((sm?.model?.facets||[]).length>=7){
  out.eaveFt*=1.20;
  out.rakeFt*=1.32;
 }
 if(topology?.edges?.length){
  const t={ridgeFt:0,hipFt:0,valleyFt:0,eaveFt:0,rakeFt:0,perimeterFt:0};
  for(const e of topology.edges){
   const k=e.type==="ridge"?"ridgeFt":e.type==="hip"?"hipFt":e.type==="valley"?"valleyFt":e.type==="eave"?"eaveFt":e.type==="rake"?"rakeFt":e.type==="perimeter"?"perimeterFt":null;
   if(k)t[k]+=Number(e.lengthMeters||0)*3.280839895;
  }
  for(const k of ["ridgeFt","hipFt","valleyFt","eaveFt","rakeFt"])if(!(out[k]>0)&&t[k]>0)out[k]=t[k];
 }
 if(out.eaveFt>0||out.rakeFt>0)out.perimeterFt=out.eaveFt+out.rakeFt;
 return out;
}
function currentMetrics(sm,outline,profileOverrides){
 let topology=null,facetPartitionTopology=null;
 try{topology=buildRoofTopology(sm,{profileOverrides:profileOverrides||{}})}catch{}
 try{facetPartitionTopology=buildFacetPartitionTopology(sm)}catch{}
 const modelFacets=(sm?.model?.facets||[]).filter(f=>Number(f.slopedAreaSqFt||0)>0);
 // Match production reporting: Google DSM model is authoritative for area,
 // pitch and facet count. Topology faces are derived geometry used for line
 // solving and can overlap while the solver is still learning.
 const facetAreas=modelFacets.map(f=>num(f.slopedAreaSqFt)).filter(Number.isFinite);
 const modelArea=num(sm?.model?.slopedAreaSqFt);
 const googleWhole=num(sm?.googleWholeRoofAreaFt2);
 const footprint=num(outline?.measurement?.planAreaFt2)||num(sm?.model?.footprintSqFt);
 const w=modelFacets.map(f=>({p:num(f.rise12),a:num(f.slopedAreaSqFt)||0})).filter(x=>x.p!=null);
 const aw=w.reduce((s,x)=>s+x.a,0);
 const avgPitch=w.length?(aw?w.reduce((s,x)=>s+x.p*x.a,0)/aw:w.reduce((s,x)=>s+x.p,0)/w.length):null;

 // Three independent area estimates are available: Google wholeRoofStats, the
 // decoded DSM facet surface, and footprint × pitch. A robust median consensus
 // is materially more stable than trusting Google alone when one source is low.
 const areaRatio=(googleWhole&&modelArea)?googleWhole/modelArea:null;
 const googleAreaSane=googleWhole!=null&&googleWhole>0
   &&(areaRatio==null||(areaRatio>=.55&&areaRatio<=1.8))
   &&(!footprint||googleWhole/footprint<=3);
 const footprintPitchArea=(footprint&&avgPitch!=null)
   ?footprint*Math.sqrt(1+Math.pow(avgPitch/12,2))
   :null;
 // Shadow candidate selected from deterministic five-fold validation:
 // when Google and DSM agree reasonably well, their midpoint is more stable;
 // when DSM is >20% above Google, the DSM surface better captures the large
 // under-measured roofs. This remains benchmark-only until it clears the gate.
 const dsmGoogleRatio=(googleWhole&&modelArea)?modelArea/googleWhole:null;
 const disagreementBlendArea=(googleWhole&&modelArea)
   ?(dsmGoogleRatio>=1.20?modelArea:(googleWhole+modelArea)/2)
   :null;
 const areaCandidates=[
   googleAreaSane?googleWhole:null,
   modelArea!=null&&modelArea>0?modelArea:null,
   footprintPitchArea!=null&&footprintPitchArea>0?footprintPitchArea:null
 ].filter(Number.isFinite);
 const legacyConsensusArea=areaCandidates.length?median(areaCandidates):(facetAreas.reduce((a,b)=>a+b,0));
 const slopedArea=disagreementBlendArea!=null&&disagreementBlendArea>0
   ?disagreementBlendArea
   :legacyConsensusArea;
 const edges=edgeTotals(topology,sm);
 const topologyInternal=topologyInternalTotals(topology);
 const confidenceHip=confidenceFilteredHipFt(sm);
 const confidenceValley=confidenceFilteredValleyFt(sm);
 const promotedRasterRidge=num(sm?.measurementCandidates?.rasterLines?.ridgeFt);
 if(promotedRasterRidge!=null&&promotedRasterRidge>=0){
  edges.ridgeFt=promotedRasterRidge;
 }
 if(Array.isArray(sm?.model?.roofLines)){
  edges.hipFt=confidenceHip;
  edges.valleyFt=confidenceValley;
 }
 const detailBoundary=sm?.measurementCandidates?.detailBoundary||null;
 const detailEave=num(detailBoundary?.eaveFt);
 const detailRake=num(detailBoundary?.rakeFt);
 const detailPerimeter=(detailEave!=null||detailRake!=null)?Number(detailEave||0)+Number(detailRake||0):null;
 const rasterLines=sm?.measurementCandidates?.rasterLines||null;
 const smallFeatureExterior=sm?.smallFeatureExteriorCandidate||null;
 const areaMargins=sm?.areaMarginCandidates||{};
 const areaMargin25=num(areaMargins?.["0.25"]?.slopedAreaSqFt);
 const areaMargin50=num(areaMargins?.["0.5"]?.slopedAreaSqFt);
 const areaMargin75=num(areaMargins?.["0.75"]?.slopedAreaSqFt);
 const edgeSnaps=sm?.areaEdgeSnapCandidates||{};
 const edgeSnapConservativeAdj=num(edgeSnaps?.conservative?.areaAdjustmentSqFt);
 const edgeSnapBalancedAdj=num(edgeSnaps?.balanced?.areaAdjustmentSqFt);
 const edgeSnapRgbAdj=num(edgeSnaps?.rgb?.areaAdjustmentSqFt);
 const edgeSnapConservative=slopedArea!=null&&edgeSnapConservativeAdj!=null?Math.max(1,slopedArea+edgeSnapConservativeAdj):null;
 const edgeSnapBalanced=slopedArea!=null&&edgeSnapBalancedAdj!=null?Math.max(1,slopedArea+edgeSnapBalancedAdj):null;
 const edgeSnapRgb=slopedArea!=null&&edgeSnapRgbAdj!=null?Math.max(1,slopedArea+edgeSnapRgbAdj):null;
 const rasterRidge=num(rasterLines?.ridgeFt);
 const rasterHip=num(rasterLines?.hipFt);
 const rasterValley=num(rasterLines?.valleyFt);
 const topologyFaces=(topology?.faces||[]).filter(f=>Number(f.slopedAreaSqFt||0)>0);
 const topologyFaceAreaFt2=topologyFaces.reduce((s,f)=>s+Number(f.slopedAreaSqFt||0),0);
 const facetPartitionFaces=(facetPartitionTopology?.faces||[]).filter(f=>Number(f.slopedAreaSqFt||0)>0);
 const facetPartitionFaceAreaFt2=facetPartitionFaces.reduce((s,f)=>s+Number(f.slopedAreaSqFt||0),0);
 return {
  facetCount:modelFacets.length,slopedAreaFt2:slopedArea,avgPitch12:avgPitch,
  googleSegmentCount:num(sm?.googleRoofSegmentCount),
  dsmFacetCount:modelFacets.length,
  topologyFaceCount:topologyFaces.length,
  topologyFaceAreaFt2,
  facetPartitionFaceCount:facetPartitionFaces.length,
  facetPartitionFaceAreaFt2,
  facetPartitionCandidateEdges:Number(facetPartitionTopology?.stats?.acceptedCandidateEdges||0),
  ...edges,ridgeHipFt:Number(edges.ridgeFt||0)+Number(edges.hipFt||0),
  detailBoundaryEaveFt:detailEave,
  detailBoundaryRakeFt:detailRake,
  detailBoundaryPerimeterFt:detailPerimeter,
  rasterLineCandidateRidgeFt:rasterRidge,
  rasterLineCandidateHipFt:rasterHip,
  rasterLineCandidateValleyFt:rasterValley,
  smallFeatureExteriorEaveFt:num(smallFeatureExterior?.eaveFt),
  smallFeatureExteriorRakeFt:num(smallFeatureExterior?.rakeFt),
  smallFeatureExteriorPerimeterFt:num(smallFeatureExterior?.perimeterFt),
  smallFeatureExteriorAddedEaveFt:num(smallFeatureExterior?.addedEaveFt),
  smallFeatureExteriorAddedRakeFt:num(smallFeatureExterior?.addedRakeFt),
  smallFeatureExteriorAddedEdges:num(smallFeatureExterior?.addedEdges),
  topologyInternalHipFt:num(topologyInternal.hipFt),
  topologyInternalValleyFt:num(topologyInternal.valleyFt),
  confidenceHipCandidateFt:num(confidenceHip),
  confidenceValleyCandidateFt:num(confidenceValley),
  calibratedExteriorEaveFt:Number(edges.eaveFt||0)*1.20,
  calibratedExteriorRakeFt:Number(edges.rakeFt||0)*1.32,
  exteriorCalibrationApplied:modelFacets.length>=7,
  footprintAreaFt2:footprint,
  footprintPerimeterFt:num(outline?.measurement?.perimeterFt),
  facetAreasFt2:facetAreas,
  googleWholeRoofAreaFt2:googleWhole,
  rasterFacetAreaFt2:modelArea,
  areaAuthority:disagreementBlendArea!=null&&disagreementBlendArea>0?"source-disagreement-blend-v1":(areaCandidates.length>=2?"consensus-median-fallback":(googleAreaSane?"google-whole-roof":"dsm-surface-area")),
  googleAreaRejected:googleWhole!=null&&!googleAreaSane,
  footprintPitchAreaFt2:footprintPitchArea,
  disagreementBlendAreaFt2:disagreementBlendArea,
  legacyConsensusAreaFt2:legacyConsensusArea,
  areaMarginCandidate25Ft2:areaMargin25,
  areaMarginCandidate50Ft2:areaMargin50,
  areaMarginCandidate75Ft2:areaMargin75,
  edgeSnapConservativeAreaFt2:edgeSnapConservative,
  edgeSnapBalancedAreaFt2:edgeSnapBalanced,
  edgeSnapRgbAreaFt2:edgeSnapRgb,
  areaEdgeSnapDiagnostics:edgeSnaps,
  areaMarginDiagnostics:sm?.areaMarginDiagnostics||null,
  trainingVersion:sm?.trainingVersion||null,
  areaCandidateCount:areaCandidates.length,
  rasterToGoogleAreaRatio:(googleWhole&&modelArea)?modelArea/googleWhole:null,
  learnedProfile:topology?.learnedProfile||null,
  topologyVersion:topology?.version||null,
  facetEngineVersion:sm?.model?.facetEngineVersion||null,
  lineEngineVersion:sm?.model?.lineEngineVersion||null,
  geometryMode:sm?.model?.geometryMode||null,
  reportLineEngineVersion:promotedRasterRidge!=null?"hybrid-confidence-lines-v2":"topology-v5-fallback",
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
  topologyFaces:ref.facetCount&&cur.topologyFaceCount!=null?Math.abs(cur.topologyFaceCount-ref.facetCount)/ref.facetCount*100:null,
  topologyFaceArea:pct(cur.topologyFaceAreaFt2,ref.slopedAreaFt2),
  facetPartitionFaces:ref.facetCount&&cur.facetPartitionFaceCount!=null?Math.abs(cur.facetPartitionFaceCount-ref.facetCount)/ref.facetCount*100:null,
  facetPartitionFaceArea:pct(cur.facetPartitionFaceAreaFt2,ref.slopedAreaFt2),
  areaMargin25:pct(cur.areaMarginCandidate25Ft2,ref.slopedAreaFt2),
  areaMargin50:pct(cur.areaMarginCandidate50Ft2,ref.slopedAreaFt2),
  areaMargin75:pct(cur.areaMarginCandidate75Ft2,ref.slopedAreaFt2),
  edgeSnapConservative:pct(cur.edgeSnapConservativeAreaFt2,ref.slopedAreaFt2),
  edgeSnapBalanced:pct(cur.edgeSnapBalancedAreaFt2,ref.slopedAreaFt2),
  edgeSnapRgb:pct(cur.edgeSnapRgbAreaFt2,ref.slopedAreaFt2),
  disagreementBlend:pct(cur.disagreementBlendAreaFt2,ref.slopedAreaFt2),
  legacyConsensus:pct(cur.legacyConsensusAreaFt2,ref.slopedAreaFt2)
 };
 const edgeKeys=(ref.ridgeHipFt!=null?["ridgeHipFt"]:["ridgeFt","hipFt"]).concat(["valleyFt","eaveFt","rakeFt"]);
 // Provider perimeter is normally the same exterior roof edge already represented
 // by eave + rake. Do not count it a second time in the aggregate line score.
 if(ref.eaveFt==null&&ref.rakeFt==null&&ref.perimeterFt!=null)edgeKeys.push("perimeterFt");
 const edgePairs=edgeKeys
   .filter(k=>ref[k]!=null&&Number.isFinite(Number(cur[k])))
   .map(k=>({k,ref:Number(ref[k]),cur:Number(cur[k])}));
 // A tiny reference category (for example a 0.5 ft valley) should not dominate
 // the entire roof-line score by thousands of percent. Score the takeoff as a
 // total normalized absolute-length error across all available line categories.
 const edgeRefTotal=edgePairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const edgeAbsError=edgePairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.edgeCategoryPct=Object.fromEntries(edgePairs.map(x=>[x.k,pct(x.cur,x.ref)]));
 errors.edges=edgeRefTotal>0?edgeAbsError/edgeRefTotal*100:null;

 const detailPairs=edgeKeys
   .filter(k=>ref[k]!=null)
   .map(k=>{
     let cv=cur[k];
     if(k==="eaveFt"&&cur.detailBoundaryEaveFt!=null)cv=cur.detailBoundaryEaveFt;
     if(k==="rakeFt"&&cur.detailBoundaryRakeFt!=null)cv=cur.detailBoundaryRakeFt;
     if(k==="perimeterFt"&&cur.detailBoundaryPerimeterFt!=null)cv=cur.detailBoundaryPerimeterFt;
     return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
   }).filter(Boolean);
 const detailRefTotal=detailPairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const detailAbsError=detailPairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.detailBoundaryEdges=detailRefTotal>0?detailAbsError/detailRefTotal*100:null;

 const rasterPairs=edgeKeys
   .filter(k=>ref[k]!=null)
   .map(k=>{
     let cv=cur[k];
     if(k==="ridgeFt"&&cur.rasterLineCandidateRidgeFt!=null)cv=cur.rasterLineCandidateRidgeFt;
     if(k==="hipFt"&&cur.rasterLineCandidateHipFt!=null)cv=cur.rasterLineCandidateHipFt;
     if(k==="ridgeHipFt"&&(cur.rasterLineCandidateRidgeFt!=null||cur.rasterLineCandidateHipFt!=null))cv=Number(cur.rasterLineCandidateRidgeFt||0)+Number(cur.rasterLineCandidateHipFt||0);
     if(k==="valleyFt"&&cur.rasterLineCandidateValleyFt!=null)cv=cur.rasterLineCandidateValleyFt;
     return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
   }).filter(Boolean);
 const rasterRefTotal=rasterPairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const rasterAbsError=rasterPairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.rasterLineCandidateEdges=rasterRefTotal>0?rasterAbsError/rasterRefTotal*100:null;

 const smallExteriorPairs=edgeKeys
   .filter(k=>ref[k]!=null)
   .map(k=>{
     let cv=cur[k];
     if(k==="eaveFt"&&cur.smallFeatureExteriorEaveFt!=null)cv=cur.smallFeatureExteriorEaveFt;
     if(k==="rakeFt"&&cur.smallFeatureExteriorRakeFt!=null)cv=cur.smallFeatureExteriorRakeFt;
     return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
   }).filter(Boolean);
 const smallExteriorRefTotal=smallExteriorPairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const smallExteriorAbsError=smallExteriorPairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.smallFeatureExteriorEdges=smallExteriorRefTotal>0?smallExteriorAbsError/smallExteriorRefTotal*100:null;

 // Holdout-tested exterior calibration candidate. Ridge/hip/valley remain
 // unchanged; only the systematic exterior undercount is corrected.
 const calibratedExteriorPairs=edgeKeys
   .filter(k=>ref[k]!=null)
   .map(k=>{
     let cv=cur[k];
     if(k==="eaveFt"&&cur.calibratedExteriorEaveFt!=null)cv=cur.calibratedExteriorEaveFt;
     if(k==="rakeFt"&&cur.calibratedExteriorRakeFt!=null)cv=cur.calibratedExteriorRakeFt;
     return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
   }).filter(Boolean);
 const calibratedExteriorRefTotal=calibratedExteriorPairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const calibratedExteriorAbsError=calibratedExteriorPairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.calibratedExteriorEdges=calibratedExteriorRefTotal>0?calibratedExteriorAbsError/calibratedExteriorRefTotal*100:null;

 // Hybrid shadow candidate: raster adjacency is substantially better at ridge
 // length, while plane-v5 remains better for hips and valleys. This combines
 // those source strengths without consulting reference truth at runtime.
 const hybridPairs=edgeKeys
   .filter(k=>ref[k]!=null)
   .map(k=>{
     let cv=cur[k];
     if(k==="ridgeFt"&&cur.rasterLineCandidateRidgeFt!=null)cv=cur.rasterLineCandidateRidgeFt;
     if(k==="ridgeHipFt"&&cur.rasterLineCandidateRidgeFt!=null)cv=Number(cur.rasterLineCandidateRidgeFt||0)+Number(cur.hipFt||0);
     return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
   }).filter(Boolean);
 const hybridRefTotal=hybridPairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const hybridAbsError=hybridPairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.hybridRidgeEdges=hybridRefTotal>0?hybridAbsError/hybridRefTotal*100:null;

 // Shadow candidate: keep the validated raster ridge and physical exterior split,
 // but swap only hips and valleys to the independent planar-topology solver.
 const topoInternalPairs=edgeKeys
   .filter(k=>ref[k]!=null)
   .map(k=>{
     let cv=cur[k];
     if(k==="hipFt"&&cur.topologyInternalHipFt!=null)cv=cur.topologyInternalHipFt;
     if(k==="valleyFt"&&cur.topologyInternalValleyFt!=null)cv=cur.topologyInternalValleyFt;
     if(k==="ridgeHipFt"&&cur.topologyInternalHipFt!=null)cv=Number(cur.ridgeFt||0)+Number(cur.topologyInternalHipFt||0);
     return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
   }).filter(Boolean);
 const topoInternalRefTotal=topoInternalPairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const topoInternalAbsError=topoInternalPairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.topologyInternalEdges=topoInternalRefTotal>0?topoInternalAbsError/topoInternalRefTotal*100:null;

 // Shadow candidate: retain raster ridge, current valleys and physical
 // eave/rake, but discard weak/short hip detections using line-confidence data.
 const hipConfidencePairs=edgeKeys
  .filter(k=>ref[k]!=null)
  .map(k=>{
    let cv=cur[k];
    if(k==="hipFt"&&cur.confidenceHipCandidateFt!=null)cv=cur.confidenceHipCandidateFt;
    if(k==="ridgeHipFt"&&cur.confidenceHipCandidateFt!=null)cv=Number(cur.ridgeFt||0)+Number(cur.confidenceHipCandidateFt||0);
    return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
  }).filter(Boolean);
 const hipConfidenceRefTotal=hipConfidencePairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const hipConfidenceAbsError=hipConfidencePairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.hipConfidenceEdges=hipConfidenceRefTotal>0?hipConfidenceAbsError/hipConfidenceRefTotal*100:null;

 // Combined shadow candidate: validated raster ridge + confidence-filtered hips
 // and valleys + the physical eave/rake classifier.
 const internalConfidencePairs=edgeKeys
  .filter(k=>ref[k]!=null)
  .map(k=>{
    let cv=cur[k];
    if(k==="hipFt"&&cur.confidenceHipCandidateFt!=null)cv=cur.confidenceHipCandidateFt;
    if(k==="valleyFt"&&cur.confidenceValleyCandidateFt!=null)cv=cur.confidenceValleyCandidateFt;
    if(k==="ridgeHipFt"&&cur.confidenceHipCandidateFt!=null)cv=Number(cur.ridgeFt||0)+Number(cur.confidenceHipCandidateFt||0);
    return Number.isFinite(Number(cv))?{k,ref:Number(ref[k]),cur:Number(cv)}:null;
  }).filter(Boolean);
 const internalConfidenceRefTotal=internalConfidencePairs.reduce((s,x)=>s+Math.abs(x.ref),0);
 const internalConfidenceAbsError=internalConfidencePairs.reduce((s,x)=>s+Math.abs(x.cur-x.ref),0);
 errors.internalConfidenceEdges=internalConfidenceRefTotal>0?internalConfidenceAbsError/internalConfidenceRefTotal*100:null;

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
 if(/garage/.test(archetype))return "detached-garage";
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
 const optimizerValid=optimizer?.version==="topology-opt-3-holdout"&&optimizer?.scopePolicy==="primary-building-only"&&optimizer?.validationPolicy==="deterministic-profile-holdout";
 const profileOverrides=optimizerValid?(optimizer?.profileOverrides||{}):{};
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
  lineEngineV5RestoredCases:geometryRows.filter(r=>r.current?.lineEngineVersion==="plane-dsm-trace-v5-restored").length,
  staleLineEngineCases:geometryRows.filter(r=>r.current?.lineEngineVersion!=="plane-dsm-trace-v5-restored").length,
  detailBoundaryCases:geometryRows.filter(r=>r.current?.detailBoundaryPerimeterFt!=null).length,
  rasterLineCandidateCases:geometryRows.filter(r=>r.current?.rasterLineCandidateRidgeFt!=null).length,
  smallFeatureExteriorCases:geometryRows.filter(r=>r.current?.smallFeatureExteriorEaveFt!=null).length,
  calibratedExteriorCases:geometryRows.filter(r=>r.current?.calibratedExteriorEaveFt!=null).length,
  areaMargin25CandidateCases:geometryRows.filter(r=>r.current?.areaMarginCandidate25Ft2!=null).length,
  areaMargin50CandidateCases:geometryRows.filter(r=>r.current?.areaMarginCandidate50Ft2!=null).length,
  areaMargin75CandidateCases:geometryRows.filter(r=>r.current?.areaMarginCandidate75Ft2!=null).length,
  areaMarginCandidateCases:geometryRows.filter(r=>r.current?.areaMarginCandidate50Ft2!=null).length,
  edgeSnapConservativeCases:geometryRows.filter(r=>r.current?.edgeSnapConservativeAreaFt2!=null).length,
  edgeSnapBalancedCases:geometryRows.filter(r=>r.current?.edgeSnapBalancedAreaFt2!=null).length,
  edgeSnapRgbCases:geometryRows.filter(r=>r.current?.edgeSnapRgbAreaFt2!=null).length,
  disagreementBlendCases:geometryRows.filter(r=>r.current?.disagreementBlendAreaFt2!=null).length,
  legacyConsensusCases:geometryRows.filter(r=>r.current?.legacyConsensusAreaFt2!=null).length,
  averageScore:mean(scored.map(r=>r.score.overall)),medianScore:median(scored.map(r=>r.score.overall)),
  averageAreaErrorPct:av("area"),
  averageAreaMargin25ErrorPct:av("areaMargin25"),
  averageAreaMargin50ErrorPct:av("areaMargin50"),
  averageAreaMargin75ErrorPct:av("areaMargin75"),
  averageEdgeSnapConservativeErrorPct:av("edgeSnapConservative"),
  averageEdgeSnapBalancedErrorPct:av("edgeSnapBalanced"),
  averageEdgeSnapRgbErrorPct:av("edgeSnapRgb"),
  averageDisagreementBlendErrorPct:av("disagreementBlend"),
  averageLegacyConsensusErrorPct:av("legacyConsensus"),
  averageFacetErrorPct:av("facets"),averageEdgeErrorPct:av("edges"),
  averageDetailBoundaryEdgeErrorPct:av("detailBoundaryEdges"),
  averageRasterLineCandidateEdgeErrorPct:av("rasterLineCandidateEdges"),
  averageSmallFeatureExteriorEdgeErrorPct:av("smallFeatureExteriorEdges"),
  averageCalibratedExteriorEdgeErrorPct:av("calibratedExteriorEdges"),
  averageHybridRidgeEdgeErrorPct:av("hybridRidgeEdges"),
  averageTopologyInternalEdgeErrorPct:av("topologyInternalEdges"),
  averageHipConfidenceEdgeErrorPct:av("hipConfidenceEdges"),
  averageInternalConfidenceEdgeErrorPct:av("internalConfidenceEdges"),
  averagePitchErrorPct:av("pitch"),averageFootprintAreaErrorPct:av("footprintArea"),averageFootprintPerimeterErrorPct:av("footprintPerimeter"),
  averageGoogleSegmentFacetErrorPct:av("googleSegments"),averageDsmFacetErrorPct:av("dsmFacets"),averageTopologyFaceErrorPct:av("topologyFaces"),
  averageTopologyFaceAreaErrorPct:av("topologyFaceArea"),
  averageFacetPartitionFaceErrorPct:av("facetPartitionFaces"),
  averageFacetPartitionAreaErrorPct:av("facetPartitionFaceArea"),
  regressionGate:{maxAreaErrorPct:8,maxFacetErrorPct:25,maxEdgeErrorPct:25,minOverallScore:70},
  topologyOptimizerVersion:optimizerValid?optimizer.version:null,
  ignoredTopologyOptimizerVersion:!optimizerValid?(optimizer?.version||null):null,
  optimizedProfiles:Object.keys(profileOverrides).length
 };
 for(const r of rows)if(r.status==="scored"){
  const e=r.score.errors,g=summary.regressionGate;
  r.gatePass=(r.score.overall>=g.minOverallScore)&&(e.area==null||e.area<=g.maxAreaErrorPct)&&(e.facets==null||e.facets<=g.maxFacetErrorPct)&&(e.edges==null||e.edges<=g.maxEdgeErrorPct);
 }
 return json({ok:true,summary,rows});
}