export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const address = (url.searchParams.get('address') || '').trim();
  if (!address) return Response.json({ error: 'address is required' }, { status: 400 });
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) return Response.json({ error: 'Google Maps key is not configured.' }, { status: 500 });

  const geoUrl = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  geoUrl.searchParams.set('address', address);
  geoUrl.searchParams.set('key', key);
  const geoRes = await fetch(geoUrl);
  const geo = await geoRes.json();
  const hit = geo?.results?.[0];
  if (!geoRes.ok || geo.status !== 'OK' || !hit?.geometry?.location) {
    return Response.json({ error: geo?.error_message || 'Address could not be geocoded.', status: geo?.status }, { status: 422 });
  }

  const { lat, lng } = hit.geometry.location;
  const half = 0.00042;
  const bbox = [lng-half, lat-half, lng+half, lat+half].join(',');
  const wms = new URL('https://imageserver.gisdata.mn.gov/cgi-bin/mncomp');
  wms.searchParams.set('SERVICE','WMS');
  wms.searchParams.set('VERSION','1.1.1');
  wms.searchParams.set('REQUEST','GetMap');
  wms.searchParams.set('LAYERS','mncomp');
  wms.searchParams.set('STYLES','');
  wms.searchParams.set('SRS','EPSG:4326');
  wms.searchParams.set('BBOX',bbox);
  wms.searchParams.set('WIDTH','1200');
  wms.searchParams.set('HEIGHT','1200');
  wms.searchParams.set('FORMAT','image/jpeg');

  return Response.json({
    address: hit.formatted_address || address,
    lat, lng,
    source: 'Minnesota Geospatial Information Office (MnGeo)',
    imageryUrl: '/api/mn-aerial-image?lat='+encodeURIComponent(lat)+'&lng='+encodeURIComponent(lng),
    bbox
  });
}
