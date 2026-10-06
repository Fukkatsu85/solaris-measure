async function googleJson(url, key){
  const cleanKey=String(key||"").trim().replace(/^["']|["']$/g,"");
  const g=new URL(url);
  g.searchParams.set("key",cleanKey);
  const r=await fetch(g.toString(),{headers:{"x-goog-api-key":cleanKey}});
  const text=await r.text();
  let data={};try{data=JSON.parse(text)}catch{}
  if(!r.ok){
    return {ok:false,status:r.status,error:data?.error?.message||text.slice(0,500)||("HTTP "+r.status),data};
  }
  return {ok:true,status:r.status,data};
}

export async function onRequestGet({request,env}){
  const rawKey=env.GOOGLE_AERIAL_VIEW_API_KEY;
  if(!rawKey)return Response.json({ok:false,error:"GOOGLE_AERIAL_VIEW_API_KEY is not configured.",keyConfigured:false},{status:500});
  const key=String(rawKey).trim().replace(/^["']|["']$/g,"");
  const keyDiagnostics={keyConfigured:true,keyLength:key.length,keyLooksLikeGoogleApiKey:/^AIza[0-9A-Za-z_-]{30,}$/.test(key)};
  const u=new URL(request.url),address=(u.searchParams.get("address")||"").trim(),videoId=(u.searchParams.get("videoId")||"").trim(),mode=(u.searchParams.get("mode")||"metadata").trim();
  if(!address&&!videoId)return Response.json({ok:false,error:"address or videoId is required"},{status:400});
  const base="https://aerialview.googleapis.com/v1/videos:";
  const endpoint=mode==="video"?"lookupVideo":"lookupVideoMetadata";
  const g=new URL(base+endpoint);
  if(videoId)g.searchParams.set("videoId",videoId);else g.searchParams.set("address",address);
  const out=await googleJson(g.toString(),key);
  if(!out.ok)return Response.json({ok:false,status:out.status,error:out.error,notFound:out.status===404,...keyDiagnostics},{status:out.status>=400&&out.status<600?out.status:502});
  const d=out.data||{},meta=d.metadata||d;
  return Response.json({
    ok:true,mode,...keyDiagnostics,state:d.state||meta.state||null,videoId:meta.videoId||d.videoId||videoId||null,
    captureDate:meta.captureDate||d.captureDate||null,duration:meta.duration||d.duration||null,
    uris:mode==="video"?(d.uris||{}):undefined
  },{headers:{"cache-control":"private, max-age=0, no-store"}});
}


export async function onRequestPost({request,env}){
  const rawKey=env.GOOGLE_AERIAL_VIEW_API_KEY;
  if(!rawKey)return Response.json({ok:false,error:"GOOGLE_AERIAL_VIEW_API_KEY is not configured."},{status:500});
  const key=String(rawKey).trim().replace(/^["']|["']$/g,"");
  const body=await request.json().catch(()=>({}));
  const address=String(body?.address||"").trim();
  if(!address)return Response.json({ok:false,error:"address is required"},{status:400});
  const g=new URL("https://aerialview.googleapis.com/v1/videos:renderVideo");
  g.searchParams.set("key",key);
  const r=await fetch(g.toString(),{
    method:"POST",
    headers:{"content-type":"application/json","x-goog-api-key":key},
    body:JSON.stringify({address})
  });
  const text=await r.text();
  let data={};try{data=JSON.parse(text)}catch{}
  if(!r.ok)return Response.json({ok:false,status:r.status,error:data?.error?.message||text.slice(0,500)||("HTTP "+r.status)},{status:r.status>=400&&r.status<600?r.status:502});
  const meta=data?.metadata||data;
  return Response.json({
    ok:true,
    state:data?.state||meta?.state||"PROCESSING",
    videoId:meta?.videoId||data?.videoId||null,
    message:"Aerial View render requested."
  },{headers:{"cache-control":"private, max-age=0, no-store"}});
}
