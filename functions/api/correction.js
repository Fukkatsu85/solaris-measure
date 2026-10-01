const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const safeProjectId = (value) => String(value || "").trim().toLowerCase()
  .replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 80);
const TYPES = new Set(["window", "door", "shutter", "vent"]);

function recalc(analysis) {
  analysis.totals = { window: 0, door: 0, shutter: 0, vent: 0 };
  for (const p of analysis.photos || []) for (const type of TYPES)
    analysis.totals[type] += p.detections?.[type]?.length || 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);
  const body = await request.json().catch(() => ({}));
  const projectId = safeProjectId(body.projectId);
  const photoKey = String(body.photoKey || "");
  const action = String(body.action || "delete");
  const type = String(body.type || "");
  const index = Number(body.index);
  if (!projectId || !photoKey) return json({ error: "projectId and photoKey are required." }, 400);

  const key = `${projectId}/_analysis.json`;
  const obj = await env.MEASURE_PHOTOS.get(key);
  if (!obj) return json({ error: "No analysis exists yet." }, 404);
  let analysis;
  try { analysis = JSON.parse(await obj.text()); } catch { return json({ error: "Stored analysis is invalid." }, 500); }
  const photo = (analysis.photos || []).find((p) => p.key === photoKey);
  if (!photo) return json({ error: "Photo analysis not found." }, 404);
  photo.detections ||= {};

  if (action === "add") {
    if (!TYPES.has(type)) return json({ error: "Invalid detection type." }, 400);
    const b = body.box || {};
    const vals = ["x1","y1","x2","y2"].map(k => Number(b[k]));
    if (vals.some(v => !Number.isFinite(v))) return json({ error: "Valid box coordinates are required." }, 400);
    const [x1,y1,x2,y2] = vals;
    if (x2 <= x1 || y2 <= y1) return json({ error: "Invalid box dimensions." }, 400);
    photo.detections[type] ||= [];
    photo.detections[type].push({ x1, y1, x2, y2, source: "manual" });
  } else {
    if (!TYPES.has(type) || !Number.isInteger(index) || !Array.isArray(photo.detections[type]) || index < 0 || index >= photo.detections[type].length)
      return json({ error: "Detection not found." }, 404);
    if (action === "retype") {
      const newType = String(body.newType || "");
      if (!TYPES.has(newType)) return json({ error: "Invalid new detection type." }, 400);
      const [box] = photo.detections[type].splice(index, 1);
      photo.detections[newType] ||= [];
      photo.detections[newType].push({ ...box, source: "manual-retype" });
    } else if (action === "delete") {
      photo.detections[type].splice(index, 1);
    } else return json({ error: "Invalid correction action." }, 400);
  }

  recalc(analysis);
  analysis.correctedAt = new Date().toISOString();
  await env.MEASURE_PHOTOS.put(key, JSON.stringify(analysis), { httpMetadata: { contentType: "application/json" } });
  return json({ ok: true, analysis });
}
