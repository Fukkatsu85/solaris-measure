export async function onRequestGet({ request, env }) {
  if (!env.MEASURE_PHOTOS) return new Response("R2 binding MEASURE_PHOTOS is not configured.", { status: 500 });

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return new Response("key is required.", { status: 400 });

  const object = await env.MEASURE_PHOTOS.get(key);
  if (!object) return new Response("Not found.", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");

  return new Response(object.body, { headers });
}
