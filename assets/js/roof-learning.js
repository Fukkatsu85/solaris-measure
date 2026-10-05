export const LEARNED_ROOF_PRIORS = {
 version:"2026-10-05-r40-hidden-complexity",
 sampleCount:40,
 profiles:{
  simple:{maxCandidateAdds:2,maxLineExtensionM:4.0,candidateConnectM:3.2,minFaceAreaM2:2.8,nodeSnapM:.44},
  compound:{maxCandidateAdds:6,maxLineExtensionM:5.8,candidateConnectM:4.2,minFaceAreaM2:1.7,nodeSnapM:.36},
  hip:{maxCandidateAdds:8,maxLineExtensionM:6.0,candidateConnectM:4.5,minFaceAreaM2:1.35,nodeSnapM:.33},
  lowSlopeHip:{maxCandidateAdds:6,maxLineExtensionM:5.2,candidateConnectM:4.1,minFaceAreaM2:1.5,nodeSnapM:.38},
  mixedFlat:{maxCandidateAdds:8,maxLineExtensionM:5.8,candidateConnectM:4.2,minFaceAreaM2:1.0,nodeSnapM:.34},
  smallFacet:{maxCandidateAdds:11,maxLineExtensionM:6.5,candidateConnectM:4.7,minFaceAreaM2:.55,nodeSnapM:.29},
  steepMicro:{maxCandidateAdds:16,maxLineExtensionM:6.8,candidateConnectM:4.9,minFaceAreaM2:.22,nodeSnapM:.26},
  general:{maxCandidateAdds:6,maxLineExtensionM:5.2,candidateConnectM:3.9,minFaceAreaM2:1.65,nodeSnapM:.36}
 }
};

export function chooseLearnedRoofProfile(solarModel){
 const sm=solarModel||{},facets=sm.model?.facets||[],lines=(sm.model?.roofLines||[]).filter(l=>["ridge","hip","valley"].includes(l.type));
 const m=sm.measurements||{},facetCount=facets.length;
 const flat=facets.filter(f=>Number(f.rise12||0)<.75||Number(f.pitchDegrees||0)<4).length;
 const tiny=facets.filter(f=>Number(f.slopedAreaSqFt||f.flatAreaSqFt||0)>0&&Number(f.slopedAreaSqFt||f.flatAreaSqFt||0)<75).length;
 const micro=facets.filter(f=>Number(f.slopedAreaSqFt||f.flatAreaSqFt||0)>0&&Number(f.slopedAreaSqFt||f.flatAreaSqFt||0)<35).length;
 const hips=lines.filter(l=>l.type==="hip").length, valleys=lines.filter(l=>l.type==="valley").length;
 const hipFt=Number(m.hipFt||0),rakeFt=Number(m.rakeFt||0);
 const augmentedFacetCount=Number(sm?.model?.planeIntersectionDiagnostics?.dsmAugmented?.facets||0);
 const hiddenFacetEvidence=Math.max(0,augmentedFacetCount-facetCount);
 const pitchVals=facets.map(f=>Number(f.rise12||0)).filter(Number.isFinite);
 const avgPitch=pitchVals.length?pitchVals.reduce((a,b)=>a+b,0)/pitchVals.length:0;
 let name="general";
 // The expanded corpus contains legitimate 20–44 facet steep roofs. Do not
 // simplify those with the same rules used for ordinary small-facet noise.
 if((micro>=4||facetCount>=20)&&avgPitch>=8)name="steepMicro";
 else if(flat>0)name="mixedFlat";
 else if((hips>=2||hipFt>Math.max(30,rakeFt*.7))&&avgPitch<=3.25)name="lowSlopeHip";
 else if(hiddenFacetEvidence>=3&&augmentedFacetCount>=8)name="smallFacet";
 else if(micro>=2||tiny>=3||facetCount>=10)name="smallFacet";
 else if(hips>=2||hipFt>Math.max(30,rakeFt*.7))name="hip";
 else if(facetCount<=4&&valleys===0&&hips===0)name="simple";
 else if(facetCount>=6||valleys>0)name="compound";
 return {name,...LEARNED_ROOF_PRIORS.profiles[name],trainingVersion:LEARNED_ROOF_PRIORS.version,trainingSamples:LEARNED_ROOF_PRIORS.sampleCount};
}
