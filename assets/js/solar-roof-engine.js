// Solaris hybrid Google Solar DSM geometry engine
// Adapted from Fukkatsu85/instant-roof-estimator on the integration branch.
// UI/pricing/lead code intentionally excluded.
const SQ_METERS_TO_SQ_FEET=10.7639104167;
const METERS_TO_FEET=3.280839895;

function latLngLiteral(value){
  if(!value)return null;
  const lat=Number(typeof value.lat==="function"?value.lat():value.lat);
  const lng=Number(typeof value.lng==="function"?value.lng():value.lng);
  return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null;
}

function dominantRoofRotation(segments=[]){
  const usable=segments.filter(s=>Number.isFinite(Number(s?.azimuthDegrees)));
  if(!usable.length)return 0;
  let sx=0,sy=0,total=0;
  usable.forEach(s=>{
    const az=Number(s.azimuthDegrees);
    const weight=Math.max(1,Number(s.groundAreaMeters2)||Number(s.areaMeters2)||1);
    // Roof edges repeat every 90 degrees, so use a 4x circular mean.
    const r=az*Math.PI/180*4;
    sx+=Math.cos(r)*weight;
    sy+=Math.sin(r)*weight;
    total+=weight;
  });
  if(!total)return 0;
  let angle=Math.atan2(sy,sx)/4*180/Math.PI;
  while(angle>45)angle-=90;
  while(angle<=-45)angle+=90;
  return angle;
}

function rotateOutline(pointsInput=[],center,angleDegrees){
  if(!pointsInput.length||!center||Math.abs(angleDegrees)<0.5)return pointsInput;
  const lat0=Number(center.latitude??center.lat);
  const lng0=Number(center.longitude??center.lng);
  if(!Number.isFinite(lat0)||!Number.isFinite(lng0))return pointsInput;
  const cosLat=Math.max(.2,Math.cos(lat0*Math.PI/180));
  const metersLat=111320;
  const metersLng=111320*cosLat;
  const a=angleDegrees*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a);
  return pointsInput.map(p=>{
    const x=(Number(p.lng)-lng0)*metersLng;
    const y=(Number(p.lat)-lat0)*metersLat;
    const xr=x*ca-y*sa;
    const yr=x*sa+y*ca;
    return {lat:lat0+yr/metersLat,lng:lng0+xr/metersLng};
  });
}

function pointImportance(prev,cur,next){
  const ax=cur.lng-prev.lng, ay=cur.lat-prev.lat;
  const bx=next.lng-cur.lng, by=next.lat-cur.lat;
  return Math.abs(ax*by-ay*bx);
}

function simplifyOutline(pointsInput,maxPoints=12){
  const out=pointsInput.map(p=>({lat:Number(p.lat),lng:Number(p.lng)}));
  while(out.length>maxPoints){
    let removeIndex=0,minScore=Infinity;
    for(let i=0;i<out.length;i++){
      const score=pointImportance(out[(i-1+out.length)%out.length],out[i],out[(i+1)%out.length]);
      if(score<minScore){minScore=score;removeIndex=i;}
    }
    out.splice(removeIndex,1);
  }
  return out;
}

function polygonAreaXY(points){
  if(!points||points.length<3)return 0;
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    area+=a.x*b.y-b.x*a.y;
  }
  return Math.abs(area)/2;
}

function convexHullXY(points){
  const pts=points.map(p=>({x:p.x,y:p.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
  if(pts.length<=3)return pts;
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[];
  for(const p of pts){
    while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();
    lower.push(p);
  }
  const upper=[];
  for(let i=pts.length-1;i>=0;i--){
    const p=pts[i];
    while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();
    upper.push(p);
  }
  lower.pop();upper.pop();
  return lower.concat(upper);
}

function minimumAreaRectangle(outline){
  if(!Array.isArray(outline)||outline.length<3)return null;
  const frame=polygonLocalFrame(outline);
  const raw=outline.map(frame.toXY);
  const hull=convexHullXY(raw);
  if(hull.length<3)return null;

  let best=null;
  for(let i=0;i<hull.length;i++){
    const a=hull[i],b=hull[(i+1)%hull.length];
    const angle=Math.atan2(b.y-a.y,b.x-a.x);
    const ca=Math.cos(-angle),sa=Math.sin(-angle);
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    hull.forEach(p=>{
      const x=p.x*ca-p.y*sa,y=p.x*sa+p.y*ca;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    });
    const area=(maxX-minX)*(maxY-minY);
    if(!best||area<best.area)best={angle,minX,maxX,minY,maxY,area};
  }
  if(!best||best.area<=0)return null;

  const ca=Math.cos(best.angle),sa=Math.sin(best.angle);
  const fromRot=(x,y)=>({x:x*ca-y*sa,y:x*sa+y*ca});
  const corners=[
    fromRot(best.minX,best.minY),
    fromRot(best.maxX,best.minY),
    fromRot(best.maxX,best.maxY),
    fromRot(best.minX,best.maxY)
  ].map(frame.toLL);
  const rawArea=polygonAreaXY(raw);
  return {
    corners,
    rectangularity:Math.max(0,Math.min(1,rawArea/best.area)),
    widthMeters:best.maxX-best.minX,
    heightMeters:best.maxY-best.minY,
    angleDegrees:best.angle*180/Math.PI
  };
}

function lineSideXY(p,a,b){
  return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
}

function clipPolygonToLine(poly,lineA,lineB,keepSign){
  if(!poly.length)return [];
  const frame=polygonLocalFrame([...poly,lineA,lineB]);
  const a=frame.toXY(lineA),b=frame.toXY(lineB);
  const input=poly.map(frame.toXY);
  const out=[];
  const inside=p=>lineSideXY(p,a,b)*keepSign>=-1e-6;
  const intersect=(p,q)=>{
    const sp=lineSideXY(p,a,b),sq=lineSideXY(q,a,b);
    const denom=sp-sq;
    if(Math.abs(denom)<1e-9)return q;
    const t=sp/denom;
    return {x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t};
  };
  for(let i=0;i<input.length;i++){
    const cur=input[i],prev=input[(i-1+input.length)%input.length];
    const curIn=inside(cur),prevIn=inside(prev);
    if(curIn){
      if(!prevIn)out.push(intersect(prev,cur));
      out.push(cur);
    }else if(prevIn)out.push(intersect(prev,cur));
  }
  return out.map(frame.toLL);
}

function extendLineToPolygon(line,poly){
  if(!line||!Array.isArray(poly)||poly.length<3)return line;
  const frame=polygonLocalFrame([...poly,line.a,line.b]);
  const a=frame.toXY(line.a),b=frame.toXY(line.b);
  const hits=[];
  for(let i=0;i<poly.length;i++){
    const p=frame.toXY(poly[i]),q=frame.toXY(poly[(i+1)%poly.length]);
    const hit=infiniteLineIntersection(a,b,p,q);
    if(!hit)continue;
    const minX=Math.min(p.x,q.x)-.05,maxX=Math.max(p.x,q.x)+.05;
    const minY=Math.min(p.y,q.y)-.05,maxY=Math.max(p.y,q.y)+.05;
    if(hit.x>=minX&&hit.x<=maxX&&hit.y>=minY&&hit.y<=maxY)hits.push(hit);
  }
  if(hits.length<2)return line;
  let bestA=hits[0],bestB=hits[1],bestD=0;
  for(let i=0;i<hits.length;i++)for(let j=i+1;j<hits.length;j++){
    const d=Math.hypot(hits[j].x-hits[i].x,hits[j].y-hits[i].y);
    if(d>bestD){bestD=d;bestA=hits[i];bestB=hits[j];}
  }
  return {...line,a:frame.toLL(bestA),b:frame.toLL(bestB),lengthMeters:bestD};
}

function regularizeSimpleGable(rawOutline,facets,roofLines){
  const ridgeLines=(roofLines||[]).filter(l=>l.type==="ridge");
  const valleys=(roofLines||[]).filter(l=>l.type==="valley");
  const hips=(roofLines||[]).filter(l=>l.type==="hip");
  if((facets||[]).length!==2||ridgeLines.length!==1||valleys.length||hips.length)return null;

  const rect=minimumAreaRectangle(rawOutline);
  if(!rect||rect.rectangularity<.84)return null;

  const cleanOutline=rect.corners;
  const ridge=extendLineToPolygon(ridgeLines[0],cleanOutline);
  const cleanFacets=facets.map(facet=>{
    const frame=polygonLocalFrame([ridge.a,ridge.b,facet.center]);
    const a=frame.toXY(ridge.a),b=frame.toXY(ridge.b),center=frame.toXY(facet.center);
    const sign=lineSideXY(center,a,b)>=0?1:-1;
    const clipped=clipPolygonToLine(cleanOutline,ridge.a,ridge.b,sign);
    return clipped.length>=3?{...facet,outline:clipped}:facet;
  });
  return {
    outline:cleanOutline,
    facets:cleanFacets,
    roofLines:[ridge],
    mode:"simple_gable_rectangle",
    rectangularity:rect.rectangularity
  };
}

function segmentUnionOutline(segments=[]){
  const rects=segments.map(s=>{
    const sw=s?.boundingBox?.sw,ne=s?.boundingBox?.ne;
    if(!sw||!ne)return null;
    const south=Number(sw.latitude),west=Number(sw.longitude),north=Number(ne.latitude),east=Number(ne.longitude);
    return [south,west,north,east].every(Number.isFinite)?{south,west,north,east}:null;
  }).filter(Boolean);
  if(!rects.length)return [];

  const xs=[...new Set(rects.flatMap(r=>[r.west,r.east]))].sort((a,b)=>a-b);
  const ys=[...new Set(rects.flatMap(r=>[r.south,r.north]))].sort((a,b)=>a-b);
  if(xs.length<2||ys.length<2)return [];

  const covered=Array.from({length:xs.length-1},()=>Array(ys.length-1).fill(false));
  for(let i=0;i<xs.length-1;i++){
    for(let j=0;j<ys.length-1;j++){
      const cx=(xs[i]+xs[i+1])/2,cy=(ys[j]+ys[j+1])/2;
      covered[i][j]=rects.some(r=>cx>=r.west&&cx<=r.east&&cy>=r.south&&cy<=r.north);
    }
  }

  const edges=[];
  const add=(a,b)=>edges.push([a,b]);
  for(let i=0;i<xs.length-1;i++){
    for(let j=0;j<ys.length-1;j++){
      if(!covered[i][j])continue;
      const w=xs[i],e=xs[i+1],s=ys[j],n=ys[j+1];
      if(i===0||!covered[i-1][j])add({lat:s,lng:w},{lat:n,lng:w});
      if(i===xs.length-2||!covered[i+1][j])add({lat:n,lng:e},{lat:s,lng:e});
      if(j===0||!covered[i][j-1])add({lat:s,lng:e},{lat:s,lng:w});
      if(j===ys.length-2||!covered[i][j+1])add({lat:n,lng:w},{lat:n,lng:e});
    }
  }
  if(!edges.length)return [];

  const key=p=>p.lat.toFixed(8)+","+p.lng.toFixed(8);
  const adjacency=new Map();
  edges.forEach(([a,b])=>{
    const ka=key(a),kb=key(b);
    if(!adjacency.has(ka))adjacency.set(ka,[]);
    adjacency.get(ka).push({to:kb,point:b});
  });

  let startKey=[...adjacency.keys()].sort((a,b)=>{
    const [alat,alng]=a.split(",").map(Number),[blat,blng]=b.split(",").map(Number);
    return alat-blat||alng-blng;
  })[0];
  const startParts=startKey.split(",").map(Number);
  const outline=[{lat:startParts[0],lng:startParts[1]}];
  let current=startKey,guard=0;
  const used=new Set();
  while(guard++<edges.length+5){
    const next=(adjacency.get(current)||[]).find(e=>!used.has(current+"|"+e.to));
    if(!next)break;
    used.add(current+"|"+next.to);
    current=next.to;
    if(current===startKey)break;
    outline.push(next.point);
  }
  if(outline.length<3)return [];

  const simplified=[];
  for(let i=0;i<outline.length;i++){
    const prev=outline[(i-1+outline.length)%outline.length],cur=outline[i],next=outline[(i+1)%outline.length];
    const vertical=Math.abs(prev.lng-cur.lng)<1e-10&&Math.abs(cur.lng-next.lng)<1e-10;
    const horizontal=Math.abs(prev.lat-cur.lat)<1e-10&&Math.abs(cur.lat-next.lat)<1e-10;
    if(!vertical&&!horizontal)simplified.push(cur);
  }
  return simplified.length>=3?simplified:outline;
}

let rasterModulesPromise=null;

async function loadRasterModules(){
  if(!rasterModulesPromise){
    rasterModulesPromise=Promise.all([
      import("https://cdn.jsdelivr.net/npm/geotiff@3.0.5/+esm"),
      import("https://cdn.jsdelivr.net/npm/geotiff-geokeys-to-proj4@2026.8.16/+esm"),
      import("https://cdn.jsdelivr.net/npm/proj4@2.22.0/+esm")
    ]);
  }
  const [geotiff,geokeysModule,proj4Module]=await rasterModulesPromise;
  const geokeys=geokeysModule.default&&geokeysModule.default.toProj4?geokeysModule.default:geokeysModule;
  const proj4=proj4Module.default||proj4Module;
  return {geotiff,geokeys,proj4};
}

function nearestRoofPixel(raster,width,height,targetX,targetY,maxRadius=260){
  let best=-1,bestD=Infinity;
  const minX=Math.max(0,targetX-maxRadius),maxX=Math.min(width-1,targetX+maxRadius);
  const minY=Math.max(0,targetY-maxRadius),maxY=Math.min(height-1,targetY+maxRadius);
  for(let y=minY;y<=maxY;y++){
    const dy=y-targetY;
    for(let x=minX;x<=maxX;x++){
      if(!raster[y*width+x])continue;
      const dx=x-targetX,d=dx*dx+dy*dy;
      if(d<bestD){bestD=d;best=y*width+x;}
    }
  }
  return best;
}

function connectedRoofComponent(raster,width,height,startIndex){
  if(startIndex<0)return new Set();
  const seen=new Set([startIndex]),stack=[startIndex];
  while(stack.length){
    const idx=stack.pop(),x=idx%width,y=Math.floor(idx/width);
    const neighbors=[];
    if(x>0)neighbors.push(idx-1);
    if(x<width-1)neighbors.push(idx+1);
    if(y>0)neighbors.push(idx-width);
    if(y<height-1)neighbors.push(idx+width);
    for(const n of neighbors){
      if(!seen.has(n)&&raster[n]){seen.add(n);stack.push(n);}
    }
  }
  return seen;
}

function traceComponentBoundary(component,width,height){
  if(!component.size)return [];
  const edges=[];
  const has=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&component.has(y*width+x);
  const add=(ax,ay,bx,by)=>edges.push([[ax,ay],[bx,by]]);
  component.forEach(idx=>{
    const x=idx%width,y=Math.floor(idx/width);
    if(!has(x,y-1))add(x,y,x+1,y);
    if(!has(x+1,y))add(x+1,y,x+1,y+1);
    if(!has(x,y+1))add(x+1,y+1,x,y+1);
    if(!has(x-1,y))add(x,y+1,x,y);
  });
  const key=p=>p[0]+","+p[1],outgoing=new Map(),used=new Set(),loops=[];
  edges.forEach(([p,q])=>{
    const k=key(p);
    if(!outgoing.has(k))outgoing.set(k,[]);
    outgoing.get(k).push(q);
  });
  edges.forEach(([start,end])=>{
    const first=key(start)+">"+key(end);
    if(used.has(first))return;
    const loop=[start];
    let cur=start,next=end,guard=0;
    while(guard++<edges.length+5){
      used.add(key(cur)+">"+key(next));
      cur=next;
      if(key(cur)===key(start))break;
      loop.push(cur);
      const candidate=(outgoing.get(key(cur))||[]).find(p=>!used.has(key(cur)+">"+key(p)));
      if(!candidate)break;
      next=candidate;
    }
    if(loop.length>=4&&key(cur)===key(start))loops.push(loop);
  });
  loops.sort((x,y)=>y.length-x.length);
  return loops[0]||[];
}

function removeCollinearPixelPoints(input){
  if(input.length<4)return input;
  const out=[];
  for(let i=0;i<input.length;i++){
    const a=input[(i-1+input.length)%input.length],b=input[i],d=input[(i+1)%input.length];
    const cross=(b[0]-a[0])*(d[1]-b[1])-(b[1]-a[1])*(d[0]-b[0]);
    if(Math.abs(cross)>1e-9)out.push(b);
  }
  return out.length>=3?out:input;
}

async function decodeSolarRaster(layer,lat,lng){
  const response=await fetch("/api/solar-layer?layer="+encodeURIComponent(layer)+"&lat="+encodeURIComponent(lat)+"&lng="+encodeURIComponent(lng),{cache:"no-store"});
  if(!response.ok){
    const data=await response.json().catch(()=>({}));
    throw new Error(data.error||("Google Solar "+layer.toUpperCase()+" layer is unavailable."));
  }
  const quality=response.headers.get("X-Solar-Imagery-Quality")||"";
  const pixelSize=Number(response.headers.get("X-Solar-Pixel-Size"))||0.1;
  const buffer=await response.arrayBuffer();
  const {geotiff,geokeys,proj4}=await loadRasterModules();
  const tiff=await geotiff.fromArrayBuffer(buffer);
  const image=await tiff.getImage();
  const rasters=await image.readRasters();
  const bands=Array.from(rasters),raster=bands[0],width=rasters.width||image.getWidth(),height=rasters.height||image.getHeight();
  if(!raster||!width||!height)throw new Error(layer.toUpperCase()+" raster could not be decoded.");

  const projObj=geokeys.toProj4(image.getGeoKeys()||{});
  const projection=proj4(projObj.proj4,"WGS84");
  const convert=(x,y,z=0)=>{
    let p={x,y,z};
    if(typeof projObj.convertCoordinates==="function")p=projObj.convertCoordinates(p);
    else if(typeof geokeys.convertCoordinates==="function")p=geokeys.convertCoordinates(p,projObj.conversionParameters||projObj.coordinatesConversionParameters||{});
    else{
      const f=projObj.conversionParameters||projObj.coordinatesConversionParameters||{x:1,y:1,z:1};
      p={x:x*(f.x||1),y:y*(f.y||1),z:z*(f.z||1)};
    }
    const q=projection.forward(p);
    return {lng:Number(q.x),lat:Number(q.y)};
  };
  const box=image.getBoundingBox();
  const p1=convert(box[0],box[1]),p2=convert(box[2],box[3]);
  const bounds={
    west:Math.min(p1.lng,p2.lng),east:Math.max(p1.lng,p2.lng),
    south:Math.min(p1.lat,p2.lat),north:Math.max(p1.lat,p2.lat)
  };
  if(!(bounds.east>bounds.west&&bounds.north>bounds.south))throw new Error(layer.toUpperCase()+" raster location data is invalid.");
  return {raster,bands,width,height,bounds,quality,pixelSize};
}

function rasterPixelForLatLng(data,lat,lng){
  return {
    x:Math.max(0,Math.min(data.width-1,Math.round((lng-data.bounds.west)/(data.bounds.east-data.bounds.west)*(data.width-1)))),
    y:Math.max(0,Math.min(data.height-1,Math.round((data.bounds.north-lat)/(data.bounds.north-data.bounds.south)*(data.height-1))))
  };
}

function rasterLatLng(data,x,y){
  return {
    lat:data.bounds.north-(y/data.height)*(data.bounds.north-data.bounds.south),
    lng:data.bounds.west+(x/data.width)*(data.bounds.east-data.bounds.west)
  };
}

function median(values){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}

function dsmSampleAt(data,lat,lng){
  const p=rasterPixelForLatLng(data,lat,lng);
  return {index:p.y*data.width+p.x,x:p.x,y:p.y,z:Number(data.raster[p.y*data.width+p.x])};
}

function angleDifference(a,b){
  let d=Math.abs(a-b)%360;
  return d>180?360-d:d;
}

function metersBetween(a,b){
  if(!a||!b)return 999;
  const lat1=Number(a.lat??a.latitude),lng1=Number(a.lng??a.longitude);
  const lat2=Number(b.lat??b.latitude),lng2=Number(b.lng??b.longitude);
  if(![lat1,lng1,lat2,lng2].every(Number.isFinite))return 999;
  const y=(lat2-lat1)*111320;
  const x=(lng2-lng1)*111320*Math.cos(((lat1+lat2)/2)*Math.PI/180);
  return Math.hypot(x,y);
}

function dsmSlopeAt(mask,dsm,maskIdx){
  const mx=maskIdx%mask.width,my=Math.floor(maskIdx/mask.width);
  if(mx<2||my<2||mx>=mask.width-2||my>=mask.height-2)return null;
  const ll=rasterLatLng(mask,mx+.5,my+.5);
  const p=rasterPixelForLatLng(dsm,ll.lat,ll.lng);
  const step=3,pixelMeters=Math.max(.1,Number(dsm.pixelSize)||.1);
  if(p.x<step||p.y<step||p.x>=dsm.width-step||p.y>=dsm.height-step)return null;
  const z=Number(dsm.raster[p.y*dsm.width+p.x]);
  const zl=Number(dsm.raster[p.y*dsm.width+p.x-step]);
  const zr=Number(dsm.raster[p.y*dsm.width+p.x+step]);
  const zu=Number(dsm.raster[(p.y-step)*dsm.width+p.x]);
  const zd=Number(dsm.raster[(p.y+step)*dsm.width+p.x]);
  if(![z,zl,zr,zu,zd].every(v=>Number.isFinite(v)&&v>-1000))return null;
  const dx=(zr-zl)/(2*step*pixelMeters);
  const dy=(zd-zu)/(2*step*pixelMeters);
  const pitch=Math.atan(Math.hypot(dx,dy))*180/Math.PI;
  if(pitch>60)return null;
  let azimuth=Math.atan2(dx,-dy)*180/Math.PI;
  if(azimuth<0)azimuth+=360;
  return {pitch,azimuth,ll};
}

function connectedComponentsForLabel(indices,width,height){
  const set=new Set(indices),seen=new Set(),groups=[];
  for(const start of indices){
    if(seen.has(start))continue;
    const group=[],stack=[start];seen.add(start);
    while(stack.length){
      const idx=stack.pop();group.push(idx);
      const x=idx%width,y=Math.floor(idx/width);
      const n=[];
      if(x>0)n.push(idx-1);if(x<width-1)n.push(idx+1);if(y>0)n.push(idx-width);if(y<height-1)n.push(idx+width);
      for(const q of n)if(set.has(q)&&!seen.has(q)){seen.add(q);stack.push(q);}
    }
    groups.push(group);
  }
  groups.sort((a,b)=>b.length-a.length);
  return groups;
}

function rgbSampleAt(rgb,lat,lng){
  if(!rgb?.bands||rgb.bands.length<3)return null;
  const p=rasterPixelForLatLng(rgb,lat,lng);
  const idx=p.y*rgb.width+p.x;
  const r=Number(rgb.bands[0][idx]),g=Number(rgb.bands[1][idx]),b=Number(rgb.bands[2][idx]);
  if(![r,g,b].every(Number.isFinite))return null;
  return {r,g,b,luma:.2126*r+.7152*g+.0722*b,x:p.x,y:p.y};
}

function rgbEdgeStrength(rgb,lat,lng){
  if(!rgb?.bands||rgb.bands.length<3)return 0;
  const p=rasterPixelForLatLng(rgb,lat,lng);
  const x=p.x,y=p.y;
  if(x<1||y<1||x>=rgb.width-1||y>=rgb.height-1)return 0;
  const lum=(xx,yy)=>{
    const idx=yy*rgb.width+xx;
    const r=Number(rgb.bands[0][idx]),g=Number(rgb.bands[1][idx]),b=Number(rgb.bands[2][idx]);
    return .2126*r+.7152*g+.0722*b;
  };
  const gx=(lum(x+1,y)-lum(x-1,y))/2;
  const gy=(lum(x,y+1)-lum(x,y-1))/2;
  return Math.min(1,Math.hypot(gx,gy)/85);
}

function rgbColorDistance(a,b){
  if(!a||!b)return 0;
  return Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b)/441.673;
}

function localOffsetMeters(point,origin){
  const lat=Number(point.lat??point.latitude),lng=Number(point.lng??point.longitude);
  const lat0=Number(origin.lat??origin.latitude),lng0=Number(origin.lng??origin.longitude);
  const north=(lat-lat0)*111320;
  const east=(lng-lng0)*111320*Math.cos(((lat+lat0)/2)*Math.PI/180);
  return {east,north};
}

function normalize180(angle){
  let a=Number(angle)%180;
  if(a<0)a+=180;
  return a;
}

function lineAngleDiff(a,b){
  const d=Math.abs(normalize180(a)-normalize180(b));
  return Math.min(d,180-d);
}

function polygonLocalFrame(outline){
  const lat0=outline.reduce((s,p)=>s+Number(p.lat),0)/outline.length;
  const lng0=outline.reduce((s,p)=>s+Number(p.lng),0)/outline.length;
  const cosLat=Math.max(.2,Math.cos(lat0*Math.PI/180));
  const toXY=p=>({
    x:(Number(p.lng)-lng0)*111320*cosLat,
    y:(Number(p.lat)-lat0)*111320
  });
  const toLL=p=>({
    lat:lat0+p.y/111320,
    lng:lng0+p.x/(111320*cosLat)
  });
  return {toXY,toLL};
}

function pointLineDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const len=Math.hypot(dx,dy)||1;
  return Math.abs(dy*p.x-dx*p.y+b.x*a.y-b.y*a.x)/len;
}

function simplifyClosedGeometry(points,maxVertices=7,minEdgeMeters=.65){
  let out=points.map(p=>({...p}));
  let changed=true;
  while(changed&&out.length>3){
    changed=false;
    for(let i=0;i<out.length;i++){
      const prev=out[(i-1+out.length)%out.length],cur=out[i],next=out[(i+1)%out.length];
      const a=Math.hypot(cur.x-prev.x,cur.y-prev.y);
      const b=Math.hypot(next.x-cur.x,next.y-cur.y);
      const chord=Math.hypot(next.x-prev.x,next.y-prev.y);
      const deviation=pointLineDistance(cur,prev,next);
      if(a<minEdgeMeters||b<minEdgeMeters||(deviation<.28&&chord>Math.max(a,b))){
        out.splice(i,1);changed=true;break;
      }
    }
  }
  while(out.length>maxVertices){
    let remove=0,best=Infinity;
    for(let i=0;i<out.length;i++){
      const prev=out[(i-1+out.length)%out.length],cur=out[i],next=out[(i+1)%out.length];
      const importance=pointLineDistance(cur,prev,next)*Math.min(
        Math.hypot(cur.x-prev.x,cur.y-prev.y),
        Math.hypot(next.x-cur.x,next.y-cur.y)
      );
      if(importance<best){best=importance;remove=i;}
    }
    out.splice(remove,1);
  }
  return out;
}

function infiniteLineIntersection(a,b,c,d){
  const r={x:b.x-a.x,y:b.y-a.y},s={x:d.x-c.x,y:d.y-c.y};
  const cross=r.x*s.y-r.y*s.x;
  if(Math.abs(cross)<1e-7)return null;
  const q={x:c.x-a.x,y:c.y-a.y};
  const t=(q.x*s.y-q.y*s.x)/cross;
  return {x:a.x+t*r.x,y:a.y+t*r.y};
}

function regularizeFacetOutline(outline,facetAzimuth,maxVertices=7){
  if(!Array.isArray(outline)||outline.length<3)return outline;
  const frame=polygonLocalFrame(outline);
  let pts=simplifyClosedGeometry(outline.map(frame.toXY),maxVertices,.7);
  if(pts.length<3)return outline;

  // Roof geometry normally follows a few architectural angle families.
  // Keep the facet's dominant slope direction, its perpendicular, and hip/valley diagonals.
  const base=normalize180(Number(facetAzimuth)||0);
  const families=[base,normalize180(base+90),normalize180(base+45),normalize180(base-45)];

  const lines=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];
    const dx=b.x-a.x,dy=b.y-a.y;
    const len=Math.hypot(dx,dy);
    if(len<.15)continue;
    let angle=normalize180(Math.atan2(dy,dx)*180/Math.PI);
    let snapped=angle,bestDiff=Infinity;
    families.forEach(f=>{
      const diff=lineAngleDiff(angle,f);
      if(diff<bestDiff){bestDiff=diff;snapped=f;}
    });
    // Only snap when the raw edge is already reasonably consistent with a roof angle.
    if(bestDiff>18)snapped=angle;
    const rad=snapped*Math.PI/180;
    const dir={x:Math.cos(rad),y:Math.sin(rad)};
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    lines.push({
      a:{x:mid.x-dir.x*1000,y:mid.y-dir.y*1000},
      b:{x:mid.x+dir.x*1000,y:mid.y+dir.y*1000},
      len
    });
  }
  if(lines.length<3)return outline;

  const rebuilt=[];
  for(let i=0;i<lines.length;i++){
    const prev=lines[(i-1+lines.length)%lines.length],cur=lines[i];
    const hit=infiniteLineIntersection(prev.a,prev.b,cur.a,cur.b);
    if(!hit){rebuilt.push(pts[i%pts.length]);continue;}
    // Reject intersections that fly far away because two adjacent snapped lines are nearly parallel.
    const ref=pts[i%pts.length];
    rebuilt.push(Math.hypot(hit.x-ref.x,hit.y-ref.y)>4?ref:hit);
  }

  const clean=simplifyClosedGeometry(rebuilt,maxVertices,.8);
  return clean.length>=3?clean.map(frame.toLL):outline;
}

function fitStraightBoundary(pointsLatLng){
  if(!Array.isArray(pointsLatLng)||pointsLatLng.length<4)return null;
  const frame=polygonLocalFrame(pointsLatLng);
  const pts=pointsLatLng.map(frame.toXY);
  const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length;
  const cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
  let xx=0,yy=0,xy=0;
  pts.forEach(p=>{
    const dx=p.x-cx,dy=p.y-cy;
    xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;
  });
  const angle=.5*Math.atan2(2*xy,xx-yy);
  const dir={x:Math.cos(angle),y:Math.sin(angle)};
  const normal={x:-dir.y,y:dir.x};
  let min=Infinity,max=-Infinity,residual=0;
  pts.forEach(p=>{
    const dx=p.x-cx,dy=p.y-cy;
    const t=dx*dir.x+dy*dir.y;
    const r=Math.abs(dx*normal.x+dy*normal.y);
    min=Math.min(min,t);max=Math.max(max,t);residual+=r*r;
  });
  const length=max-min;
  const rms=Math.sqrt(residual/pts.length);
  if(length<1.0||rms>1.15)return null;
  const a={x:cx+dir.x*min,y:cy+dir.y*min};
  const b={x:cx+dir.x*max,y:cy+dir.y*max};
  return {a:frame.toLL(a),b:frame.toLL(b),lengthMeters:length,rmsMeters:rms};
}

function closestVectorToLine(point,line){
  const frame=polygonLocalFrame([point,line.a,line.b]);
  const p=frame.toXY(point),a=frame.toXY(line.a),b=frame.toXY(line.b);
  const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
  return {x:a.x+dx*t-p.x,y:a.y+dy*t-p.y};
}

function offsetToward(point,target,distanceMeters){
  const frame=polygonLocalFrame([point,target]);
  const p=frame.toXY(point),t=frame.toXY(target);
  const dx=t.x-p.x,dy=t.y-p.y,len=Math.hypot(dx,dy)||1;
  return frame.toLL({x:p.x+dx/len*distanceMeters,y:p.y+dy/len*distanceMeters});
}

function interpolateLatLng(a,b,t){
  return {lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t};
}

function planeHeightAt(seg,point){
  if(!seg||!point||!Number.isFinite(Number(seg.z0)))return NaN;
  const off=localOffsetMeters(point,seg.center);
  return seg.z0-seg.gradientEast*off.east-seg.gradientNorth*off.north;
}

function shiftedRoofLine(line,offsetMeters){
  const frame=polygonLocalFrame([line.a,line.b]);
  const a=frame.toXY(line.a),b=frame.toXY(line.b);
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const nx=-dy/len,ny=dx/len;
  return {
    ...line,
    a:frame.toLL({x:a.x+nx*offsetMeters,y:a.y+ny*offsetMeters}),
    b:frame.toLL({x:b.x+nx*offsetMeters,y:b.y+ny*offsetMeters})
  };
}

function roofLineCrossSection(line,dsm,sideDistance=.85){
  const frame=polygonLocalFrame([line.a,line.b]);
  const a=frame.toXY(line.a),b=frame.toXY(line.b);
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const nx=-dy/len,ny=dx/len;
  const curvatures=[];
  for(const t of [.18,.34,.5,.66,.82]){
    const x=a.x+dx*t,y=a.y+dy*t;
    const center=frame.toLL({x,y});
    const plus=frame.toLL({x:x+nx*sideDistance,y:y+ny*sideDistance});
    const minus=frame.toLL({x:x-nx*sideDistance,y:y-ny*sideDistance});
    const z0=dsmSampleAt(dsm,center.lat,center.lng)?.z;
    const zp=dsmSampleAt(dsm,plus.lat,plus.lng)?.z;
    const zm=dsmSampleAt(dsm,minus.lat,minus.lng)?.z;
    if([z0,zp,zm].every(Number.isFinite)){
      // Positive = center line is lower than both sides (valley).
      // Negative = center line is higher than both sides (ridge/hip).
      curvatures.push(((zp+zm)/2)-z0);
    }
  }
  if(curvatures.length<3)return null;
  const value=median(curvatures);
  const consistent=curvatures.filter(v=>Math.sign(v)===Math.sign(value)&&Math.abs(v)>.035).length/curvatures.length;
  return {value,consistent,samples:curvatures.length};
}

function offsetLatLngMeters(point,eastMeters,northMeters){
  const lat=Number(point.lat??point.latitude),lng=Number(point.lng??point.longitude);
  const cosLat=Math.max(.2,Math.cos(lat*Math.PI/180));
  return {lat:lat+northMeters/111320,lng:lng+eastMeters/(111320*cosLat)};
}

function calibratedDownhillVector(seg,dsm){
  let east=Number(seg.gradientEast)||0,north=Number(seg.gradientNorth)||0;
  const len=Math.hypot(east,north);
  if(len<1e-6)return null;
  east/=len;north/=len;
  if(dsm&&seg.center){
    const plus=offsetLatLngMeters(seg.center,east*1.2,north*1.2);
    const minus=offsetLatLngMeters(seg.center,-east*1.2,-north*1.2);
    const zp=dsmSampleAt(dsm,plus.lat,plus.lng)?.z;
    const zm=dsmSampleAt(dsm,minus.lat,minus.lng)?.z;
    if(Number.isFinite(zp)&&Number.isFinite(zm)&&zm<zp){east*=-1;north*=-1;}
  }
  return {east,north};
}

function slopeTowardSharedLine(line,seg,dsm){
  const frame=polygonLocalFrame([line.a,line.b,seg.center]);
  const a=frame.toXY(line.a),b=frame.toXY(line.b),center=frame.toXY(seg.center);
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const nx=-dy/len,ny=dx/len;
  const signed=(center.x-a.x)*nx+(center.y-a.y)*ny;
  if(Math.abs(signed)<.15)return null;
  const toward={x:-Math.sign(signed)*nx,y:-Math.sign(signed)*ny};
  const down=calibratedDownhillVector(seg,dsm);
  return down?down.east*toward.x+down.north*toward.y:null;
}

function classifySharedRoofLine(line,segA,segB,dsm){
  if(!line||!segA||!segB)return {type:"unknown",line};
  let valleyScore=0,ridgeScore=0,crossType="unknown",best=null;

  const ta=slopeTowardSharedLine(line,segA,dsm);
  const tb=slopeTowardSharedLine(line,segB,dsm);
  let planeDecision=null,planeStrength=0;
  if(Number.isFinite(ta)&&Number.isFinite(tb)){
    const s=Math.min(Math.abs(ta),Math.abs(tb));
    planeStrength=s;
    if(ta>.18&&tb>.18){valleyScore+=1.5+Math.min(1.5,s*2);planeDecision="valley";}
    if(ta<-.18&&tb<-.18){ridgeScore+=1.5+Math.min(1.5,s*2);planeDecision="ridge_or_hip";}
  }

  if(dsm){
    for(let shift=-1.2;shift<=1.2;shift+=.2){
      const candidate=shiftedRoofLine(line,shift);
      const cross=roofLineCrossSection(candidate,dsm,.85);
      if(!cross||cross.consistent<.6)continue;
      const score=Math.abs(cross.value)*(.65+.35*cross.consistent);
      if(!best||score>best.score)best={score,cross,line:candidate};
    }
    if(best){
      const w=Math.min(2.4,Math.max(.5,Math.abs(best.cross.value)/.07))*best.cross.consistent;
      if(best.cross.value>.07){crossType="valley";valleyScore+=w;}
      if(best.cross.value<-.07){crossType="ridge_or_hip";ridgeScore+=w;}
    }
  }

  const tests=[];
  for(const t of [.3,.5,.7]){
    const p=interpolateLatLng(line.a,line.b,t);
    const aSide=offsetToward(p,segA.center,1.25);
    const bSide=offsetToward(p,segB.center,1.25);
    const aOwn=planeHeightAt(segA,aSide),bAtA=planeHeightAt(segB,aSide);
    const bOwn=planeHeightAt(segB,bSide),aAtB=planeHeightAt(segA,bSide);
    if([aOwn,bAtA,bOwn,aAtB].every(Number.isFinite))tests.push([aOwn-bAtA,bOwn-aAtB]);
  }
  if(tests.length){
    const da=median(tests.map(v=>v[0])),db=median(tests.map(v=>v[1]));
    const s=Math.min(Math.abs(da),Math.abs(db));
    if(da>.06&&db>.06)valleyScore+=.8+Math.min(1.2,s/.12);
    if(da<-.06&&db<-.06)ridgeScore+=.8+Math.min(1.2,s/.12);
  }

  let type="transition";
  // Plane orientation is the strongest structural signal. DSM curvature is a fallback,
  // because trees/shadows/low-resolution elevation can invert a local cross section.
  if(planeDecision&&planeStrength>=.42)type=planeDecision;
  else if(valleyScore>ridgeScore+.35)type="valley";
  else if(ridgeScore>valleyScore+.35)type="ridge_or_hip";
  return {type,line:(best&&crossType===type&&planeStrength<.42)?best.line:line,creaseStrength:best?Math.abs(best.cross.value):0,planeStrength};
}

function ridgeOrHipType(segA,segB,dsm){
  const a=calibratedDownhillVector(segA,dsm);
  const b=calibratedDownhillVector(segB,dsm);
  if(!a||!b)return "hip";
  const dot=Math.max(-1,Math.min(1,a.east*b.east+a.north*b.north));
  const separation=Math.acos(dot)*180/Math.PI;
  return separation>=135?"ridge":"hip";
}

function roofLine3dMeters(line,segA,segB){
  const plan=metersBetween(line.a,line.b);
  const z1=median([planeHeightAt(segA,line.a),planeHeightAt(segB,line.a)].filter(Number.isFinite));
  const z2=median([planeHeightAt(segA,line.b),planeHeightAt(segB,line.b)].filter(Number.isFinite));
  return Number.isFinite(z1)&&Number.isFinite(z2)?Math.hypot(plan,z2-z1):plan;
}

function pointSegmentDistanceMetersLL(point,a,b){
  const frame=polygonLocalFrame([point,a,b]);
  const p=frame.toXY(point),aa=frame.toXY(a),bb=frame.toXY(b);
  const dx=bb.x-aa.x,dy=bb.y-aa.y,len2=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((p.x-aa.x)*dx+(p.y-aa.y)*dy)/len2));
  return Math.hypot(p.x-(aa.x+dx*t),p.y-(aa.y+dy*t));
}

function closestFacetToEdge(mid,facets=[]){
  let best=null,bestDist=Infinity;
  facets.forEach(facet=>{
    const outline=facet.outline||[];
    for(let i=0;i<outline.length;i++){
      const d=pointSegmentDistanceMetersLL(mid,outline[i],outline[(i+1)%outline.length]);
      if(d<bestDist){bestDist=d;best=facet;}
    }
  });
  return best;
}

function facetHeightAt(facet,point){
  if(!facet||!point||!facet.center||!Number.isFinite(Number(facet.z0)))return NaN;
  const off=localOffsetMeters(point,facet.center);
  return Number(facet.z0)-Number(facet.gradientEast||0)*off.east-Number(facet.gradientNorth||0)*off.north;
}

function exteriorEdgeType(a,b,facet){
  if(!facet)return "eave";
  const frame=polygonLocalFrame([a,b]);
  const aa=frame.toXY(a),bb=frame.toXY(b);
  let ex=bb.x-aa.x,ey=bb.y-aa.y;
  const el=Math.hypot(ex,ey)||1;ex/=el;ey/=el;
  let sx=Number(facet.gradientEast)||0,sy=Number(facet.gradientNorth)||0;
  const sl=Math.hypot(sx,sy)||1;sx/=sl;sy/=sl;
  const parallel=Math.abs(ex*sx+ey*sy);
  return parallel>=.62?"rake":"eave";
}

function exteriorEdge3dMeters(a,b,facet){
  const plan=metersBetween(a,b);
  const z1=facetHeightAt(facet,a),z2=facetHeightAt(facet,b);
  return Number.isFinite(z1)&&Number.isFinite(z2)?Math.hypot(plan,z2-z1):plan;
}

function buildRoofMeasurements(outline,facets=[],roofLines=[]){
  const exterior=[];
  let perimeterFt=0,eaveFt=0,rakeFt=0;
  if(Array.isArray(outline)&&outline.length>=3){
    for(let i=0;i<outline.length;i++){
      const a=latLngLiteral(outline[i]),b=latLngLiteral(outline[(i+1)%outline.length]);
      if(!a||!b)continue;
      const mid={lat:(a.lat+b.lat)/2,lng:(a.lng+b.lng)/2};
      const facet=closestFacetToEdge(mid,facets);
      const type=exteriorEdgeType(a,b,facet);
      const lengthFt=exteriorEdge3dMeters(a,b,facet)*METERS_TO_FEET;
      perimeterFt+=lengthFt;
      if(type==="rake")rakeFt+=lengthFt;else eaveFt+=lengthFt;
      exterior.push({type,lengthFt,a,b,facetIndex:facet?.index||null});
    }
  }

  const sumLine=type=>roofLines.filter(l=>l.type===type).reduce((s,l)=>s+Number(l.length3dMeters||l.lengthMeters||0)*METERS_TO_FEET,0);
  return {
    perimeterFt,
    eaveFt,
    rakeFt,
    ridgeFt:sumLine("ridge"),
    hipFt:sumLine("hip"),
    valleyFt:sumLine("valley"),
    exteriorEdges:exterior,
    facetCount:facets.length
  };
}

function extractSharedRoofLines(mask,component,labels,candidates,dsm){
  const pairs=new Map();
  const add=(a,b,x,y)=>{
    if(a<0||b<0||a===b)return;
    const lo=Math.min(a,b),hi=Math.max(a,b),key=lo+"|"+hi;
    if(!pairs.has(key))pairs.set(key,{a:lo,b:hi,points:[]});
    pairs.get(key).points.push(rasterLatLng(mask,x,y));
  };
  component.forEach(idx=>{
    const x=idx%mask.width,y=Math.floor(idx/mask.width),lab=labels[idx];
    if(x<mask.width-1){
      const q=idx+1;
      if(component.has(q)&&labels[q]!==lab)add(lab,labels[q],x+1,y+.5);
    }
    if(y<mask.height-1){
      const q=idx+mask.width;
      if(component.has(q)&&labels[q]!==lab)add(lab,labels[q],x+.5,y+1);
    }
  });

  const lines=[];
  pairs.forEach(pair=>{
    if(pair.points.length<6)return;
    const fitted=fitStraightBoundary(pair.points);
    if(!fitted)return;
    const classified=classifySharedRoofLine(fitted,candidates[pair.a],candidates[pair.b],dsm);
    const type=classified.type;
    const refined=classified.line||fitted;
    if(type==="transition"&&fitted.lengthMeters<2)return;
    const finalType=type==="ridge_or_hip"?ridgeOrHipType(candidates[pair.a],candidates[pair.b],dsm):type;
    const lineForLength={a:refined.a,b:refined.b};
    lines.push({
      type:finalType,
      facetA:pair.a,
      facetB:pair.b,
      a:refined.a,
      b:refined.b,
      lengthMeters:metersBetween(refined.a,refined.b),
      length3dMeters:roofLine3dMeters(lineForLength,candidates[pair.a],candidates[pair.b]),
      rmsMeters:fitted.rmsMeters,
      creaseStrength:classified.creaseStrength||0
    });
  });
  return lines.sort((a,b)=>b.lengthMeters-a.lengthMeters);
}

function detectRoofFacets(mask,component,dsm,solarSegments=[],rgb=null){
  const candidates=solarSegments
    .filter(s=>Number.isFinite(Number(s.pitchDegrees))&&Number.isFinite(Number(s.azimuthDegrees))&&s.center)
    .slice(0,20)
    .map((seg,i)=>{
      const center={lat:Number(seg.center.latitude),lng:Number(seg.center.longitude)};
      const sample=dsmSampleAt(dsm,center.lat,center.lng);
      const pitch=Number(seg.pitchDegrees);
      const azimuth=Number(seg.azimuthDegrees);
      const slope=Math.tan(pitch*Math.PI/180);
      const az=azimuth*Math.PI/180;
      return {
        ...seg,
        sourceIndex:i,
        center,
        z0:Number.isFinite(Number(seg.planeHeightAtCenterMeters))?Number(seg.planeHeightAtCenterMeters):Number(sample?.z),
        pitch,
        azimuth,
        gradientEast:slope*Math.sin(az),
        gradientNorth:slope*Math.cos(az),
        rgb0:rgbSampleAt(rgb,center.lat,center.lng)
      };
    })
    .filter(seg=>Number.isFinite(seg.z0)&&seg.z0>-1000);

  if(!candidates.length)return {facets:[],assignedCoverage:0,rgbAssisted:false};

  const labels=new Int16Array(mask.width*mask.height);
  labels.fill(-1);

  // Primary signal: 3D plane residual. Secondary signal: aligned RGB brightness/color.
  // This lets visible roof shadow/lighting boundaries help when two planes fit similarly.
  component.forEach(idx=>{
    const mx=idx%mask.width,my=Math.floor(idx/mask.width);
    const ll=rasterLatLng(mask,mx+.5,my+.5);
    const sample=dsmSampleAt(dsm,ll.lat,ll.lng);
    if(!sample||!Number.isFinite(sample.z)||sample.z<-1000)return;
    const rgbPx=rgbSampleAt(rgb,ll.lat,ll.lng);

    let best=-1,bestScore=Infinity;
    candidates.forEach((seg,i)=>{
      const off=localOffsetMeters(ll,seg.center);
      const predicted=seg.z0-seg.gradientEast*off.east-seg.gradientNorth*off.north;
      const elevationResidual=Math.abs(sample.z-predicted);
      const distance=Math.hypot(off.east,off.north);
      const colorCue=rgbColorDistance(rgbPx,seg.rgb0);
      const score=elevationResidual + Math.max(0,distance-8)*0.018 + colorCue*0.32;
      if(score<bestScore){bestScore=score;best=i;}
    });
    labels[idx]=best;
  });

  // Fill DSM holes from neighboring labels so facet coverage reaches the eaves.
  for(let pass=0;pass<5;pass++){
    const next=new Int16Array(labels);
    component.forEach(idx=>{
      if(labels[idx]>=0)return;
      const x=idx%mask.width,y=Math.floor(idx/mask.width),votes=new Map();
      const n=[];
      if(x>0)n.push(idx-1);if(x<mask.width-1)n.push(idx+1);if(y>0)n.push(idx-mask.width);if(y<mask.height-1)n.push(idx+mask.width);
      n.forEach(q=>{
        if(!component.has(q))return;
        const lab=labels[q];
        if(lab>=0)votes.set(lab,(votes.get(lab)||0)+1);
      });
      let winner=-1,count=0;
      votes.forEach((v,lab)=>{if(v>count){winner=lab;count=v;}});
      if(winner>=0)next[idx]=winner;
    });
    labels.set(next);
  }

  // Smooth noise, but resist smoothing across strong RGB light/shadow edges.
  for(let pass=0;pass<4;pass++){
    const next=new Int16Array(labels);
    component.forEach(idx=>{
      const x=idx%mask.width,y=Math.floor(idx/mask.width),counts=new Map();
      for(let yy=Math.max(0,y-1);yy<=Math.min(mask.height-1,y+1);yy++){
        for(let xx=Math.max(0,x-1);xx<=Math.min(mask.width-1,x+1);xx++){
          if(xx===x&&yy===y)continue;
          const q=yy*mask.width+xx;
          if(!component.has(q))continue;
          const lab=labels[q];
          if(lab>=0)counts.set(lab,(counts.get(lab)||0)+1);
        }
      }
      let winner=labels[idx],winnerCount=0;
      counts.forEach((count,lab)=>{if(count>winnerCount){winner=lab;winnerCount=count;}});
      const ll=rasterLatLng(mask,x+.5,y+.5);
      const edge=rgbEdgeStrength(rgb,ll.lat,ll.lng);
      const threshold=edge>.24?8:edge>.12?7:6;
      if(winnerCount>=threshold)next[idx]=winner;
    });
    labels.set(next);
  }

  // Collapse only truly tiny disconnected islands.
  for(let pass=0;pass<2;pass++){
    const byLabel=Array.from({length:candidates.length},()=>[]);
    component.forEach(idx=>{const lab=labels[idx];if(lab>=0)byLabel[lab].push(idx);});
    byLabel.forEach((indices,label)=>{
      if(indices.length<2)return;
      const groups=connectedComponentsForLabel(indices,mask.width,mask.height);
      if(groups.length<=1)return;
      const minKeep=Math.max(35,Math.round(component.size*.007));
      groups.slice(1).forEach(group=>{
        if(group.length>=minKeep)return;
        const votes=new Map();
        group.forEach(idx=>{
          const x=idx%mask.width,y=Math.floor(idx/mask.width);
          const n=[];
          if(x>0)n.push(idx-1);if(x<mask.width-1)n.push(idx+1);if(y>0)n.push(idx-mask.width);if(y<mask.height-1)n.push(idx+mask.width);
          n.forEach(q=>{
            if(!component.has(q))return;
            const other=labels[q];
            if(other>=0&&other!==label)votes.set(other,(votes.get(other)||0)+1);
          });
        });
        let target=-1,maxVotes=0;
        votes.forEach((count,lab)=>{if(count>maxVotes){maxVotes=count;target=lab;}});
        if(target>=0)group.forEach(idx=>labels[idx]=target);
      });
    });
  }

  const maskPixelArea=Math.pow(Math.max(.1,Number(mask.pixelSize)||.1),2);
  const byLabel=Array.from({length:candidates.length},()=>[]);
  component.forEach(idx=>{const lab=labels[idx];if(lab>=0)byLabel[lab].push(idx);});

  const facets=[];
  const minFacetPixels=Math.max(18,Math.min(55,Math.round(component.size*.0025)));
  byLabel.forEach((indices,i)=>{
    if(indices.length<minFacetPixels)return;
    const groups=connectedComponentsForLabel(indices,mask.width,mask.height);
    const group=groups[0]||[];
    if(group.length<minFacetPixels)return;

    const groupSet=new Set(group);
    let boundary=removeCollinearPixelPoints(traceComponentBoundary(groupSet,mask.width,mask.height));
    if(boundary.length<3)return;
    let outline=boundary.map(([x,y])=>rasterLatLng(mask,x,y));
    outline=simplifyOutline(outline,10);

    const seg=candidates[i];
    outline=regularizeFacetOutline(outline,seg.azimuth,6);
    facets.push({
      index:facets.length+1,
      sourceIndex:seg.sourceIndex,
      pitchDegrees:seg.pitch,
      rise12:Math.tan(seg.pitch*Math.PI/180)*12,
      azimuthDegrees:seg.azimuth,
      center:seg.center,
      z0:seg.z0,
      gradientEast:seg.gradientEast,
      gradientNorth:seg.gradientNorth,
      flatAreaSqFt:group.length*maskPixelArea*SQ_METERS_TO_SQ_FEET,
      slopedAreaSqFt:group.length*maskPixelArea/Math.max(.35,Math.cos(seg.pitch*Math.PI/180))*SQ_METERS_TO_SQ_FEET,
      pixelCount:group.length,
      supportRatio:group.length/Math.max(1,indices.length),
      smallFacet:group.length<70,
      outline
    });
  });

  facets.sort((a,b)=>b.slopedAreaSqFt-a.slopedAreaSqFt);
  const kept=facets.slice(0,20);
  const coveredPixels=kept.reduce((sum,f)=>sum+(f.pixelCount||0),0);
  const roofLines=extractSharedRoofLines(mask,component,labels,candidates,dsm);
  return {
    facets:kept,
    roofLines,
    assignedCoverage:component.size?Math.min(1,coveredPixels/component.size):0,
    rgbAssisted:Boolean(rgb?.bands?.length>=3)
  };
}

function analyzeDsmRoof(mask,component,dsm){
  const pixelMeters=Math.max(.1,Number(dsm.pixelSize)||.1);
  const footprintM2=component.size*Math.pow(Math.max(.1,Number(mask.pixelSize)||.1),2);
  let slopedM2=0,validAreaPixels=0;
  const pitches=[],aspects=[];
  const step=2;

  component.forEach(maskIdx=>{
    const mx=maskIdx%mask.width,my=Math.floor(maskIdx/mask.width);
    if(mx<2||my<2||mx>=mask.width-2||my>=mask.height-2)return;
    const ll=rasterLatLng(mask,mx+.5,my+.5);
    const p=rasterPixelForLatLng(dsm,ll.lat,ll.lng);
    if(p.x<step||p.y<step||p.x>=dsm.width-step||p.y>=dsm.height-step)return;
    const z=Number(dsm.raster[p.y*dsm.width+p.x]);
    const zl=Number(dsm.raster[p.y*dsm.width+p.x-step]);
    const zr=Number(dsm.raster[p.y*dsm.width+p.x+step]);
    const zu=Number(dsm.raster[(p.y-step)*dsm.width+p.x]);
    const zd=Number(dsm.raster[(p.y+step)*dsm.width+p.x]);
    if(![z,zl,zr,zu,zd].every(v=>Number.isFinite(v)&&v>-1000))return;

    const dx=(zr-zl)/(2*step*pixelMeters);
    const dy=(zd-zu)/(2*step*pixelMeters);
    const rawPitch=Math.atan(Math.hypot(dx,dy))*180/Math.PI;
    if(rawPitch>65)return;

    const stablePitch=Math.max(0,Math.min(55,rawPitch));
    slopedM2+=Math.pow(Math.max(.1,Number(mask.pixelSize)||.1),2)/Math.max(.35,Math.cos(stablePitch*Math.PI/180));
    validAreaPixels++;
    if(stablePitch>=3&&stablePitch<=55){
      pitches.push(stablePitch);
      let aspect=Math.atan2(dx,-dy)*180/Math.PI;
      if(aspect<0)aspect+=360;
      aspects.push(aspect);
    }
  });

  if(validAreaPixels<Math.max(50,component.size*.25)||pitches.length<30)throw new Error("Not enough clean elevation samples were available for a reliable roof model.");
  const coverage=validAreaPixels/component.size;
  if(coverage<.45)throw new Error("Elevation coverage was too incomplete for a reliable roof model.");

  const pitchDeg=median(pitches);
  const rise12=Math.tan(pitchDeg*Math.PI/180)*12;
  if(slopedM2<=0)throw new Error("DSM surface area could not be calculated.");

  return {
    footprintSqFt:footprintM2*SQ_METERS_TO_SQ_FEET,
    slopedAreaSqFt:slopedM2*SQ_METERS_TO_SQ_FEET/coverage,
    pitchDegrees:pitchDeg,
    rise12,
    sampleCount:pitches.length,
    coverage
  };
}

async function buildSolarRoofModel(lat,lng,solarSegments=[]){
  const [mask,dsm,rgb]=await Promise.all([
    decodeSolarRaster("mask",lat,lng),
    decodeSolarRaster("dsm",lat,lng),
    decodeSolarRaster("rgb",lat,lng).catch(()=>null)
  ]);
  const target=rasterPixelForLatLng(mask,lat,lng);
  const start=nearestRoofPixel(mask.raster,mask.width,mask.height,target.x,target.y);
  if(start<0)throw new Error("Google did not identify a rooftop at this property.");
  const component=connectedRoofComponent(mask.raster,mask.width,mask.height,start);
  if(component.size<100)throw new Error("The rooftop mask was too small to measure reliably.");

  let pixelOutline=removeCollinearPixelPoints(traceComponentBoundary(component,mask.width,mask.height));
  if(pixelOutline.length<3)throw new Error("The rooftop boundary could not be traced.");
  const rawCornerCount=pixelOutline.length;
  const rawOutline=pixelOutline.map(([x,y])=>rasterLatLng(mask,x,y));

  const model=analyzeDsmRoof(mask,component,dsm);
  const facetResult=detectRoofFacets(mask,component,dsm,solarSegments,rgb);

  let outline=simplifyOutline(rawOutline,12);
  let finalFacets=facetResult.facets;
  let finalRoofLines=facetResult.roofLines||[];
  let geometryMode="detailed";

  const simple=regularizeSimpleGable(rawOutline,finalFacets,finalRoofLines);
  if(simple){
    outline=simple.outline;
    finalFacets=simple.facets;
    finalRoofLines=simple.roofLines;
    geometryMode=simple.mode;
  }

  model.facets=finalFacets;
  model.roofLines=finalRoofLines;
  model.geometryMode=geometryMode;
  model.facetCoverage=facetResult.assignedCoverage;
  model.rgbAssisted=facetResult.rgbAssisted;
  return {outline,rawCornerCount,quality:mask.quality||dsm.quality,model};
}


export {buildSolarRoofModel,buildRoofMeasurements,detectRoofFacets,extractSharedRoofLines,analyzeDsmRoof,decodeSolarRaster,dsmSlopeAt,exteriorEdgeType,rasterPixelForLatLng,rasterLatLng};
