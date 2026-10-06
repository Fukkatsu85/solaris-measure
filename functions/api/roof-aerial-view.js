async function googleJson(url, key){
  const r=await fetch(url,{headers:{"X-Goog-Api-Key":key}});
  const text=await r.text();
  let data={};try{data=JSON.parse(text)}catch{}
  if(!r.ok){
    return {ok:false,status:r.status,error:data?.error?.message||text.slice(0,500)||("HTTP "+r.status),data};
  }
  return {ok:true,status:r.status,data};
}

export async function onRequestGet({request,env}){
  const key=env.GOOGLE_AERIAL_VIEW_API_KEY;
  if(!key)return Response.json({ok:false,error:"GOOGLE_AERIAL_VIEW_API_KEY is not configured."},{status:500});
  const u=new URL(request.url),address=(u.searchParams.get("address")||"").trim(),videoId=(u.searchParams.get("videoId")||"").trim(),mode=(u.searchParams.get("mode")||"metadata").trim();
  if(!address&&!videoId)return Response.json({ok:false,error:"address or videoId is required"},{status:400});
  const base="https://aerialview.googleapis.com/v1/videos:";
  const endpoint=mode==="video"?"lookupVideo":"lookupVideoMetadata";
  const g=new URL(base+endpoint);
  if(videoId)g.searchParams.set("videoId",videoId);else g.searchParams.set("address",address);
  const out=await googleJson(g.toString(),key);
  if(!out.ok)return Response.json({ok:false,status:out.status,error:out.error,notFound:out.status===404},{status:out.status===404?404:502});
  const d=out.data||{};
  return Response.json({
    ok:true,mode,state:d.state||null,videoId:d.videoId||videoId||null,
    captureDate:d.captureDate||null,duration:d.duration||null,
    uris:mode==="video"?(d.uris||{}):undefined
  },{headers:{"cache-control":"private, max-age=0, no-store"}});
}
