function json(data,status=200){
  return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function outputText(data){
  if(typeof data?.output_text==="string"&&data.output_text.trim())return data.output_text.trim();
  const out=[];
  for(const item of data?.output||[])for(const part of item?.content||[])if(part?.type==="output_text"&&part.text)out.push(part.text);
  return out.join("\n").trim();
}
function parseJson(raw){
  const text=String(raw||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();
  try{return JSON.parse(text);}catch{}
  const a=text.indexOf("{"),b=text.lastIndexOf("}");
  if(a>=0&&b>a){try{return JSON.parse(text.slice(a,b+1));}catch{}}
  return null;
}
function prompt(existingFacets){
  return `You are reviewing multiple exterior/drone photographs of the SAME residential roof to improve an existing aerial/DSM roof-facet model.

Existing automatic model reports ${existingFacets} primary roof facets.

Analyze only clearly visible roof geometry across the supplied angles. Do not estimate roof area or dimensions. Your job is to identify topology and whether the existing facet count is plausible.

Return ONLY JSON:
{
  "visible_primary_facets_min": 0,
  "visible_primary_facets_max": 0,
  "roof_form": "gable|hip|cross-gable|cross-hip|mixed|flat|unknown",
  "features": {
    "dormers": 0,
    "visible_valleys": 0,
    "visible_hips": 0,
    "visible_ridge_groups": 0
  },
  "existing_model_agreement": "good|partial|poor",
  "confidence": 0,
  "notes": ["short factual observation"]
}

Rules:
- Treat different photos as different views of the same building and reconcile them.
- Count major planar roof facets, not tiny flashing pieces, vents, skylights, gutters, shadows, or tree cover.
- Use shadows only as supporting evidence for plane breaks; do not treat a shadow edge by itself as a facet.
- confidence is 0-100 based on whether the photos clearly expose enough of the roof.
- If views are inadequate, return unknown/low confidence rather than guessing.
- existing_model_agreement compares the visible multi-angle evidence to the stated existing facet count.
- Keep notes brief and factual.`;
}
export async function onRequestPost(context){
  const {request,env}=context;
  const key=String(env.OPENAI_API_KEY||"").trim();
  if(!key)return json({ok:false,error:"Multi-angle AI review is not configured."},503);

  let form;
  try{form=await request.formData();}catch{return json({ok:false,error:"Could not read the uploaded roof photos."},400);}
  const files=form.getAll("photos").filter(f=>f&&typeof f.arrayBuffer==="function");
  if(files.length<3||files.length>8)return json({ok:false,error:"Upload 3 to 8 roof photos from different angles."},400);
  const existingFacets=Math.max(0,Math.min(20,Number(form.get("existing_facets"))||0));

  let total=0;
  const content=[{type:"input_text",text:prompt(existingFacets)}];
  for(const file of files){
    if(!String(file.type||"").startsWith("image/"))return json({ok:false,error:"All uploads must be images."},400);
    if(file.size>2.5*1024*1024)return json({ok:false,error:"Each photo must be under 2.5 MB after compression."},413);
    total+=file.size;
    if(total>14*1024*1024)return json({ok:false,error:"The combined photo upload is too large."},413);
    const bytes=new Uint8Array(await file.arrayBuffer());
    let binary="";
    const chunk=0x8000;
    for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
    content.push({type:"input_image",image_url:"data:"+file.type+";base64,"+btoa(binary),detail:"low"});
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),40000);
  let upstream,raw="";
  try{
    upstream=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},
      signal:controller.signal,
      body:JSON.stringify({
        model:String(env.OPENAI_VISION_MODEL||"gpt-5.6-luna"),
        store:false,
        reasoning:{effort:"low"},
        max_output_tokens:1200,
        input:[{role:"user",content}]
      })
    });
    raw=await upstream.text();
  }catch(error){
    return json({ok:false,error:controller.signal.aborted?"Multi-angle review timed out.":"Could not analyze the roof photos."},502);
  }finally{clearTimeout(timer);}

  let data={};try{data=JSON.parse(raw);}catch{}
  if(!upstream.ok)return json({ok:false,error:String(data?.error?.message||"Multi-angle analysis failed.").slice(0,300)},502);
  const parsed=parseJson(outputText(data));
  if(!parsed)return json({ok:false,error:"The multi-angle review returned an unreadable result."},502);

  const min=Math.max(0,Math.min(20,Number(parsed.visible_primary_facets_min)||0));
  const max=Math.max(min,Math.min(20,Number(parsed.visible_primary_facets_max)||min));
  const confidence=Math.max(0,Math.min(100,Number(parsed.confidence)||0));
  const agreement=["good","partial","poor"].includes(parsed.existing_model_agreement)?parsed.existing_model_agreement:"partial";

  return json({ok:true,review:{
    visible_primary_facets_min:min,
    visible_primary_facets_max:max,
    roof_form:String(parsed.roof_form||"unknown").slice(0,40),
    features:parsed.features||{},
    existing_model_agreement:agreement,
    confidence,
    notes:Array.isArray(parsed.notes)?parsed.notes.slice(0,6).map(x=>String(x).slice(0,180)):[]
  }});
}
