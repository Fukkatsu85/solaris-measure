const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
export async function onRequestGet({request}){
 const u=new URL(request.url),lat=Number(u.searchParams.get("lat")),lng=Number(u.searchParams.get("lng"));
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:"lat/lng required"},400);
 const d=.0007,bbox=[lng-d,lat-d,lng+d,lat+d].join(",");
 const q=new URL("https://tnmaccess.nationalmap.gov/api/v1/products");
 q.searchParams.set("bbox",bbox);
 q.searchParams.set("datasets","Lidar Point Cloud (LPC)");
 q.searchParams.set("prodFormats","LAS,LAZ");
 q.searchParams.set("max","20");
 const r=await fetch(q.toString(),{headers:{"User-Agent":"Solaris-Measure/1.0"}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)return json({error:"USGS LiDAR lookup failed",status:r.status},502);
 const items=(data.items||[]).map((x,i)=>{
   const urls=x.urls||{};
   const download=urls.LAZ||urls.LAS||x.downloadURL||x.downloadUrl||"";
   return{
     index:i+1,
     title:x.title||"",
     publicationDate:x.publicationDate||x.publication_date||"",
     lastUpdated:x.lastUpdated||"",
     sizeInBytes:x.sizeInBytes||x.size||null,
     format:x.format||"",
     sourceId:x.sourceId||x.sourceID||"",
     downloadUrl:download,
     urls
   };
 }).filter(x=>x.downloadUrl||x.title);
 items.sort((a,b)=>String(b.publicationDate||"").localeCompare(String(a.publicationDate||"")));
 return json({
   ok:true,lat,lng,bbox,
   dataset:"USGS 3DEP Lidar Point Cloud (LPC)",
   count:items.length,
   best:items[0]||null,
   items
 });
}