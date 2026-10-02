export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return new Response('lat/lng required', { status: 400 });
  const half = 0.00042;
  const wms = new URL('https://imageserver.gisdata.mn.gov/cgi-bin/mncomp');
  for (const [k,v] of Object.entries({
    SERVICE:'WMS', VERSION:'1.1.1', REQUEST:'GetMap', LAYERS:'mncomp', STYLES:'',
    SRS:'EPSG:4326', BBOX:[lng-half,lat-half,lng+half,lat+half].join(','),
    WIDTH:'1200', HEIGHT:'1200', FORMAT:'image/jpeg'
  })) wms.searchParams.set(k,v);
  const r = await fetch(wms.toString(), { headers: { 'User-Agent': 'Solaris-Measure/1.0' } });
  if (!r.ok) return new Response('MnGeo imagery unavailable', { status: 502 });
  return new Response(r.body, { headers: { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control':'public, max-age=86400' } });
}
