export const LEARNED_ROOF_PRIORS = {
 version:"2026-10-02-r10",
 sampleCount:10,
 profiles:{
  simple:{maxCandidateAdds:4,maxLineExtensionM:4.5,candidateConnectM:3.5,minFaceAreaM2:2.6,nodeSnapM:.42},
  compound:{maxCandidateAdds:12,maxLineExtensionM:7,candidateConnectM:5,minFaceAreaM2:1.1,nodeSnapM:.32},
  hip:{maxCandidateAdds:12,maxLineExtensionM:7,candidateConnectM:5,minFaceAreaM2:1.2,nodeSnapM:.30},
  mixedFlat:{maxCandidateAdds:12,maxLineExtensionM:6.5,candidateConnectM:4.8,minFaceAreaM2:.9,nodeSnapM:.30},
  smallFacet:{maxCandidateAdds:14,maxLineExtensionM:7.5,candidateConnectM:5.2,minFaceAreaM2:.65,nodeSnapM:.28},
  general:{maxCandidateAdds:9,maxLineExtensionM:5.8,candidateConnectM:4.2,minFaceAreaM2:1.5,nodeSnapM:.35}
 }
};

export function chooseLearnedRoofProfile(solarModel){
 const sm=solarModel||{},facets=sm.model?.facets||[],lines=(sm.model?.roofLines||[]).filter(l=>["ridge","hip","valley"].includes(l.type));
 const m=sm.measurements||{},facetCount=facets.length;
 const flat=facets.filter(f=>Number(f.rise12||0)<.75||Number(f.pitchDegrees||0)<4).length;
 const tiny=facets.filter(f=>Number(f.slopedAreaSqFt||f.flatAreaSqFt||0)>0&&Number(f.slopedAreaSqFt||f.flatAreaSqFt||0)<70).length;
 const hips=lines.filter(l=>l.type==="hip").length, valleys=lines.filter(l=>l.type==="valley").length;
 const hipFt=Number(m.hipFt||0),rakeFt=Number(m.rakeFt||0);
 let name="general";
 if(flat>0)name="mixedFlat";
 else if(tiny>=2||facetCount>=10)name="smallFacet";
 else if(hips>=2||hipFt>Math.max(30,rakeFt*.7))name="hip";
 else if(facetCount<=4&&valleys===0&&hips===0)name="simple";
 else if(facetCount>=6||valleys>0)name="compound";
 return {name,...LEARNED_ROOF_PRIORS.profiles[name],trainingVersion:LEARNED_ROOF_PRIORS.version,trainingSamples:LEARNED_ROOF_PRIORS.sampleCount};
}
