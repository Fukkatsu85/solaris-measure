const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const safeProjectId = (value) =>
  String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 80);

export async function onRequestPost({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);

  const body = await request.json().catch(() => ({}));
  const projectId = safeProjectId(body.projectId);
  const photoKey = String(body.photoKey || "");
  const type = String(body.type || "");
  const index = Number(body.index);

  if (!projectId || !photoKey || !type || !Number.isInteger(index)) {
    return json({ error: "projectId, photoKey, type, and index are required." }, 400);
  }

  const key = `${projectId}/_analysis.json`;
  const obj = await env.MEASURE_PHOTOS.get(key);
  if (!obj) return json({ error: "No analysis exists yet." }, 404);

  let analysis;
  try { analysis = JSON.parse(await obj.text()); }
  catch { return json({ error: "Stored analysis is invalid." }, 500); }

  const photo = (analysis.photos || []).find((p) => p.key === photoKey);
  if (!photo || !Array.isArray(photo.detections?.[type])) {
    return json({ error: "Detection not found." }, 404);
  }

  if (index < 0 || index >= photo.detections[type].length) {
    return json({ error: "Detection index is out of range." }, 400);
  }

  photo.detections[type].splice(index, 1);

  analysis.totals = analysis.totals || {};
  for (const [detType] of Object.entries(analysis.totals)) {
    analysis.totals[detType] = (analysis.photos || [])
      .reduce((sum, p) => sum + (p.detections?.[detType]?.length || 0), 0);
  }
  analysis.correctedAt = new Date().toISOString();

  await env.MEASURE_PHOTOS.put(key, JSON.stringify(analysis), {
    httpMetadata: { contentType: "application/json" },
  });

  return json({ ok: true, analysis });
}
