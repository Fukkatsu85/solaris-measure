const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const TARGETS = [
  { id: "window", label: "Window", targets: ["window on the exterior of the house", "window"] },
  { id: "door", label: "Door", targets: ["exterior door on the house", "door"] },
  { id: "shutter", label: "Shutter", targets: ["window shutter on the house", "shutter"] },
  { id: "vent", label: "Vent", targets: ["exterior wall vent on the house", "vent"] },
  { id: "outside_corner", label: "Outside corner", targets: ["outside vertical corner of the house exterior", "outside building corner"] },
  { id: "inside_corner", label: "Inside corner", targets: ["inside vertical corner of the house exterior", "inside building corner"] },
  { id: "eave", label: "Eave", targets: ["roof eave edge", "eave"] },
  { id: "rake", label: "Rake", targets: ["sloped roof rake edge on a gable", "roof rake"] },
  { id: "gable", label: "Gable", targets: ["gable wall area", "gable"] },
];

const safeProjectId = (value) =>
  String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 80);

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function readJson(env, key, fallback) {
  const obj = await env.MEASURE_PHOTOS.get(key);
  if (!obj) return fallback;
  try { return JSON.parse(await obj.text()); } catch { return fallback; }
}

function normalizeBox(obj) {
  const box = obj?.box || obj?.bbox || obj?.bounding_box || obj || {};
  let x1 = box.x_min ?? box.xmin ?? box.x1 ?? box.left ?? box.x;
  let y1 = box.y_min ?? box.ymin ?? box.y1 ?? box.top ?? box.y;
  let x2 = box.x_max ?? box.xmax ?? box.x2 ?? box.right;
  let y2 = box.y_max ?? box.ymax ?? box.y2 ?? box.bottom;
  if (x2 == null && box.width != null && x1 != null) x2 = Number(x1) + Number(box.width);
  if (y2 == null && box.height != null && y1 != null) y2 = Number(y1) + Number(box.height);
  if ([x1,y1,x2,y2].some(v => v == null || !Number.isFinite(Number(v)))) return null;
  x1=Number(x1); y1=Number(y1); x2=Number(x2); y2=Number(y2);
  const max = Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2));
  if (max > 1.5 && max <= 100) { x1/=100; y1/=100; x2/=100; y2/=100; }
  return { x1, y1, x2, y2 };
}

async function detect(env, image, targets) {
  for (const target of targets) {
    const result = await env.AI.run(MODEL, {
      task: "detect",
      image,
      target,
      max_objects: 80,
      stream: false,
    });
    const objects = result?.objects || result?.result?.objects || [];
    const boxes = objects.map(normalizeBox).filter(Boolean);
    if (boxes.length) return { boxes, target };
  }
  return { boxes: [], target: targets[0] };
}

async function caption(env, image) {
  const result = await env.AI.run(MODEL, {
    task: "caption",
    image,
    caption_length: "short",
    stream: false,
  });
  return result?.caption || result?.result?.caption || "";
}

export async function onRequestGet({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);
  const url = new URL(request.url);
  const projectId = safeProjectId(url.searchParams.get("projectId"));
  if (!projectId) return json({ error: "projectId is required." }, 400);
  const result = await readJson(env, `${projectId}/_analysis.json`, null);
  return json({ analysis: result });
}

export async function onRequestPost({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);
  if (!env.AI) return json({ error: "Workers AI binding AI is not configured." }, 500);

  const body = await request.json().catch(() => ({}));
  const projectId = safeProjectId(body.projectId);
  if (!projectId) return json({ error: "projectId is required." }, 400);

  const manifest = await readJson(env, `${projectId}/_project.json`, { photoViews: {} });
  const listed = await env.MEASURE_PHOTOS.list({ prefix: `${projectId}/`, limit: 250 });
  const photos = listed.objects.filter((o) => !o.key.split('/').pop().startsWith('_'));

  if (!photos.length) return json({ error: "No photos found." }, 400);

  const results = [];
  for (let i = 0; i < photos.length; i++) {
    const meta = photos[i];
    const object = await env.MEASURE_PHOTOS.get(meta.key);
    if (!object) continue;

    const type = object.httpMetadata?.contentType || "image/jpeg";
    const bytes = new Uint8Array(await object.arrayBuffer());
    const dataUri = `data:${type};base64,${bytesToBase64(bytes)}`;

    const imageCaption = await caption(env, dataUri);
    const detections = {};
    const matchedTargets = {};
    for (const t of TARGETS) {
      const detected = await detect(env, dataUri, t.targets);
      detections[t.id] = detected.boxes;
      matchedTargets[t.id] = detected.target;
    }

    results.push({
      key: meta.key,
      view: manifest.photoViews?.[meta.key] || "unassigned",
      url: `/api/photo?key=${encodeURIComponent(meta.key)}`,
      caption: imageCaption,
      matchedTargets,
      detections,
    });
  }

  const analysis = {
    projectId,
    model: MODEL,
    createdAt: new Date().toISOString(),
    targets: TARGETS,
    photos: results,
    totals: TARGETS.reduce((acc, t) => {
      acc[t.id] = results.reduce((sum, p) => sum + (p.detections[t.id]?.length || 0), 0);
      return acc;
    }, {}),
  };

  await env.MEASURE_PHOTOS.put(
    `${projectId}/_analysis.json`,
    JSON.stringify(analysis),
    { httpMetadata: { contentType: "application/json" } }
  );

  return json({ ok: true, analysis });
}
