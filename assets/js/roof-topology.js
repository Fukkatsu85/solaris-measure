const EARTH=6378137;
const rad=d=>d*Math.PI/180;
const deg=r=>r*180/Math.PI;

function centerOf(points){
  const good=points.filter(p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng)));
  return {
    lat:good.reduce((s,p)=>s+Number(p.lat),0)/Math.max(1,good.length),
    lng:good.reduce((s,p)=>s+Number(p.lng),0)/Math.max(1,good.length)
  };
}
function frame(points){
  const c=centerOf(points),cos=Math.max(.2,Math.cos(rad(c.lat)));
  return {
    center:c,
    toXY:p=>({x:rad(Number(p.lng)-c.lng)*EARTH*cos,y:rad(Number(p.lat)-c.lat)*EARTH}),
    toLL:p=>({lat:c.lat+deg(p.y/EARTH),lng:c.lng+deg(p.x/(EARTH*cos))})
  };
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function angle180(a,b){let d=deg(Math.atan2(b.y-a.y,b.x-a.x))%180;if(d<0)d+=180;return d}
function angleDiff(a,b){let d=Math.abs(a-b)%180;return Math.min(d,180-d)}
function polygonArea(poly){let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p.x*q.y-q.x*p.y}return a/2}
function pointInPoly(p,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    const hit=((a.y>p.y)!=(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y||1e-12)+a.x);
    if(hit)inside=!inside;
  }
  return inside;
}
function pointSegDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));
  return {distance:Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy)),t,point:{x:a.x+t*dx,y:a.y+t*dy}};
}
function lineIntersection(a,b,c,d){
  const rx=b.x-a.x,ry=b.y-a.y,sx=d.x-c.x,sy=d.y-c.y;
  const den=rx*sy-ry*sx;if(Math.abs(den)<1e-9)return null;
  const qx=c.x-a.x,qy=c.y-a.y;
  const t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;
  return {x:a.x+t*rx,y:a.y+t*ry,t,u};
}
function simplifyPoly(poly,minEdge=.45,collinear=.18){
  let out=[...poly],changed=true;
  while(changed&&out.length>3){
    changed=false;
    for(let i=0;i<out.length;i++){
      const a=out[(i-1+out.length)%out.length],b=out[i],c=out[(i+1)%out.length];
      const ab=dist(a,b),bc=dist(b,c),ac=dist(a,c);
      const dev=pointSegDistance(b,a,c).distance;
      if(ab<minEdge||bc<minEdge||(dev<collinear&&ac>Math.max(ab,bc))){
        out.splice(i,1);changed=true;break;
      }
    }
  }
  return out;
}
function snapAngle(raw,families,limit=18){
  let best=raw,diff=999;
  for(const f of families){const d=angleDiff(raw,f);if(d<diff){diff=d;best=f}}
  return {angle:diff<=limit?best:raw,snapped:diff<=limit,diff};
}
function infiniteLineThroughMid(a,b,angle){
  const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2},r=rad(angle),dx=Math.cos(r),dy=Math.sin(r);
  return {a:{x:m.x-dx*1000,y:m.y-dy*1000},b:{x:m.x+dx*1000,y:m.y+dy*1000}};
}
function regularizePerimeter(poly){
  let pts=simplifyPoly(poly,.65,.22);
  if(pts.length<3)return pts;
  let longest={len:0,ang:0};
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length],len=dist(a,b);
    if(len>longest.len)longest={len,ang:angle180(a,b)};
  }
  const base=longest.ang,families=[base,(base+90)%180,(base+45)%180,(base+135)%180];
  const lines=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length],snap=snapAngle(angle180(a,b),families,16);
    lines.push(infiniteLineThroughMid(a,b,snap.angle));
  }
  const rebuilt=[];
  for(let i=0;i<lines.length;i++){
    const prev=lines[(i-1+lines.length)%lines.length],cur=lines[i],hit=lineIntersection(prev.a,prev.b,cur.a,cur.b),ref=pts[i];
    rebuilt.push(hit&&dist(hit,ref)<4?{x:hit.x,y:hit.y}:ref);
  }
  return simplifyPoly(rebuilt,.7,.16);
}
function nearestPointOnPerimeter(p,poly){
  let best={distance:Infinity,point:null,edge:-1};
  for(let i=0;i<poly.length;i++){
    const r=pointSegDistance(p,poly[i],poly[(i+1)%poly.length]);
    if(r.distance<best.distance)best={...r,edge:i};
  }
  return best;
}
function trimOrSnapInternalLine(line,poly,families){
  let a={...line.a},b={...line.b};
  const snap=snapAngle(angle180(a,b),families,20);
  const clean=infiniteLineThroughMid(a,b,snap.angle);
  // Project original endpoints onto snapped line.
  const pa=pointSegDistance(a,clean.a,clean.b).point,pb=pointSegDistance(b,clean.a,clean.b).point;
  a=pa;b=pb;
  // Snap endpoints to perimeter when already reasonably close.
  const na=nearestPointOnPerimeter(a,poly),nb=nearestPointOnPerimeter(b,poly);
  if(na.distance<=1.8)a=na.point;
  if(nb.distance<=1.8)b=nb.point;
  return {...line,a,b,architecturalAngle:snap.angle};
}
function classifyCandidateLine(seg,roofLinesXY){
  const mid={x:(seg.a.x+seg.b.x)/2,y:(seg.a.y+seg.b.y)/2},ang=angle180(seg.a,seg.b);
  let best=null,bestScore=Infinity;
  for(const l of roofLinesXY){
    const d=pointSegDistance(mid,l.a,l.b).distance,ad=angleDiff(ang,angle180(l.a,l.b));
    const score=d+ad*.06;
    if(d<=1.8&&ad<=18&&score<bestScore){bestScore=score;best=l}
  }
  return best?.type||"internal";
}
function deriveFacetAdjacencyLines(facets,F,perimeter,families,roofLinesXY){
  const raw=[];
  facets.forEach((facet,fi)=>{
    const poly=(facet.outline||[]).map(F.toXY);
    for(let i=0;i<poly.length;i++){
      const a=poly[i],b=poly[(i+1)%poly.length],len=dist(a,b);
      if(len<.8)continue;
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if(!pointInPoly(mid,perimeter))continue;
      if(nearestPointOnPerimeter(mid,perimeter).distance<.65)continue;
      raw.push({facet:fi,a,b,len,angle:angle180(a,b)});
    }
  });
  const inferred=[];
  for(let i=0;i<raw.length;i++)for(let j=i+1;j<raw.length;j++){
    const A=raw[i],B=raw[j];if(A.facet===B.facet)continue;
    if(angleDiff(A.angle,B.angle)>14)continue;
    const radA=rad(A.angle),ux=Math.cos(radA),uy=Math.sin(radA),nx=-uy,ny=ux;
    const proj=p=>p.x*ux+p.y*uy,nproj=p=>p.x*nx+p.y*ny;
    const a0=Math.min(proj(A.a),proj(A.b)),a1=Math.max(proj(A.a),proj(A.b));
    const b0=Math.min(proj(B.a),proj(B.b)),b1=Math.max(proj(B.a),proj(B.b));
    const lo=Math.max(a0,b0),hi=Math.min(a1,b1),overlap=hi-lo;
    if(overlap<1.0)continue;
    const na=(nproj(A.a)+nproj(A.b))/2,nb=(nproj(B.a)+nproj(B.b))/2;
    if(Math.abs(na-nb)>1.15)continue;
    const n=(na+nb)/2;
    const p1={x:ux*lo+nx*n,y:uy*lo+ny*n},p2={x:ux*hi+nx*n,y:uy*hi+ny*n};
    const snap=snapAngle(angle180(p1,p2),families,18),line=infiniteLineThroughMid(p1,p2,snap.angle);
    const q1=pointSegDistance(p1,line.a,line.b).point,q2=pointSegDistance(p2,line.a,line.b).point;
    inferred.push({a:q1,b:q2,type:classifyCandidateLine({a:q1,b:q2},roofLinesXY),source:"facet-adjacency",support:2});
  }
  const dedup=[];
  for(const s of inferred.sort((a,b)=>dist(b.a,b.b)-dist(a.a,a.b))){
    const m={x:(s.a.x+s.b.x)/2,y:(s.a.y+s.b.y)/2},ang=angle180(s.a,s.b);
    const dup=dedup.some(d=>{
      const dm={x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2};
      return dist(m,dm)<1.0&&angleDiff(ang,angle180(d.a,d.b))<10;
    });
    if(!dup)dedup.push(s);
  }
  return dedup;
}
function snapInternalEndpoints(lines,perimeter,maxSnap=3.2){
  const out=lines.map(l=>({...l,a:{...l.a},b:{...l.b}}));
  const perimeterSegs=perimeter.map((a,i)=>({a,b:perimeter[(i+1)%perimeter.length]}));
  for(let i=0;i<out.length;i++){
    for(const key of ["a","b"]){
      const p=out[i][key],other=out[i][key==="a"?"b":"a"],base=infiniteLineThroughMid(p,other,angle180(p,other));
      let best=null,bestD=maxSnap;
      const consider=(c,d)=>{
        const h=lineIntersection(base.a,base.b,c,d);if(!h)return;
        const q={x:h.x,y:h.y},dd=dist(p,q);
        if(dd>.12&&dd<bestD){best=q;bestD=dd}
      };
      perimeterSegs.forEach(s=>consider(s.a,s.b));
      for(let j=0;j<out.length;j++)if(j!==i)consider(out[j].a,out[j].b);
      if(best)out[i][key]=best;
    }
  }
  return out.filter(l=>dist(l.a,l.b)>.45);
}
function segmentIntersection(a,b,c,d){
  const h=lineIntersection(a,b,c,d);
  if(!h||h.t<-1e-7||h.t>1+1e-7||h.u<-1e-7||h.u>1+1e-7)return null;
  return h;
}
function splitSegments(segments){
  const cuts=segments.map(()=>[0,1]);
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const h=segmentIntersection(segments[i].a,segments[i].b,segments[j].a,segments[j].b);
    if(!h)continue;
    if(h.t>1e-5&&h.t<1-1e-5)cuts[i].push(h.t);
    if(h.u>1e-5&&h.u<1-1e-5)cuts[j].push(h.u);
  }
  const out=[];
  segments.forEach((s,i)=>{
    const ts=[...new Set(cuts[i].map(v=>Math.round(v*1e6)/1e6))].sort((a,b)=>a-b);
    for(let k=0;k<ts.length-1;k++){
      const t0=ts[k],t1=ts[k+1];
      if(t1-t0<1e-5)continue;
      const a={x:s.a.x+(s.b.x-s.a.x)*t0,y:s.a.y+(s.b.y-s.a.y)*t0};
      const b={x:s.a.x+(s.b.x-s.a.x)*t1,y:s.a.y+(s.b.y-s.a.y)*t1};
      if(dist(a,b)>.18)out.push({...s,a,b});
    }
  });
  return out;
}
function buildPlanarGraph(segments,nodeSnap=.35){
  const nodes=[];
  function nodeFor(p){
    let best=-1,bestD=Infinity;
    for(let i=0;i<nodes.length;i++){const d=dist(p,nodes[i]);if(d<bestD){bestD=d;best=i}}
    if(best>=0&&bestD<=nodeSnap){
      const n=nodes[best],k=n.samples+1;n.x=(n.x*n.samples+p.x)/k;n.y=(n.y*n.samples+p.y)/k;n.samples=k;return best;
    }
    nodes.push({x:p.x,y:p.y,samples:1});return nodes.length-1;
  }
  const map=new Map();
  for(const s of segments){
    const a=nodeFor(s.a),b=nodeFor(s.b);if(a===b)continue;
    const key=a<b?a+"|"+b:b+"|"+a;
    if(!map.has(key))map.set(key,{a,b,type:s.type||"internal",source:s.source||"unknown"});
    else if(["ridge","hip","valley"].includes(s.type))map.get(key).type=s.type;
  }
  return {nodes,edges:[...map.values()]};
}
function extractFaces(nodes,edges,outerPoly){
  const adj=Array.from({length:nodes.length},()=>[]);
  edges.forEach((e,ei)=>{
    adj[e.a].push({to:e.b,edge:ei});
    adj[e.b].push({to:e.a,edge:ei});
  });
  adj.forEach((arr,vi)=>arr.sort((x,y)=>{
    const a=Math.atan2(nodes[x.to].y-nodes[vi].y,nodes[x.to].x-nodes[vi].x);
    const b=Math.atan2(nodes[y.to].y-nodes[vi].y,nodes[y.to].x-nodes[vi].x);
    return a-b;
  }));
  const used=new Set(),faces=[];
  const hkey=(a,b)=>a+">"+b;
  for(let a=0;a<nodes.length;a++)for(const first of adj[a]){
    if(used.has(hkey(a,first.to)))continue;
    const cycle=[];let u=a,v=first.to,guard=0;
    while(guard++<edges.length*4+20){
      const key=hkey(u,v);if(used.has(key))break;
      used.add(key);cycle.push(u);
      const around=adj[v],idx=around.findIndex(x=>x.to===u);
      if(idx<0)break;
      // Take the previous edge in angular order: keeps bounded face on the left.
      const next=around[(idx-1+around.length)%around.length].to;
      u=v;v=next;
      if(u===a&&v===first.to)break;
    }
    if(cycle.length<3)continue;
    const poly=cycle.map(id=>nodes[id]),area=polygonArea(poly);
    if(Math.abs(area)<.8)continue;
    const centroid={x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length};
    if(!pointInPoly(centroid,outerPoly))continue;
    // Keep only bounded, counterclockwise faces; reverse if traversal is clockwise.
    const ids=area>0?cycle:[...cycle].reverse();
    faces.push(ids);
  }
  const unique=new Map();
  for(const ids of faces){
    const min=Math.min(...ids),i=ids.indexOf(min),rot=ids.slice(i).concat(ids.slice(0,i));
    const rev=[...rot].reverse(),k1=rot.join("-"),k2=rev.join("-"),key=k1<k2?k1:k2;
    unique.set(key,rot);
  }
  return [...unique.values()];
}
function faceCentroid(face,nodes){
  const poly=face.map(id=>nodes[id]);
  return {x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length};
}
function nearestFacetMeta(c,facets,F){
  let best=null,bestD=Infinity;
  for(const f of facets){
    const ll=f.center;if(!ll)continue;const p=F.toXY(ll),d=dist(c,p);
    if(d<bestD){bestD=d;best=f}
  }
  return best;
}

export function buildRoofTopology(solarModel){
  const sm=solarModel||{},facets=sm.model?.facets||[],roofLines=sm.model?.roofLines||[],outlineLL=sm.outline||[];
  if(outlineLL.length<3)return null;
  const all=[...outlineLL,...roofLines.flatMap(l=>[l.a,l.b]).filter(Boolean),...facets.flatMap(f=>f.outline||[])],F=frame(all);
  let perimeter=regularizePerimeter(outlineLL.map(F.toXY));
  if(polygonArea(perimeter)<0)perimeter.reverse();

  let longest={len:0,ang:0};
  for(let i=0;i<perimeter.length;i++){const a=perimeter[i],b=perimeter[(i+1)%perimeter.length],len=dist(a,b);if(len>longest.len)longest={len,ang:angle180(a,b)}}
  const families=[longest.ang,(longest.ang+90)%180,(longest.ang+45)%180,(longest.ang+135)%180];

  const segments=[];
  for(let i=0;i<perimeter.length;i++)segments.push({a:perimeter[i],b:perimeter[(i+1)%perimeter.length],type:"perimeter",source:"perimeter"});
  const roofLinesXY=roofLines.filter(l=>["ridge","hip","valley"].includes(l.type)&&l.a&&l.b).map(l=>({...l,a:F.toXY(l.a),b:F.toXY(l.b)}));
  let internal=roofLinesXY.map(l=>trimOrSnapInternalLine(l,perimeter,families)).filter(l=>{
    const mid={x:(l.a.x+l.b.x)/2,y:(l.a.y+l.b.y)/2};
    return pointInPoly(mid,perimeter);
  }).map(l=>({...l,source:"dsm-line"}));
  const inferred=deriveFacetAdjacencyLines(facets,F,perimeter,families,roofLinesXY);
  internal=internal.concat(inferred);
  internal=snapInternalEndpoints(internal,perimeter,3.2);
  segments.push(...internal);

  const split=splitSegments(segments),graph=buildPlanarGraph(split,.28);
  const facesRaw=extractFaces(graph.nodes,graph.edges,perimeter);
  const faces=facesRaw.map((ids,i)=>{
    const c=faceCentroid(ids,graph.nodes),meta=nearestFacetMeta(c,facets,F)||{};
    return {
      id:i+1,vertexIds:ids,
      rise12:Number(meta.rise12||0),
      pitchDegrees:Number(meta.pitchDegrees||0),
      flatAreaSqFt:Number(meta.flatAreaSqFt||0),
      slopedAreaSqFt:Number(meta.slopedAreaSqFt||0)
    };
  });

  const vertices=graph.nodes.map((n,i)=>({id:i,xy:{x:n.x,y:n.y},...F.toLL(n)}));
  const edges=graph.edges.map((e,i)=>({
    id:i+1,a:e.a,b:e.b,type:e.type||"internal",source:e.source||"unknown",
    lengthMeters:dist(graph.nodes[e.a],graph.nodes[e.b])
  }));
  return {
    version:3,
    source:"architectural-planar-topology-v3",
    dominantAngle:longest.ang,
    vertices,edges,faces,
    outline:perimeter.map(F.toLL),
    stats:{
      vertices:vertices.length,edges:edges.length,faces:faces.length,
      perimeterEdges:edges.filter(e=>e.type==="perimeter").length,
      ridgeEdges:edges.filter(e=>e.type==="ridge").length,
      hipEdges:edges.filter(e=>e.type==="hip").length,
      valleyEdges:edges.filter(e=>e.type==="valley").length,
      inferredInternalEdges:edges.filter(e=>e.source==="facet-adjacency").length
    }
  };
}
