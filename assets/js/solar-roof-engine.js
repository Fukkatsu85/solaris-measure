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

function dedupeRoofLines(lines=[]){
  const kept=[];
  for(const line of [...lines].sort((a,b)=>Number(b.lengthMeters||0)-Number(a.lengthMeters||0))){
    if(!["ridge","hip","valley"].includes(line.type)){kept.push(line);continue}
    let duplicate=false;
    for(let i=0;i<kept.length;i++){
      const k=kept[i];
      if(k.type!==line.type||!k.a||!k.b||!line.a||!line.b)continue;
      const da=pointSegmentDistanceMetersLL(line.a,k.a,k.b);
      const db=pointSegmentDistanceMetersLL(line.b,k.a,k.b);
      // If both endpoints of the shorter line sit on the longer line, it is the same boundary.
      if(da<=.75&&db<=.75){duplicate=true;break}
      const ka=pointSegmentDistanceMetersLL(k.a,line.a,line.b);
      const kb=pointSegmentDistanceMetersLL(k.b,line.a,line.b);
      if(ka<=.75&&kb<=.75){
        kept[i]=line;duplicate=true;break;
      }
    }
    if(!duplicate)kept.push(line);
  }
  return kept.sort((a,b)=>Number(b.lengthMeters||0)-Number(a.lengthMeters||0));
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
  return dedupeRoofLines(lines);
}


function pointInPolygonXY(point,poly){
  if(!Array.isArray(poly)||poly.length<3)return false;
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    const hit=((a.y>point.y)!==(b.y>point.y))&&(point.x<(b.x-a.x)*(point.y-a.y)/((b.y-a.y)||1e-12)+a.x);
    if(hit)inside=!inside;
  }
  return inside;
}

function clipPolygonImplicitXY(poly,A,B,C,keepSign){
  if(!Array.isArray(poly)||poly.length<3)return [];
  const val=p=>A*p.x+B*p.y+C;
  const inside=p=>val(p)*keepSign>=-1e-7;
  const out=[];
  for(let i=0;i<poly.length;i++){
    const cur=poly[i],prev=poly[(i-1+poly.length)%poly.length];
    const cv=val(cur),pv=val(prev),ci=inside(cur),pi=inside(prev);
    if(ci){
      if(!pi){
        const den=pv-cv,t=Math.abs(den)<1e-12?0:pv/den;
        out.push({x:prev.x+(cur.x-prev.x)*t,y:prev.y+(cur.y-prev.y)*t});
      }
      out.push(cur);
    }else if(pi){
      const den=pv-cv,t=Math.abs(den)<1e-12?0:pv/den;
      out.push({x:prev.x+(cur.x-prev.x)*t,y:prev.y+(cur.y-prev.y)*t});
    }
  }
  return out;
}

function clipPolygonRectXY(poly,minX,minY,maxX,maxY){
  let out=poly;
  out=clipPolygonImplicitXY(out,1,0,-minX,1);
  out=clipPolygonImplicitXY(out,-1,0,maxX,1);
  out=clipPolygonImplicitXY(out,0,1,-minY,1);
  out=clipPolygonImplicitXY(out,0,-1,maxY,1);
  return out;
}

function planeEquationInFrame(seg,frame){
  const c=frame.toXY(seg.center);
  const ge=Number(seg.gradientEast||0),gn=Number(seg.gradientNorth||0);
  // z = A*x + B*y + C in the roof-local east/north frame.
  return {A:-ge,B:-gn,C:Number(seg.z0)+ge*c.x+gn*c.y,cx:c.x,cy:c.y};
}

function planeDifferenceLine(eqA,eqB){
  return {A:eqA.A-eqB.A,B:eqA.B-eqB.B,C:eqA.C-eqB.C};
}

function lineSpanInPolygonXY(line,poly){
  if(!Array.isArray(poly)||poly.length<3)return null;
  const norm=Math.hypot(line.A,line.B);
  if(norm<1e-8)return null;
  const p0={x:-line.A*line.C/(norm*norm),y:-line.B*line.C/(norm*norm)};
  const dir={x:-line.B/norm,y:line.A/norm};
  const hits=[];
  const push=t=>{if(Number.isFinite(t)&&!hits.some(x=>Math.abs(x-t)<1e-5))hits.push(t)};
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length];
    const vp=line.A*p.x+line.B*p.y+line.C;
    const vq=line.A*q.x+line.B*q.y+line.C;
    if(Math.abs(vp)<1e-7)push((p.x-p0.x)*dir.x+(p.y-p0.y)*dir.y);
    if(vp*vq<0){
      const tEdge=vp/(vp-vq);
      const hit={x:p.x+(q.x-p.x)*tEdge,y:p.y+(q.y-p.y)*tEdge};
      push((hit.x-p0.x)*dir.x+(hit.y-p0.y)*dir.y);
    }
  }
  if(hits.length<2)return null;
  hits.sort((a,b)=>a-b);
  return {min:hits[0],max:hits[hits.length-1],p0,dir};
}


function solve3x3(m,b){
  const a=m.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<3;i++){
    let p=i;for(let r=i+1;r<3;r++)if(Math.abs(a[r][i])>Math.abs(a[p][i]))p=r;
    if(Math.abs(a[p][i])<1e-9)return null;
    [a[i],a[p]]=[a[p],a[i]];
    const d=a[i][i];for(let k=i;k<4;k++)a[i][k]/=d;
    for(let r=0;r<3;r++)if(r!==i){
      const q=a[r][i];for(let k=i;k<4;k++)a[r][k]-=q*a[i][k];
    }
  }
  return [a[0][3],a[1][3],a[2][3]];
}

function fitDsmPlaneRegion(mask,dsm,indices){
  if(!indices?.length)return null;
  const lls=[],pts=[];
  let lat0=0,lng0=0;
  for(const idx of indices){
    const x=idx%mask.width,y=Math.floor(idx/mask.width),ll=rasterLatLng(mask,x+.5,y+.5);
    lat0+=ll.lat;lng0+=ll.lng;lls.push(ll);
  }
  lat0/=lls.length;lng0/=lls.length;
  const origin={lat:lat0,lng:lng0};
  for(const ll of lls){
    const s=dsmSampleAt(dsm,ll.lat,ll.lng);if(!Number.isFinite(s?.z)||s.z<-1000)continue;
    const o=localOffsetMeters(ll,origin);pts.push({x:o.east,y:o.north,z:s.z});
  }
  if(pts.length<12)return null;
  let sx=0,sy=0,sz=0,sxx=0,syy=0,sxy=0,sxz=0,syz=0;
  for(const p of pts){sx+=p.x;sy+=p.y;sz+=p.z;sxx+=p.x*p.x;syy+=p.y*p.y;sxy+=p.x*p.y;sxz+=p.x*p.z;syz+=p.y*p.z}
  const sol=solve3x3([[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,pts.length]],[sxz,syz,sz]);
  if(!sol)return null;
  const [A,B,C]=sol,res=pts.map(p=>Math.abs(p.z-(A*p.x+B*p.y+C)));
  const med=median(res),good=res.filter(x=>x<=.45).length/res.length;
  const ge=-A,gn=-B,slope=Math.hypot(ge,gn),pitch=Math.atan(slope)*180/Math.PI;
  if(!Number.isFinite(pitch)||pitch>60||med>.65||good<.55)return null;
  let azimuth=Math.atan2(ge,gn)*180/Math.PI;if(azimuth<0)azimuth+=360;
  const z0=C;
  const lats=lls.map(p=>p.lat),lngs=lls.map(p=>p.lng);
  return {
    center:origin,z0,pitch,azimuth,gradientEast:ge,gradientNorth:gn,
    residualMedianM:med,supportRatio:good,
    boundingBox:{sw:{latitude:Math.min(...lats),longitude:Math.min(...lngs)},ne:{latitude:Math.max(...lats),longitude:Math.max(...lngs)}}
  };
}

function dsmRegionalPlaneCandidates(mask,component,dsm){
  if(!mask||!component?.size||!dsm)return [];
  const slopeByIdx=new Map();
  for(const idx of component){
    const s=dsmSlopeAt(mask,dsm,idx);
    if(s&&Number.isFinite(s.pitch)&&s.pitch<=55)slopeByIdx.set(idx,s);
  }
  const seen=new Set(),regions=[];
  const pix=Math.max(.1,Number(mask.pixelSize)||.1),pixArea=pix*pix;
  const similar=(a,b)=>{
    const pTol=Math.max(2.4,Math.min(5.5,2.6+Math.min(a.pitch,b.pitch)*.06));
    const aTol=Math.min(a.pitch,b.pitch)<3?55:14;
    return Math.abs(a.pitch-b.pitch)<=pTol&&angleDifference(a.azimuth,b.azimuth)<=aTol;
  };
  for(const start of slopeByIdx.keys()){
    if(seen.has(start))continue;
    const stack=[start],group=[];seen.add(start);
    while(stack.length){
      const idx=stack.pop(),s=slopeByIdx.get(idx);group.push(idx);
      const x=idx%mask.width,y=Math.floor(idx/mask.width),n=[];
      if(x>0)n.push(idx-1);if(x<mask.width-1)n.push(idx+1);if(y>0)n.push(idx-mask.width);if(y<mask.height-1)n.push(idx+mask.width);
      for(const q of n){
        if(seen.has(q)||!component.has(q))continue;
        const qs=slopeByIdx.get(q);if(!qs||!similar(s,qs))continue;
        seen.add(q);stack.push(q);
      }
    }
    const area=group.length*pixArea;
    if(area<.45)continue;
    regions.push({indices:group,area});
  }
  regions.sort((a,b)=>b.area-a.area);
  const out=[];
  for(const r of regions.slice(0,48)){
    const fit=fitDsmPlaneRegion(mask,dsm,r.indices);if(!fit)continue;
    const minArea=fit.pitch>=9?.45:fit.pitch>=4?.75:1.15;
    if(r.area<minArea)continue;
    out.push({
      source:"dsm-region",sourceIndex:1000+out.length,
      center:fit.center,z0:fit.z0,pitch:fit.pitch,azimuth:fit.azimuth,
      pitchDegrees:fit.pitch,azimuthDegrees:fit.azimuth,
      gradientEast:fit.gradientEast,gradientNorth:fit.gradientNorth,
      groundAreaMeters2:r.area,areaMeters2:r.area/Math.max(.35,Math.cos(fit.pitch*Math.PI/180)),
      boundingBox:fit.boundingBox,dsmResidualMedianM:fit.residualMedianM,dsmSupportRatio:fit.supportRatio
    });
  }
  return out;
}

function planeCandidateSet(solarSegments,dsm,rgb,mask=null,component=null,{includeDsmRegions=true}={}){
  const raw=(solarSegments||[])
    .filter(s=>Number.isFinite(Number(s.pitchDegrees))&&Number.isFinite(Number(s.azimuthDegrees))&&s.center)
    .slice(0,64)
    .map((seg,i)=>{
      const center={lat:Number(seg.center.latitude??seg.center.lat),lng:Number(seg.center.longitude??seg.center.lng)};
      const sample=dsmSampleAt(dsm,center.lat,center.lng);
      const pitch=Number(seg.pitchDegrees),azimuth=Number(seg.azimuthDegrees),slope=Math.tan(pitch*Math.PI/180),az=azimuth*Math.PI/180;
      return {...seg,sourceIndex:i,center,
        z0:Number.isFinite(Number(seg.planeHeightAtCenterMeters))?Number(seg.planeHeightAtCenterMeters):Number(sample?.z),
        pitch,azimuth,gradientEast:slope*Math.sin(az),gradientNorth:slope*Math.cos(az),rgb0:rgbSampleAt(rgb,center.lat,center.lng)};
    })
    .filter(seg=>Number.isFinite(seg.z0)&&seg.z0>-1000);

  const kept=[];
  raw.sort((a,b)=>Number(b.areaMeters2||b.groundAreaMeters2||0)-Number(a.areaMeters2||a.groundAreaMeters2||0)).forEach(seg=>{
    const duplicate=kept.find(x=>{
      if(Math.abs(x.pitch-seg.pitch)>1.1||angleDifference(x.azimuth,seg.azimuth)>6)return false;
      if(metersBetween(x.center,seg.center)>3.2)return false;
      const za=planeHeightAt(x,seg.center),zb=planeHeightAt(seg,x.center);
      return (!Number.isFinite(za)||Math.abs(za-seg.z0)<.35)&&(!Number.isFinite(zb)||Math.abs(zb-x.z0)<.35);
    });
    if(duplicate){
      duplicate.mergedSourceIndices=(duplicate.mergedSourceIndices||[duplicate.sourceIndex]).concat(seg.sourceIndex);
      duplicate.areaMeters2=Number(duplicate.areaMeters2||0)+Number(seg.areaMeters2||0);
      duplicate.groundAreaMeters2=Number(duplicate.groundAreaMeters2||0)+Number(seg.groundAreaMeters2||0);
    }else kept.push({...seg,mergedSourceIndices:[seg.sourceIndex]});
  });

  const dsmRegions=includeDsmRegions&&mask&&component?dsmRegionalPlaneCandidates(mask,component,dsm):[];
  const augmented=[...kept];
  for(const seg of dsmRegions){
    const duplicate=augmented.find(x=>{
      const pitchDiff=Math.abs(Number(x.pitch)-Number(seg.pitch)),azDiff=angleDifference(Number(x.azimuth),Number(seg.azimuth));
      const dist=metersBetween(x.center,seg.center);
      if(pitchDiff>2.1||azDiff>10||dist>5.5)return false;
      const za=planeHeightAt(x,seg.center),zb=planeHeightAt(seg,x.center);
      return (!Number.isFinite(za)||Math.abs(za-seg.z0)<.5)&&(!Number.isFinite(zb)||Math.abs(zb-x.z0)<.5);
    });
    if(!duplicate)augmented.push(seg);
  }
  augmented.sort((a,b)=>{
    const ag=String(a.source||"").startsWith("dsm")?0:1,bg=String(b.source||"").startsWith("dsm")?0:1;
    if(ag!==bg)return bg-ag;
    return Number(b.groundAreaMeters2||b.areaMeters2||0)-Number(a.groundAreaMeters2||a.areaMeters2||0);
  });
  return {raw,candidates:augmented.slice(0,48),googleCandidates:kept.length,dsmRegionCandidates:dsmRegions.length};
}

function dsmSupportForCell(mask,component,dsm,cellXY,seg,frame){
  if(!cellXY?.length)return {support:0,samples:0,medianResidual:null};
  const residuals=[],step=Math.max(1,Math.ceil(component.size/1800));
  let n=0,inside=0;
  for(const idx of component){
    if((n++%step)!==0)continue;
    const x=idx%mask.width,y=Math.floor(idx/mask.width),ll=rasterLatLng(mask,x+.5,y+.5),p=frame.toXY(ll);
    if(!pointInPolygonXY(p,cellXY))continue;
    inside++;
    const sample=dsmSampleAt(dsm,ll.lat,ll.lng),pred=planeHeightAt(seg,ll);
    if(Number.isFinite(sample?.z)&&Number.isFinite(pred))residuals.push(Math.abs(sample.z-pred));
  }
  if(!inside||!residuals.length)return {support:0,samples:inside,medianResidual:null};
  const good=residuals.filter(r=>r<=.65).length;
  return {support:good/residuals.length,samples:residuals.length,medianResidual:median(residuals)};
}

function planeResultQuality(result){
  if(!result?.valid)return -Infinity;
  const coverage=Number(result.areaCoverage),support=Number(result.medianSupport);
  const coverageScore=Number.isFinite(coverage)?Math.max(0,1-Math.abs(coverage-1)/.38):0;
  const supportScore=Number.isFinite(support)?Math.max(0,Math.min(1,support)):0;
  const lines=Array.isArray(result.roofLines)?result.roofLines:[];
  const lineStrengths=lines.map(l=>Math.max(Number(l.planeStrength||0),Number(l.creaseStrength||0))).filter(Number.isFinite);
  const lineStrength=lineStrengths.length?Math.min(1,median(lineStrengths)/.45):0;
  const internalLineM=lines.reduce((s,l)=>s+Math.max(0,Number(l.length3dMeters||l.lengthMeters||0)),0);
  const footprintM2=Math.max(1,Number(result.footprintM2||1));
  const lineRatio=internalLineM/Math.sqrt(footprintM2);
  // One very short strong crease used to score well even when most ridges/valleys
  // were missing. Reward useful internal-line coverage, but cap the benefit so
  // noisy line explosions cannot win.
  const lineExtentScore=Math.max(0,Math.min(1,lineRatio/1.35));
  const lineOverflowPenalty=Math.max(0,lineRatio-5)*2;
  const facets=Array.isArray(result.facets)?result.facets:[];
  const residuals=facets.map(f=>Number(f.dsmResidualM)).filter(Number.isFinite);
  const residualScore=residuals.length?Math.max(0,1-median(residuals)/.65):.5;
  const google=Math.max(1,Number(result.googleCandidateCount||0));
  const inflation=Math.max(0,facets.length-(google*1.8+2));
  return supportScore*35+coverageScore*25+lineStrength*12+lineExtentScore*13+residualScore*15
    -Math.min(15,inflation*1.5)-Math.min(12,lineOverflowPenalty);
}


function traceSupportedPlaneIntersection(mask,component,dsm,frame,roofXY,line,segA,segB){
  const span=lineSpanInPolygonXY(line,roofXY);
  if(!span||span.max-span.min<.75)return null;
  const norm=Math.hypot(line.A,line.B);
  if(norm<1e-8)return null;

  const ca=frame.toXY(segA.center),cb=frame.toXY(segB.center);
  const va=line.A*ca.x+line.B*ca.y+line.C;
  const vb=line.A*cb.x+line.B*cb.y+line.C;
  if(Math.abs(va)<1e-6||Math.abs(vb)<1e-6||va*vb>=0)return null;

  const nx=line.A/norm,ny=line.B/norm;
  const sideA=Math.sign(va)||1,sideB=Math.sign(vb)||-1;
  const total=span.max-span.min;
  const step=Math.max(.28,Math.min(.48,total/80));
  const samples=[];
  const toLL=(x,y)=>frame.toLL({x,y});
  const onRoof=(xy)=>{
    if(!pointInPolygonXY(xy,roofXY))return false;
    const ll=toLL(xy.x,xy.y),p=rasterPixelForLatLng(mask,ll.lat,ll.lng);
    return component.has(p.y*mask.width+p.x);
  };

  for(let t=span.min;t<=span.max+step*.25;t+=step){
    const tt=Math.min(span.max,t);
    const center={x:span.p0.x+span.dir.x*tt,y:span.p0.y+span.dir.y*tt};
    let best=null;
    for(const off of [.55,.8,1.05]){
      const axy={x:center.x+nx*sideA*off,y:center.y+ny*sideA*off};
      const bxy={x:center.x+nx*sideB*off,y:center.y+ny*sideB*off};
      if(!onRoof(axy)||!onRoof(bxy))continue;
      const all=toLL(axy.x,axy.y),bll=toLL(bxy.x,bxy.y);
      const az=dsmSampleAt(dsm,all.lat,all.lng)?.z,bz=dsmSampleAt(dsm,bll.lat,bll.lng)?.z;
      const aOwn=planeHeightAt(segA,all),aOther=planeHeightAt(segB,all);
      const bOwn=planeHeightAt(segB,bll),bOther=planeHeightAt(segA,bll);
      if(![az,bz,aOwn,aOther,bOwn,bOther].every(Number.isFinite))continue;
      const ar=Math.abs(az-aOwn),br=Math.abs(bz-bOwn);
      const aAdv=Math.abs(az-aOther)-ar,bAdv=Math.abs(bz-bOther)-br;
      const fit=Math.max(ar,br);
      const good=fit<=.78&&aAdv>=-.18&&bAdv>=-.18;
      const strength=Math.max(0,.9-fit)+Math.max(0,aAdv)+Math.max(0,bAdv);
      if(!best||strength>best.strength)best={good,strength,fit};
    }
    samples.push({t:tt,good:Boolean(best?.good),strength:Number(best?.strength||0)});
    if(tt>=span.max)break;
  }
  if(samples.length<3)return null;

  const goodIdx=samples.map((s,i)=>s.good?i:-1).filter(i=>i>=0);
  if(goodIdx.length<3)return null;
  const clusters=[];
  let cur=[goodIdx[0]];
  for(let k=1;k<goodIdx.length;k++){
    if(goodIdx[k]-goodIdx[k-1]<=3)cur.push(goodIdx[k]);
    else{clusters.push(cur);cur=[goodIdx[k]]}
  }
  clusters.push(cur);
  clusters.sort((a,b)=>{
    const al=samples[a[a.length-1]].t-samples[a[0]].t,bl=samples[b[b.length-1]].t-samples[b[0]].t;
    return bl-al;
  });
  const bestCluster=clusters[0];
  if(!bestCluster||bestCluster.length<3)return null;
  const i0=bestCluster[0],i1=bestCluster[bestCluster.length-1];
  const t0=samples[i0].t,t1=samples[i1].t;
  if(t1-t0<.75)return null;

  const spanCount=Math.max(1,i1-i0+1);
  const support=bestCluster.length/spanCount;
  if(support<.48)return null;
  const vals=bestCluster.map(i=>Number(samples[i].strength||0)).filter(Number.isFinite); const strength=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  const p=t=>frame.toLL({x:span.p0.x+span.dir.x*t,y:span.p0.y+span.dir.y*t});
  return {a:p(t0),b:p(t1),lengthMeters:t1-t0,support,strength};
}

function detectPlaneIntersectionFacets(mask,component,dsm,solarSegments,rawOutline,rgb=null,{includeDsmRegions=true,bboxPadM=1.25}={}){
  if(!Array.isArray(rawOutline)||rawOutline.length<3)return {valid:false,reason:"outline"};
  const {raw,candidates,googleCandidates=0,dsmRegionCandidates=0}=planeCandidateSet(solarSegments,dsm,rgb,mask,component,{includeDsmRegions});
  if(candidates.length<2)return {valid:false,reason:"planes",rawCandidateCount:raw.length,candidateCount:candidates.length};

  const outline=simplifyOutline(rawOutline,40),frame=polygonLocalFrame(outline),roofXY=outline.map(frame.toXY);
  const eqs=candidates.map(s=>planeEquationInFrame(s,frame));
  const cells=[],separators=[];

  for(let i=0;i<candidates.length;i++){
    const seg=candidates[i],eq=eqs[i];
    let cell=roofXY.map(p=>({...p}));

    const bb=seg.boundingBox;
    if(bb?.sw&&bb?.ne){
      const sw=frame.toXY({lat:Number(bb.sw.latitude),lng:Number(bb.sw.longitude)});
      const ne=frame.toXY({lat:Number(bb.ne.latitude),lng:Number(bb.ne.longitude)});
      const pad=Math.max(0,Number(bboxPadM)||0);
      cell=clipPolygonRectXY(cell,Math.min(sw.x,ne.x)-pad,Math.min(sw.y,ne.y)-pad,Math.max(sw.x,ne.x)+pad,Math.max(sw.y,ne.y)+pad);
    }

    for(let j=0;j<candidates.length&&cell.length>=3;j++){
      if(i===j)continue;
      const line=planeDifferenceLine(eq,eqs[j]),norm=Math.hypot(line.A,line.B);
      if(norm<1e-6)continue;
      const ci={x:eq.cx,y:eq.cy},cj={x:eqs[j].cx,y:eqs[j].cy};
      const vi=line.A*ci.x+line.B*ci.y+line.C,vj=line.A*cj.x+line.B*cj.y+line.C;
      // Only use a plane intersection as a partition when it actually separates
      // the two plane centers. Otherwise these planes are not direct neighbors.
      if(Math.abs(vi)<.04||Math.abs(vj)<.04||vi*vj>=0)continue;
      const roofSpan=lineSpanInPolygonXY(line,roofXY);
      if(!roofSpan||roofSpan.max-roofSpan.min<.75)continue;
      cell=clipPolygonImplicitXY(cell,line.A,line.B,line.C,Math.sign(vi)||1);
      if(i<j)separators.push({i,j,line});
    }

    if(cell.length<3)continue;
    const areaM2=polygonAreaXY(cell);
    if(areaM2<.45)continue;
    const support=dsmSupportForCell(mask,component,dsm,cell,seg,frame);
    const expected=Number(seg.groundAreaMeters2||0);
    const areaRatio=expected>0?areaM2/expected:null;
    // Google plane stats are trusted as hypotheses, but the fitted region still
    // needs either reasonable DSM support or area agreement.
    if(support.samples>=15&&support.support<.28&&(areaRatio==null||areaRatio<.35||areaRatio>2.8))continue;

    const poly=cell.map(frame.toLL),pitch=Number(seg.pitch)||0;
    cells.push({
      index:cells.length+1,planeIndex:i,sourceIndex:seg.sourceIndex,sourceComponentIndex:0,
      pitchDegrees:pitch,rise12:Math.tan(pitch*Math.PI/180)*12,azimuthDegrees:Number(seg.azimuth)||0,
      center:seg.center,planeCenter:seg.center,z0:seg.z0,gradientEast:seg.gradientEast,gradientNorth:seg.gradientNorth,
      flatAreaSqFt:areaM2*SQ_METERS_TO_SQ_FEET,
      slopedAreaSqFt:areaM2/Math.max(.35,Math.cos(pitch*Math.PI/180))*SQ_METERS_TO_SQ_FEET,
      componentAreaM2:areaM2,compactness:1,outline:regularizeFacetOutline(poly,seg.azimuth,8),
      dsmSupport:support.support,dsmResidualM:support.medianResidual,expectedGroundAreaM2:expected||null,areaRatio
    });
  }

  if(cells.length<2)return {valid:false,reason:"cells",facets:cells,rawCandidateCount:raw.length,candidateCount:candidates.length};

  const byPlane=new Map(cells.map(f=>[f.planeIndex,f])),roofLines=[];
  for(const sep of separators){
    const fa=byPlane.get(sep.i),fb=byPlane.get(sep.j);
    if(!fa||!fb)continue;
    const ca=candidates[sep.i],cb=candidates[sep.j];

    // First trace the mathematical plane intersection across the roof mask using
    // DSM support on both sides. This recovers full ridges/hips/valleys even
    // when Google segment bounding boxes or clipped facet cells are conservative.
    let traced=traceSupportedPlaneIntersection(mask,component,dsm,frame,roofXY,sep.line,ca,cb);
    let line=null,traceSupport=0,traceStrength=0;
    if(traced){
      line={a:traced.a,b:traced.b,lengthMeters:traced.lengthMeters};
      traceSupport=traced.support;traceStrength=traced.strength;
    }else{
      const aXY=fa.outline.map(frame.toXY),bXY=fb.outline.map(frame.toXY);
      const sa=lineSpanInPolygonXY(sep.line,aXY),sb=lineSpanInPolygonXY(sep.line,bXY);
      if(!sa||!sb)continue;
      const lo=Math.max(sa.min,sb.min),hi=Math.min(sa.max,sb.max);
      if(hi-lo<.75)continue;
      const p=t=>frame.toLL({x:sa.p0.x+sa.dir.x*t,y:sa.p0.y+sa.dir.y*t});
      line={a:p(lo),b:p(hi),lengthMeters:hi-lo};
    }

    const classified=classifySharedRoofLine(line,ca,cb,dsm);
    if(classified.type==="transition")continue;
    const refined=classified.line||line;
    const type=classified.type==="ridge_or_hip"?ridgeOrHipType(ca,cb,dsm):classified.type;
    roofLines.push({type,facetA:fa.index-1,facetB:fb.index-1,a:refined.a,b:refined.b,
      lengthMeters:metersBetween(refined.a,refined.b),length3dMeters:roofLine3dMeters(refined,ca,cb),
      creaseStrength:classified.creaseStrength||0,planeStrength:classified.planeStrength||0,
      traceSupport,traceStrength,source:traced?"plane-dsm-trace-v5":"plane-cell-intersection"});
  }

  const footprintM2=component.size*Math.pow(Math.max(.1,Number(mask.pixelSize)||.1),2);
  const planSum=cells.reduce((s,f)=>s+Number(f.componentAreaM2||0),0);
  const areaCoverage=footprintM2>0?planSum/footprintM2:0;
  const supports=cells.map(f=>Number(f.dsmSupport)).filter(Number.isFinite);
  const medianSupport=supports.length?median(supports):0;
  const valid=areaCoverage>=.62&&areaCoverage<=1.22&&medianSupport>=.25&&roofLines.length>=1;

  const result={
    valid,facets:cells.sort((a,b)=>b.slopedAreaSqFt-a.slopedAreaSqFt),roofLines:dedupeRoofLines(roofLines),
    assignedCoverage:Math.min(1,areaCoverage),rgbAssisted:false,rawCandidateCount:raw.length,candidateCount:candidates.length,
    googleCandidateCount:googleCandidates,dsmRegionCandidateCount:dsmRegionCandidates,
    areaCoverage,medianSupport,footprintM2,
    bboxPadM:Number(bboxPadM)||0,
    totalInternalLineMeters:roofLines.reduce((s,l)=>s+Math.max(0,Number(l.length3dMeters||l.lengthMeters||0)),0),
    tracedLineCount:roofLines.filter(l=>l.source==="plane-dsm-trace-v5").length,
    engine:(Number(bboxPadM)>2?(includeDsmRegions?"plane-v4-wide-dsm":"plane-v4-wide-google"):(includeDsmRegions?"plane-v3-dsm-regions":"plane-v2-google-only")),
    reason:valid?null:"quality"
  };
  result.qualityScore=planeResultQuality(result);
  return result;
}

function detectRoofFacets(mask,component,dsm,solarSegments=[],rgb=null){
  const rawCandidates=solarSegments
    .filter(s=>Number.isFinite(Number(s.pitchDegrees))&&Number.isFinite(Number(s.azimuthDegrees))&&s.center)
    .slice(0,64)
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

  // Google can expose multiple near-duplicate roofSegmentStats records for one
  // physical plane. Collapse only local, nearly coplanar duplicates so simple
  // roofs do not explode into many artificial facets, while distant coplanar
  // wings remain separate.
  const candidates=[];
  rawCandidates
    .sort((a,b)=>Number(b.areaMeters2||b.groundAreaMeters2||0)-Number(a.areaMeters2||a.groundAreaMeters2||0))
    .forEach(seg=>{
      const duplicate=candidates.find(x=>{
        const pitchDiff=Math.abs(Number(x.pitch)-Number(seg.pitch));
        const azDiff=angleDifference(Number(x.azimuth),Number(seg.azimuth));
        const centerDist=metersBetween(x.center,seg.center);
        if(pitchDiff>1.35||azDiff>7||centerDist>4.25)return false;
        const zAtSeg=planeHeightAt(x,seg.center),zAtX=planeHeightAt(seg,x.center);
        const zOk=(!Number.isFinite(zAtSeg)||Math.abs(zAtSeg-seg.z0)<.45)&&(!Number.isFinite(zAtX)||Math.abs(zAtX-x.z0)<.45);
        return zOk;
      });
      if(duplicate){
        duplicate.mergedSourceIndices=(duplicate.mergedSourceIndices||[duplicate.sourceIndex]).concat(seg.sourceIndex);
        duplicate.areaMeters2=Number(duplicate.areaMeters2||0)+Number(seg.areaMeters2||0);
        duplicate.groundAreaMeters2=Number(duplicate.groundAreaMeters2||0)+Number(seg.groundAreaMeters2||0);
      }else candidates.push({...seg,mergedSourceIndices:[seg.sourceIndex]});
    });

  if(!candidates.length)return {facets:[],assignedCoverage:0,rgbAssisted:false,candidateCount:0,rawCandidateCount:rawCandidates.length};

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
      const pixelMeters=Math.max(.1,Number(mask.pixelSize)||.1);
      const pixelAreaM2=pixelMeters*pixelMeters;
      const minExtraAreaM2=1.85; // ~20 ft²; secondary islands below this are usually segmentation fragments
      groups.slice(1).forEach(group=>{
        const xs=group.map(idx=>idx%mask.width),ys=group.map(idx=>Math.floor(idx/mask.width));
        const spanXpx=Math.max(...xs)-Math.min(...xs)+1,spanYpx=Math.max(...ys)-Math.min(...ys)+1;
        const spanXm=spanXpx*pixelMeters,spanYm=spanYpx*pixelMeters;
        const areaM2=group.length*pixelAreaM2;
        const bboxPixels=Math.max(1,spanXpx*spanYpx);
        const compactness=group.length/bboxPixels;
        // Preserve only physically meaningful secondary pieces of the same roof plane.
        const share=group.length/Math.max(1,indices.length);
        const strongSecondary=areaM2>=minExtraAreaM2&&Math.min(spanXm,spanYm)>=1.0&&compactness>=.34&&share>=.12;
        if(strongSecondary)return;
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
  const pixelMeters=Math.max(.1,Number(mask.pixelSize)||.1);
  const minSecondaryAreaM2=1.85;
  byLabel.forEach((indices,i)=>{
    if(!indices.length)return;
    const groups=connectedComponentsForLabel(indices,mask.width,mask.height);
    const seg=candidates[i];

    groups.forEach((group,componentIndex)=>{
      const xs=group.map(idx=>idx%mask.width),ys=group.map(idx=>Math.floor(idx/mask.width));
      const spanXpx=Math.max(...xs)-Math.min(...xs)+1,spanYpx=Math.max(...ys)-Math.min(...ys)+1;
      const spanXm=spanXpx*pixelMeters,spanYm=spanYpx*pixelMeters;
      const areaM2=group.length*maskPixelArea;
      const compactness=group.length/Math.max(1,spanXpx*spanYpx);
      const isPrimary=componentIndex===0;
      const share=group.length/Math.max(1,indices.length);
      const physicalSecondary=isPrimary||(areaM2>=minSecondaryAreaM2&&Math.min(spanXm,spanYm)>=1.0&&compactness>=.34&&share>=.12);
      if(!physicalSecondary)return;

      const groupSet=new Set(group);
      let boundary=removeCollinearPixelPoints(traceComponentBoundary(groupSet,mask.width,mask.height));
      if(boundary.length<3)return;
      let outline=boundary.map(([x,y])=>rasterLatLng(mask,x,y));
      outline=simplifyOutline(outline,14);
      outline=regularizeFacetOutline(outline,seg.azimuth,6);

      const localCenter=outline.length
        ?{lat:outline.reduce((s,p)=>s+Number(p.lat),0)/outline.length,lng:outline.reduce((s,p)=>s+Number(p.lng),0)/outline.length}
        :seg.center;

      facets.push({
        index:facets.length+1,
        sourceIndex:seg.sourceIndex,
        sourceComponentIndex:componentIndex,
        pitchDegrees:seg.pitch,
        rise12:Math.tan(seg.pitch*Math.PI/180)*12,
        azimuthDegrees:seg.azimuth,
        center:localCenter,
        planeCenter:seg.center,
        z0:seg.z0,
        gradientEast:seg.gradientEast,
        gradientNorth:seg.gradientNorth,
        flatAreaSqFt:areaM2*SQ_METERS_TO_SQ_FEET,
        slopedAreaSqFt:areaM2/Math.max(.35,Math.cos(seg.pitch*Math.PI/180))*SQ_METERS_TO_SQ_FEET,
        pixelCount:group.length,
        supportRatio:group.length/Math.max(1,indices.length),
        smallFacet:!isPrimary,
        componentAreaM2:areaM2,
        compactness,
        outline
      });
    });
  });

  facets.sort((a,b)=>b.slopedAreaSqFt-a.slopedAreaSqFt);
  // Keep one primary component per plane plus only strongly supported secondary
  // components. This prevents simple roofs from fragmenting into dozens of
  // artificial facets while still allowing complex roofs to exceed the Google
  // segment count when the raster contains a real disconnected plane region.
  const primaryCount=facets.filter(f=>!f.smallFacet).length;
  const facetCap=Math.min(64,Math.max(primaryCount,Math.round(primaryCount*1.45)+2));
  const kept=facets.slice(0,facetCap);
  const coveredPixels=kept.reduce((sum,f)=>sum+(f.pixelCount||0),0);
  const roofLines=extractSharedRoofLines(mask,component,labels,candidates,dsm);
  return {
    facets:kept,
    roofLines,
    assignedCoverage:component.size?Math.min(1,coveredPixels/component.size):0,
    rgbAssisted:Boolean(rgb?.bands?.length>=3),
    rawCandidateCount:rawCandidates.length,
    candidateCount:candidates.length,
    facetCap
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
  const rasterFacetResult=detectRoofFacets(mask,component,dsm,solarSegments,rgb);
  const planeV2=detectPlaneIntersectionFacets(mask,component,dsm,solarSegments,rawOutline,rgb,{includeDsmRegions:false,bboxPadM:1.25});
  const planeV3=detectPlaneIntersectionFacets(mask,component,dsm,solarSegments,rawOutline,rgb,{includeDsmRegions:true,bboxPadM:1.25});
  let tightBest=null;
  if(planeV2.valid&&planeV3.valid){
    tightBest=Number(planeV3.qualityScore)>Number(planeV2.qualityScore)+2.5?planeV3:planeV2;
  }else tightBest=planeV3.valid?planeV3:(planeV2.valid?planeV2:null);

  // Google segment bounding boxes are often conservative and were truncating
  // otherwise valid ridge/valley intersections to 1–2 m. Re-run the winning
  // plane family with a wider soft neighborhood and keep it only when the
  // independent DSM/coverage/line-quality score improves.
  const wideUsesDsm=tightBest?tightBest.engine==="plane-v3-dsm-regions":true;
  const planeWide=detectPlaneIntersectionFacets(mask,component,dsm,solarSegments,rawOutline,rgb,{includeDsmRegions:wideUsesDsm,bboxPadM:6});
  let planeFacetResult=tightBest;
  if(planeWide.valid&&(!planeFacetResult||Number(planeWide.qualityScore)>Number(planeFacetResult.qualityScore)+1.5))planeFacetResult=planeWide;

  const facetResult=planeFacetResult||rasterFacetResult;

  let outline=simplifyOutline(rawOutline,24);
  let finalFacets=facetResult.facets;
  let finalRoofLines=facetResult.roofLines||[];
  let geometryMode=planeFacetResult?("plane_intersection_"+planeFacetResult.engine+"_selected"):"detailed_raster_fallback";

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
  model.googleSegmentInputCount=Array.isArray(solarSegments)?solarSegments.length:0;
  model.rawCandidatePlaneCount=facetResult.rawCandidateCount??null;
  model.candidatePlaneCount=facetResult.candidateCount??null;
  model.facetCap=facetResult.facetCap??null;
  model.lineEngineVersion="plane-dsm-trace-v5";
  model.facetEngineVersion=planeFacetResult?(
    planeFacetResult.engine==="plane-v4-wide-dsm"?"plane-v4-wide-dsm-selected":
    planeFacetResult.engine==="plane-v4-wide-google"?"plane-v4-wide-google-selected":
    planeFacetResult.engine==="plane-v3-dsm-regions"?"plane-v3-selected":"plane-v2-selected"
  ):"raster-r4-fallback";
  model.planeIntersectionDiagnostics={
    valid:Boolean(planeFacetResult),
    selected:planeFacetResult?.engine||"raster-r4-fallback",
    reason:planeFacetResult?.reason||null,
    areaCoverage:Number.isFinite(Number(planeFacetResult?.areaCoverage))?Number(planeFacetResult.areaCoverage):null,
    medianDsmSupport:Number.isFinite(Number(planeFacetResult?.medianSupport))?Number(planeFacetResult.medianSupport):null,
    facetCount:Array.isArray(planeFacetResult?.facets)?planeFacetResult.facets.length:0,
    roofLineCount:Array.isArray(planeFacetResult?.roofLines)?planeFacetResult.roofLines.length:0,
    googleCandidateCount:Number.isFinite(Number(planeFacetResult?.googleCandidateCount))?Number(planeFacetResult.googleCandidateCount):null,
    dsmRegionCandidateCount:Number.isFinite(Number(planeFacetResult?.dsmRegionCandidateCount))?Number(planeFacetResult.dsmRegionCandidateCount):null,
    googleOnly:{valid:Boolean(planeV2.valid),qualityScore:Number.isFinite(Number(planeV2.qualityScore))?Number(planeV2.qualityScore):null,facets:Array.isArray(planeV2.facets)?planeV2.facets.length:0,lines:Array.isArray(planeV2.roofLines)?planeV2.roofLines.length:0},
    dsmAugmented:{valid:Boolean(planeV3.valid),qualityScore:Number.isFinite(Number(planeV3.qualityScore))?Number(planeV3.qualityScore):null,facets:Array.isArray(planeV3.facets)?planeV3.facets.length:0,lines:Array.isArray(planeV3.roofLines)?planeV3.roofLines.length:0},
    wide:{valid:Boolean(planeWide.valid),engine:planeWide.engine||null,qualityScore:Number.isFinite(Number(planeWide.qualityScore))?Number(planeWide.qualityScore):null,facets:Array.isArray(planeWide.facets)?planeWide.facets.length:0,lines:Array.isArray(planeWide.roofLines)?planeWide.roofLines.length:0,totalInternalLineMeters:Number(planeWide.totalInternalLineMeters||0)}
  };
  return {outline,rawCornerCount,quality:mask.quality||dsm.quality,model};
}


export {buildSolarRoofModel,buildRoofMeasurements,detectRoofFacets,detectPlaneIntersectionFacets,extractSharedRoofLines,analyzeDsmRoof,decodeSolarRaster,dsmSlopeAt,exteriorEdgeType,rasterPixelForLatLng,rasterLatLng};
