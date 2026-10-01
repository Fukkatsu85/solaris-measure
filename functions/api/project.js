const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const safeProjectId = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);

const validViews = new Set([
  "front","front-right","right","rear-right",
  "rear","rear-left","left","front-left","unassigned"
]);

async function readManifest(env, projectId) {
  const key = `${projectId}/_project.json`;
  const object = await env.MEASURE_PHOTOS.get(key);
  if (!object) return { projectId, photoViews: {} };
  try {
    return JSON.parse(await object.text());
  } catch {
    return { projectId, photoViews: {} };
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);
  const url = new URL(request.url);
  const projectId = safeProjectId(url.searchParams.get("projectId"));
  if (!projectId) return json({ error: "projectId is required." }, 400);
  return json(await readManifest(env, projectId));
}

export async function onRequestPost({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);

  const body = await request.json().catch(() => null);
  const projectId = safeProjectId(body?.projectId);
  const photoKey = String(body?.photoKey || "");
  const view = String(body?.view || "unassigned");

  if (!projectId) return json({ error: "projectId is required." }, 400);
  if (!photoKey.startsWith(`${projectId}/`)) return json({ error: "photoKey does not belong to project." }, 400);
  if (!validViews.has(view)) return json({ error: "Invalid viewpoint." }, 400);

  const manifest = await readManifest(env, projectId);
  manifest.photoViews = manifest.photoViews || {};
  manifest.photoViews[photoKey] = view;
  manifest.updatedAt = new Date().toISOString();

  await env.MEASURE_PHOTOS.put(
    `${projectId}/_project.json`,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: "application/json" } }
  );

  return json({ ok: true, manifest });
}
