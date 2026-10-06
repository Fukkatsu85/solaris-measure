export async function onRequestGet({request,env}){
  const key=env.GOOGLE_STREETVIEW_STATIC_KEY;
  if(!key)return Response.json({error:"GOOGLE_STREETVIEW_STATIC_KEY is not configured."},{status:500});
  const u=new URL(request.url);
  const pano=(u.searchParams.get("pano")||"").trim();
  const heading=Number(u.searchParams.get("heading"));
  const pitch=Number(u.searchParams.get("pitch")||12);
  const fov=Math.max(30,Math.min(110,Number(u.searchParams.get("fov")||75)));
  if(!pano||!Number.isFinite(heading))return Response.json({error:"pano and heading are required"},{status:400});
  const g=new URL("https://maps.googleapis.com/maps/api/streetview");
  g.searchParams.set("size","640x640");
  g.searchParams.set("pano",pano);
  g.searchParams.set("heading",String((heading%360+360)%360));
  g.searchParams.set("pitch",String(Math.max(-45,Math.min(45,pitch))));
  g.searchParams.set("fov",String(fov));
  g.searchParams.set("key",key);
  const r=await fetch(g.toString());
  if(!r.ok){
    const body=await r.text().catch(()=>"");
    return Response.json({error:"Street View snapshot request failed",googleStatus:r.status,googleBody:body.slice(0,500)},{status:502});
  }
  const ct=r.headers.get("content-type")||"image/jpeg";
  if(!ct.toLowerCase().startsWith("image/")){
    const body=await r.text().catch(()=>"");
    return Response.json({error:"Street View did not return an image",googleStatus:r.status,contentType:ct,googleBody:body.slice(0,500)},{status:502});
  }
  return new Response(r.body,{status:200,headers:{
    "content-type":ct,
    "cache-control":"private, max-age=0, no-store",
    "x-solaris-imagery-source":"google-street-view"
  }});
}
