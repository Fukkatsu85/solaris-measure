export const ROOF_TRAINING_V1 = [
  {address:"506 Annis, Lakefield, MN 56150",source:"Roofr",slopedAreaFt2:2408,facetCount:4,avgPitch12:4,eaveFt:143.75,valleyFt:0,hipFt:0,ridgeFt:71.8333,rakeFt:101.25,flatAreaFt2:0,facetAreasFt2:[524,524,681,681],archetype:"simple-gable"},
  {address:"507 Annis, Lakefield, MN 56150",source:"Roofr",slopedAreaFt2:3111,facetCount:11,avgPitch12:4,eaveFt:179.25,valleyFt:48.8333,hipFt:27.5833,ridgeFt:105.25,rakeFt:145.3333,flatAreaFt2:485,facetAreasFt2:[549,605,341,549,65,34,34,65,195,195,485],archetype:"mixed-flat-complex"},
  {address:"509 Annis, Lakefield, MN 56150",source:"Roofr",slopedAreaFt2:1609,facetCount:3,avgPitch12:4,eaveFt:112.75,valleyFt:0,hipFt:0,ridgeFt:45.4167,rakeFt:77.9167,flatAreaFt2:0,facetAreasFt2:[149,732,729],archetype:"simple-gable"},
  {address:"621 Cherry Street, Lakefield, MN 56150",source:"Roofr",slopedAreaFt2:3562,facetCount:8,avgPitch12:6,eaveFt:134.0833,valleyFt:97.5833,hipFt:0,ridgeFt:134.5833,rakeFt:176.6667,flatAreaFt2:0,facetAreasFt2:[174,168,539,442,185,185,1003,870],archetype:"compound-valley"},
  {address:"508 Annis, Lakefield, MN 56150",source:"Roofr",slopedAreaFt2:2258,facetCount:4,avgPitch12:4,eaveFt:143,valleyFt:0,hipFt:0,ridgeFt:71.5,rakeFt:94.9167,flatAreaFt2:0,facetAreasFt2:[383,383,747,747],archetype:"simple-gable"},
  {address:"7056 Drew Avenue North, Minneapolis, MN 55429",source:"Roofr",slopedAreaFt2:2494,facetCount:10,avgPitch12:4,eaveFt:293.9167,valleyFt:13.6667,hipFt:164,ridgeFt:43.4167,rakeFt:0,flatAreaFt2:0,facetAreasFt2:[144,261,453,392,144,261,360,178,93,214],archetype:"hip-dominant-multistructure"},
  {address:"1979 Shryer Avenue West, Roseville, MN 55113",source:"Roofr",slopedAreaFt2:2820,facetCount:12,avgPitch12:3,eaveFt:185,valleyFt:6.75,hipFt:3.25,ridgeFt:90.4167,rakeFt:152,flatAreaFt2:0,facetAreasFt2:[337,559,254,10,156,10,152,2,6,2,670,667],archetype:"compound-small-facets"},
  {address:"2404 Crestmount Lane, Burnsville, MN 55306",source:"Roofr",slopedAreaFt2:1950,facetCount:6,avgPitch12:6,eaveFt:121.1667,valleyFt:22.25,hipFt:0,ridgeFt:69.25,rakeFt:112.3333,flatAreaFt2:0,facetAreasFt2:[181,9,346,178,592,646],archetype:"compound-valley"},
  {address:"5554 Shoreview Avenue, Minneapolis, MN 55417",source:"Roofr",slopedAreaFt2:1326,facetCount:7,avgPitch12:7,eaveFt:108.0833,valleyFt:21.4167,hipFt:0,ridgeFt:57.5,rakeFt:102,flatAreaFt2:172,facetAreasFt2:[132,445,374,27,30,149,173],archetype:"mixed-flat-multistructure"},
  {address:"3507 North Washburn Avenue, Minneapolis, MN 55412",source:"Roofr",slopedAreaFt2:1926,facetCount:10,avgPitch12:9,eaveFt:123.75,valleyFt:41.5,hipFt:0,ridgeFt:81.1667,rakeFt:170.3333,flatAreaFt2:0,facetAreasFt2:[64,581,515,320,261,64,31,31,31,31],archetype:"steep-compound-multistructure"}
];

const norm=s=>String(s||"").toLowerCase().replace(/\b(avenue|ave\.?|street|st\.?|lane|ln\.?|north|n\.?|west|w\.?)\b/g,m=>({avenue:"ave", "ave.":"ave",ave:"ave",street:"st","st.":"st",st:"st",lane:"ln","ln.":"ln",ln:"ln",north:"n","n.":"n",n:"n",west:"w","w.":"w",w:"w"}[m]||m)).replace(/[^a-z0-9]+/g," ").trim();

export function findTrainingBenchmark(address){
 const n=norm(address);
 if(!n)return null;
 let best=null,bestScore=0;
 for(const row of ROOF_TRAINING_V1){
  const r=norm(row.address);
  if(n===r)return row;
  const a=new Set(n.split(" ")),b=new Set(r.split(" "));
  const common=[...a].filter(x=>b.has(x)).length,score=common/Math.max(a.size,b.size);
  if(score>bestScore){bestScore=score;best=row}
 }
 return bestScore>=.72?best:null;
}

export const LEARNED_PRIORS_V1 = {
 version:"2026-10-02-r10",
 sampleCount:10,
 summary:{
  medianFacetCount:5,
  complexFacetThreshold:7,
  smallFacetAreaFt2:70,
  mixedFlatThresholdFt2:100
 },
 profiles:{
  "simple-gable":{maxCandidateAdds:4,maxLineExtensionM:4.5,candidateConnectM:3.5,minFaceAreaM2:2.6,nodeSnapM:.42},
  "compound-valley":{maxCandidateAdds:12,maxLineExtensionM:7,candidateConnectM:5,minFaceAreaM2:1.1,nodeSnapM:.32},
  "hip-dominant":{maxCandidateAdds:12,maxLineExtensionM:7,candidateConnectM:5,minFaceAreaM2:1.2,nodeSnapM:.30},
  "mixed-flat":{maxCandidateAdds:12,maxLineExtensionM:6.5,candidateConnectM:4.8,minFaceAreaM2:.9,nodeSnapM:.30},
  "complex-small-facets":{maxCandidateAdds:14,maxLineExtensionM:7.5,candidateConnectM:5.2,minFaceAreaM2:.65,nodeSnapM:.28},
  "general":{maxCandidateAdds:9,maxLineExtensionM:5.8,candidateConnectM:4.2,minFaceAreaM2:1.5,nodeSnapM:.35}
 }
};
