const COUNTY_LAYERS={
  "Dakota County":{layer:"dak23",label:"2023 Dakota County 6-inch",resolution:"6-inch"},
  "Hennepin County":{layer:"hen22",label:"2022 Hennepin County 6-inch",resolution:"6-inch"},
  "Ramsey County":{layer:"rams20",label:"2020 Ramsey County 6-inch",resolution:"6-inch"},
  "Washington County":{layer:"wash13",label:"2013 Washington County 6-inch",resolution:"6-inch"},
  "Scott County":{layer:"scott13",label:"2013 Scott County 6-inch",resolution:"6-inch"},
  "Rice County":{layer:"rice23",label:"2023 Rice County 6-inch",resolution:"6-inch"},
  "Wabasha County":{layer:"wab25",label:"2025 Wabasha County 2-inch",resolution:"2-inch"},
  "Lake County":{layer:"lake24",label:"2024 Lake County 6-inch",resolution:"6-inch"},
  "Lyon County":{layer:"lyon24",label:"2024 Lyon County 3–6 inch",resolution:"3–6 inch"},
  "Beltrami County":{layer:"belt23",label:"2023 Beltrami County 9-inch",resolution:"9-inch"},
  "Douglas County":{layer:"doug22",label:"2022 Douglas County 2-inch",resolution:"2-inch"},
  "McLeod County":{layer:"mcle22",label:"2022 McLeod County 4-inch",resolution:"4-inch"},
  "Steele County":{layer:"steele22",label:"2022 Steele County 3-inch",resolution:"3-inch"},
  "Carlton County":{layer:"carlton21",label:"2021 Carlton County 6-inch",resolution:"6-inch"},
  "Le Sueur County":{layer:"lesueur21",label:"2021 Le Sueur County 3-inch",resolution:"3-inch"}
};
const METRO=new Set(["Anoka County","Carver County","Dakota County","Hennepin County","Ramsey County","Scott County","Washington County"]);
export async function onRequestGet({request,env}){
 const url=new URL(request.url),address=(url.searchParams.get("address")||"").trim();
 if(!address)return Response.json({error:"address is required"},{status:400});
 const key=env.GOOGLE_MAPS_API_KEY;if(!key)return Response.json({error:"Google Maps key is not configured."},{status:500});
 const g=new URL("https://maps.googleapis.com/maps/api/geocode/json");g.searchParams.set("address",address);g.searchParams.set("key",key);
 const gr=await fetch(g),geo=await gr.json(),hit=geo?.results?.[0];
 if(!gr.ok||geo.status!=="OK"||!hit?.geometry?.location)return Response.json({error:geo?.error_message||"Address could not be geocoded.",status:geo?.status},{status:422});
 const {lat,lng}=hit.geometry.location;
 const county=hit.address_components?.find(c=>c.types?.includes("administrative_area_level_2"))?.long_name||"";
 let pick=COUNTY_LAYERS[county];
 if(!pick&&METRO.has(county))pick={layer:"met25",label:"2025 Twin Cities Metro 1-foot",resolution:"1-foot"};
 if(!pick)pick={layer:"fsa2025",label:"2025 statewide NAIP ~2-foot",resolution:"~2-foot"};
 const imageryUrl="/api/mn-aerial-image?lat="+encodeURIComponent(lat)+"&lng="+encodeURIComponent(lng)+"&layer="+encodeURIComponent(pick.layer);
 return Response.json({
   address:hit.formatted_address||address,lat,lng,county,
   imageryLayer:pick.layer,imageryLabel:pick.label,resolution:pick.resolution,
   source:"Minnesota Geospatial Information Office (MnGeo) — "+pick.label,
   imageryUrl,
   cropHalfMeters:42,
   projection:"EPSG:3857"
 });
}