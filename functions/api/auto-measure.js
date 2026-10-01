const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const safe = (value) => String(value || "")
  .trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 80);

async function read(env, key, fallback) {
  const object = await env.MEASURE_PHOTOS.get(key);
  if (!object) return fallback;
  try { return JSON.parse(await object.text()); } catch { return fallback; }
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    total += p.x * q.y - q.x * p.y;
  }
  return Math.abs(total / 2);
}

function distance(a, b) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function canonical(view) {
  if (view === "front" || view === "front-left" || view === "front-right") return "front";
  if (view === "rear" || view === "rear-left" || view === "rear-right") return "rear";
  if (view === "left") return "left";
  if (view === "right") return "right";
  return null;
}

const benchmarks = { front: 445, right: 394, left: 410, rear: 417 };

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = safe(body.projectId);
    if (!projectId) return json({ error: "projectId required" }, 400);

    const geometry = await read(env, projectId + "/_geometry.json", { photos: {} });
    const verified = await read(env, projectId + "/_verified.json", null);
    const project = await read(env, projectId + "/_project.json", { photoViews: {} });
    const calibration = await read(env, projectId + "/_calibration.json", { references: [] });

    if (!verified) return json({ error: "Preserve verified objects first." }, 400);

    const references = (calibration.references || []).filter((r) =>
      r && r.p1 && r.p2 && Number(r.feet) > 0
    );
    const reference = [...references].reverse().find((r) => r.type !== "rectangle") || references[references.length - 1];
    if (!reference) return json({ error: "No diagnostic scale reference is saved." }, 400);

    const pixelSpan = distance(reference.p1, reference.p2);
    if (!Number.isFinite(pixelSpan) || pixelSpan <= 0) {
      return json({ error: "Saved diagnostic scale is invalid." }, 400);
    }
    const scale = Number(reference.feet) / pixelSpan;

    let verifiedPhotos = [];
    if (Array.isArray(verified.photos)) {
      verifiedPhotos = verified.photos;
    } else if (verified.photos && typeof verified.photos === "object") {
      verifiedPhotos = Object.entries(verified.photos).map(([key, value]) => {
        const photo = value && typeof value === "object" ? value : {};
        return Object.assign({ key }, photo);
      });
    }

    const photos = [];
    for (const vp of verifiedPhotos) {
      const photoKey = vp.key || vp.photoKey;
      if (!photoKey) continue;
      const shapes = (geometry.photos && geometry.photos[photoKey]) || [];
      const walls = shapes.filter((shape) => shape.type === "wall");
      if (!walls.length) continue;

      const view = (project.photoViews && project.photoViews[photoKey]) || vp.view || "unassigned";
      const elevation = canonical(view);
      const imageArea = walls.reduce((sum, wall) => sum + polygonArea(wall.points), 0);
      const grossAreaFt2 = imageArea * scale * scale;

      photos.push({
        photoKey,
        view,
        elevation,
        wallCount: walls.length,
        grossAreaFt2,
        confidence: elevation ? "diagnostic" : "low"
      });
    }

    const elevations = {};
    for (const name of ["front", "right", "left", "rear"]) {
      const candidates = photos.filter((photo) => photo.elevation === name);
      if (!candidates.length) {
        elevations[name] = { areaFt2: null, benchmark: benchmarks[name], status: "needs_view" };
        continue;
      }
      const selected = candidates.find((photo) => photo.view === name) || candidates[0];
      elevations[name] = {
        areaFt2: selected.grossAreaFt2,
        benchmark: benchmarks[name],
        differenceFt2: selected.grossAreaFt2 - benchmarks[name],
        errorPct: ((selected.grossAreaFt2 - benchmarks[name]) / benchmarks[name]) * 100,
        sourceView: selected.view,
        wallCount: selected.wallCount,
        confidence: selected.confidence,
        status: "diagnostic"
      };
    }

    const measured = Object.values(elevations).filter((item) => Number.isFinite(item.areaFt2));
    const total = measured.reduce((sum, item) => sum + item.areaFt2, 0);
    const result = {
      version: 2,
      createdAt: new Date().toISOString(),
      method: "reconstruction workspace diagnostic",
      photos,
      elevations,
      totalAreaFt2: total,
      benchmarkTotal: 1666,
      totalDifferenceFt2: total - 1666,
      totalErrorPct: ((total - 1666) / 1666) * 100,
      complete: measured.length === 4,
      warning: "Diagnostic only. Single-photo scale is not a production measurement method."
    };

    await env.MEASURE_PHOTOS.put(
      projectId + "/_auto_measure.json",
      JSON.stringify(result),
      { httpMetadata: { contentType: "application/json" } }
    );
    return json({ ok: true, result });
  } catch (error) {
    return json({ error: error && error.message ? error.message : String(error), stage: "auto-reconstruction" }, 500);
  }
}
