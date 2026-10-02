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
function angle180(a,b){
  let d=deg(Math.atan2(b.y-a.y,b.x-a.x))%180;
  if(d<0)d+=180;
  return d;
}
function angleDiff(a,b){let d=Math.abs(a-b)%180;return Math.min(d,180-d)}
function pointSegDist(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
}
function simplifyIds(ids){
  const out=[...ids];
  let changed=true;
  while(changed&&out.length>3){
    changed=false;
    for(let i=0;i<out.length;i++){
      const a=out[(i-1+out.length)%out.length],b=out[i],c=out[(i+1)%out.length];
      if(a===b||b===c){out.splice(i,1);changed=true;break}
    }
  }
  return out;
}
function canonicalEdge(a,b){return a<b?a+"|"+b:b+"|"+a}

export function buildRoofTopology(solarModel,{snapMeters=.9,lineSnapMeters=1.2}={}){
  const sm=solarModel||{};
  const facets=sm.model?.facets||[];
  const roofLines=sm.model?.roofLines||[];
  const outline=sm.outline||[];
  const all=[...outline,...facets.flatMap(f=>f.outline||[]),...roofLines.flatMap(l=>[l.a,l.b]).filter(Boolean)];
  if(outline.length<3||!facets.length)return null;
  const F=frame(all);
  const nodes=[];

  function nodeFor(ll){
    const p=F.toXY(ll);
    let best=-1,bestD=Infinity;
    for(let i=0;i<nodes.length;i++){
      const d=dist(p,nodes[i]);
      if(d<bestD){bestD=d;best=i}
    }
    if(best>=0&&bestD<=snapMeters){
      const n=nodes[best],k=n.samples+1;
      n.x=(n.x*n.samples+p.x)/k;n.y=(n.y*n.samples+p.y)/k;n.samples=k;
      return best;
    }
    nodes.push({x:p.x,y:p.y,samples:1});
    return nodes.length-1;
  }

  const facetFaces=facets.map((f,fi)=>{
    const ids=simplifyIds((f.outline||[]).map(nodeFor));
    return {id:fi+1,vertexIds:ids,rise12:Number(f.rise12||0),pitchDegrees:Number(f.pitchDegrees||0),flatAreaSqFt:Number(f.flatAreaSqFt||0),slopedAreaSqFt:Number(f.slopedAreaSqFt||0)};
  }).filter(f=>f.vertexIds.length>=3);

  const edgeMap=new Map();
  facetFaces.forEach(face=>{
    const ids=face.vertexIds;
    for(let i=0;i<ids.length;i++){
      const a=ids[i],b=ids[(i+1)%ids.length];
      if(a===b)continue;
      const key=canonicalEdge(a,b);
      if(!edgeMap.has(key))edgeMap.set(key,{a,b,faces:[]});
      edgeMap.get(key).faces.push(face.id);
    }
  });

  const rl=roofLines.map(l=>({...l,aXY:F.toXY(l.a),bXY:F.toXY(l.b)}));
  const edges=[...edgeMap.values()].map((e,idx)=>{
    const a=nodes[e.a],b=nodes[e.b],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    let type=e.faces.length>1?"internal":"perimeter",best=lineSnapMeters;
    for(const l of rl){
      const d=pointSegDist(mid,l.aXY,l.bXY);
      if(d<best&&angleDiff(angle180(a,b),angle180(l.aXY,l.bXY))<18){best=d;type=l.type||type}
    }
    return {id:idx+1,a:e.a,b:e.b,faces:e.faces,type,lengthMeters:dist(a,b)};
  });

  const perimeterEdges=edges.filter(e=>e.faces.length===1);
  // Dominant architectural direction from longest perimeter edge.
  let dominant=0;
  if(perimeterEdges.length){
    const e=[...perimeterEdges].sort((x,y)=>y.lengthMeters-x.lengthMeters)[0];
    dominant=angle180(nodes[e.a],nodes[e.b]);
  }
  const families=[dominant,(dominant+90)%180,(dominant+45)%180,(dominant+135)%180];

  // Snap only high-confidence two-vertex directions for display metadata.
  edges.forEach(e=>{
    const raw=angle180(nodes[e.a],nodes[e.b]);
    let best=raw,diff=999;
    for(const f of families){const d=angleDiff(raw,f);if(d<diff){diff=d;best=f}}
    e.architecturalAngle=diff<=16?best:raw;
    e.angleSnapApplied=diff<=16;
  });

  const vertices=nodes.map((n,i)=>({id:i,xy:{x:n.x,y:n.y},...F.toLL(n)}));
  return {
    version:1,
    source:"google-dsm-topology",
    dominantAngle:dominant,
    vertices,
    edges,
    faces:facetFaces,
    outline,
    stats:{
      vertices:vertices.length,
      edges:edges.length,
      faces:facetFaces.length,
      sharedEdges:edges.filter(e=>e.faces.length>1).length,
      perimeterEdges:perimeterEdges.length
    }
  };
}
