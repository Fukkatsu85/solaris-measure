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

export async function onRequestGet({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);

  const url = new URL(request.url);
  const projectId = safeProjectId(url.searchParams.get("projectId"));
  if (!projectId) return json({ error: "projectId is required." }, 400);

  const listed = await env.MEASURE_PHOTOS.list({ prefix: `${projectId}/`, limit: 250 });
  const imageObjects = listed.objects.filter((o) => !o.key.split('/').pop().startsWith('_'));
  return json({
    photos: imageObjects.map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded,
      url: `/api/photo?key=${encodeURIComponent(o.key)}`,
    })),
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);

  const form = await request.formData();
  const file = form.get("file");
  const projectId = safeProjectId(form.get("projectId"));

  if (!projectId) return json({ error: "projectId is required." }, 400);
  if (!(file instanceof File)) return json({ error: "file is required." }, 400);
  if (!file.type.startsWith("image/")) return json({ error: "Only image uploads are allowed." }, 415);
  if (file.size > 25 * 1024 * 1024) return json({ error: "Image exceeds 25 MB limit." }, 413);

  const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  const key = `${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  await env.MEASURE_PHOTOS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  return json({
    ok: true,
    photo: {
      key,
      size: file.size,
      url: `/api/photo?key=${encodeURIComponent(key)}`,
    },
  }, 201);
}

export async function onRequestDelete({ request, env }) {
  if (!env.MEASURE_PHOTOS) return json({ error: "R2 binding MEASURE_PHOTOS is not configured." }, 500);

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return json({ error: "key is required." }, 400);

  await env.MEASURE_PHOTOS.delete(key);
  return json({ ok: true });
}
