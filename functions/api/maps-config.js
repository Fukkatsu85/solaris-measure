export async function onRequestGet({ env }) {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (!key) return Response.json({ error: 'GOOGLE_MAPS_API_KEY is not configured.' }, { status: 500 });
  return Response.json({ key });
}
