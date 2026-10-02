const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const safe=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9-_]/g,"-").replace(/-+/g,"-").slice(0,96);
const num=v=>{const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n:null};
function parseJsonLoose(s){try{return JSON.parse(s)}catch{}const m=String(s||"").match(/\{[\s\S]*\}/);if(m)try{return JSON.parse(m[0])}catch{}return null}
function fallback(text){
 const t=String(text||"");
 const find=(labels)=>{for(const l of labels){const r=new RegExp(l+"[^0-9]{0,30}([0-9][0-9,]*(?:\\.[0-9]+)?)","i").exec(t);if(r)return num(r[1])}return null};
 const pitch=(()=>{const m=t.match(/(?:average\s+pitch|avg\.?\s+pitch|pitch)[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)\s*\/\s*12/i);return m?num(m[1]):null})();
 return {
  source:/roofr/i.test(t)?"Roofr":/hover/i.test(t)?"Hover":"Uploaded report",
  slopedAreaFt2:find(["(?:total\s+)?roof\s+area","sloped\s+(?:roof\s+)?area","total\s+area"]),
  facetCount:find(["(?:total\s+)?facets?","roof\s+facets?"]),
  avgPitch12:pitch,
  perimeterFt:find(["(?:roof\s+)?perimeter"]),
  ridgeFt:find(["(?:total\s+)?ridge"]),
  hipFt:find(["(?:total\s+)?hip"]),
  valleyFt:find(["(?:total\s+)?valley"]),
  eaveFt:find(["(?:total\s+)?eave"]),
  rakeFt:find(["(?:total\s+)?rake"]),
  ridgeHipFt:find(["ridges?\s*\/\s*hips?","hips?\s*\+\s*ridges?"]),
  footprintAreaFt2:find(["footprint\s+area"]),
  footprintPerimeterFt:find(["footprint\s+perimeter"]),
  flatAreaFt2:find(["flat\s+roof\s+area","total\s+flat\s+area"]),
  scope:/detached\s+garage/i.test(t)?"detached-garage":/main\s+house/i.test(t)?"primary-building":"unknown",
  pitchAreas:{},
  facetAreasFt2:[]
 };
}
async function aiExtract(env,text){
 if(!env.AI)return null;
 const prompt=`Extract roof measurement benchmark values from the report text below.
Return ONLY valid JSON with keys:
source, address, scope, slopedAreaFt2, facetCount, avgPitch12, perimeterFt, footprintAreaFt2, footprintPerimeterFt, ridgeFt, hipFt, ridgeHipFt, valleyFt, eaveFt, rakeFt, flatAreaFt2, pitchAreas, facetAreasFt2.
Use numbers only for numeric fields, null if unavailable. avgPitch12 means the predominant pitch numerator of x/12. scope must be one of "primary-building", "detached-garage", "all-structures", or "unknown". For Hover, use the stated "Ridges / Hips" combined value as ridgeHipFt and do not split it. pitchAreas must be an object mapping pitch numerator strings to stated square-foot areas, for example {"5":1429,"3":276}. facetAreasFt2 must be an array of individual facet areas only when clearly listed; otherwise [].
Do not infer or calculate missing values. Prefer the report's stated totals over sums from rounded labels.

REPORT TEXT:
${String(text||"").slice(0,50000)}`;
 try{
  const r=await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast",{messages:[{role:"system",content:"You extract structured roof-report measurements with high precision."},{role:"user",content:prompt}],temperature:0,max_tokens:700});
  return parseJsonLoose(r?.response||r?.result?.response||r?.result||"");
 }catch{return null}
}
export async function onRequestPost({request,env}){
 if(!env.MEASURE_PHOTOS)return json({error:"R2 binding MEASURE_PHOTOS is not configured."},500);
 const body=await request.json().catch(()=>({}));
 const projectId=safe(body.projectId),text=String(body.text||""),fileName=String(body.fileName||"reference-report.pdf").slice(0,180);
 if(!projectId||!text)return json({error:"projectId and extracted report text are required."},400);
 const base=fallback(text),ai=await aiExtract(env,text),merged={...base,...Object.fromEntries(Object.entries(ai||{}).filter(([,v])=>v!==null&&v!==undefined&&v!==""))};
 merged.facetAreasFt2=Array.isArray(merged.facetAreasFt2)?merged.facetAreasFt2.map(num).filter(v=>v!=null&&v>0):[];
 for(const k of ["slopedAreaFt2","facetCount","avgPitch12","perimeterFt","footprintAreaFt2","footprintPerimeterFt","ridgeFt","hipFt","ridgeHipFt","valleyFt","eaveFt","rakeFt","flatAreaFt2"])merged[k]=num(merged[k]);
 merged.scope=["primary-building","detached-garage","all-structures","unknown"].includes(String(merged.scope))?String(merged.scope):"unknown";
 if(!merged.pitchAreas||typeof merged.pitchAreas!=="object"||Array.isArray(merged.pitchAreas))merged.pitchAreas={};
 else merged.pitchAreas=Object.fromEntries(Object.entries(merged.pitchAreas).map(([k,v])=>[String(k),num(v)]).filter(([,v])=>v!=null&&v>=0));
 const record={version:2,projectId,fileName,address:String(merged.address||body.address||""),createdAt:new Date().toISOString(),extracted:merged,textLength:text.length};
 await Promise.all([
  env.MEASURE_PHOTOS.put(projectId+"/_reference_report.json",JSON.stringify(record),{httpMetadata:{contentType:"application/json"}}),
  env.MEASURE_PHOTOS.put("reference-reports/"+projectId+".json",JSON.stringify(record),{httpMetadata:{contentType:"application/json"}}),
  env.MEASURE_PHOTOS.put("reference-reports/"+projectId+".txt",text,{httpMetadata:{contentType:"text/plain; charset=utf-8"}})
 ]);
 return json({ok:true,report:record});
}