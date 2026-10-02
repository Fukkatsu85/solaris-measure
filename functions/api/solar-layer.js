const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});

export async function onRequestGet(context){
  const url=new URL(context.request.url);
  const lat=Number(url.searchParams.get("lat"));
  const lng=Number(url.searchParams.get("lng"));
  const layer=(url.searchParams.get("layer")||"mask").toLowerCase();
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({ok:false,error:"Valid lat/lng required."},400);
  if(!["mask","dsm","rgb"].includes(layer))return json({ok:false,error:"Layer must be mask, dsm, or rgb."},400);

  const key=context.env.GOOGLE_MAPS_BACKEND_KEY||context.env.GOOGLE_MAPS_API_KEY||context.env.GOOGLE_MAPS_BROWSER_KEY||"";
  if(!key)return json({ok:false,error:"Google Maps backend key is not configured."},503);

  const api=new URL("https://solar.googleapis.com/v1/dataLayers:get");
  api.searchParams.set("location.latitude",String(lat));
  api.searchParams.set("location.longitude",String(lng));
  api.searchParams.set("radiusMeters","45");
  api.searchParams.set("view","IMAGERY_LAYERS");
  api.searchParams.set("requiredQuality","BASE");
  api.searchParams.set("pixelSizeMeters","0.1");
  api.searchParams.set("key",key);

  let layersResponse;
  try{layersResponse=await fetch(api.toString(),{headers:{Accept:"application/json"}});}
  catch{return json({ok:false,error:"Solar data layer request failed."},502);}

  const layers=await layersResponse.json().catch(()=>({}));
  const sourceUrl=layer==="dsm"?layers.dsmUrl:layer==="rgb"?layers.rgbUrl:layers.maskUrl;
  if(!layersResponse.ok||!sourceUrl){
    return json({ok:false,error:layers?.error?.message||("No "+layer.toUpperCase()+" layer is available for this property.")},layersResponse.status===404?404:502);
  }

  const rasterUrl=new URL(sourceUrl);
  rasterUrl.searchParams.set("key",key);

  let rasterResponse;
  try{rasterResponse=await fetch(rasterUrl.toString());}
  catch{return json({ok:false,error:"Solar "+layer.toUpperCase()+" raster could not be downloaded."},502);}
  if(!rasterResponse.ok)return json({ok:false,error:"Solar "+layer.toUpperCase()+" raster download failed."},502);

  const headers=new Headers();
  headers.set("Content-Type",rasterResponse.headers.get("Content-Type")||"image/tiff");
  headers.set("Cache-Control","private, max-age=300");
  headers.set("X-Solar-Layer",layer);
  headers.set("X-Solar-Pixel-Size","0.1");
  headers.set("X-Solar-Imagery-Quality",layers.imageryQuality||"");
  return new Response(rasterResponse.body,{status:200,headers});
}
