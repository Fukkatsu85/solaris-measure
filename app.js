const PROJECT_ID = 'test-house-001';
const VIEW_OPTIONS = [
  ['unassigned', 'Unassigned'],
  ['front', 'Front'],
  ['front-right', 'Front-right'],
  ['right', 'Right'],
  ['rear-right', 'Rear-right'],
  ['rear', 'Rear'],
  ['rear-left', 'Rear-left'],
  ['left', 'Left'],
  ['front-left', 'Front-left'],
];

const analyze = document.querySelector('#analyze');
const analysisState = document.querySelector('#analysis-state');
const newProject = document.querySelector('#new-project');
const openTestHouse = document.querySelector('#open-test-house');
const input = document.querySelector('#photo-input');
const uploadStatus = document.querySelector('#upload-status');
const gallery = document.querySelector('#photo-gallery');
const photosCard = document.querySelector('#photos-card');

let projectManifest = { photoViews: {} };

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function loadManifest() {
  const res = await fetch(`/api/project?projectId=${encodeURIComponent(PROJECT_ID)}`);
  const data = await res.json().catch(() => ({}));
  if (res.ok) projectManifest = data;
}

async function saveView(photoKey, view, select) {
  select.disabled = true;
  const res = await fetch('/api/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: PROJECT_ID, photoKey, view }),
  });
  const data = await res.json().catch(() => ({}));
  select.disabled = false;
  if (!res.ok) {
    alert(data.error || 'Could not save viewpoint.');
    return;
  }
  projectManifest = data.manifest;
  updateClassificationStatus();
}

function updateClassificationStatus() {
  const views = Object.values(projectManifest.photoViews || {});
  const assigned = views.filter((v) => v && v !== 'unassigned').length;
  const unique = new Set(views.filter((v) => v && v !== 'unassigned')).size;
  if (!views.length) return;
  uploadStatus.textContent = `${assigned} of 8 photos classified · ${unique} unique viewpoints assigned.`;
}

async function loadPhotos() {
  uploadStatus.textContent = 'Loading photos…';
  try {
    await loadManifest();
    const res = await fetch(`/api/photos?projectId=${encodeURIComponent(PROJECT_ID)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load photos.');
    renderPhotos((data.photos || []).filter((p) => !p.key.endsWith('/_project.json')));
  } catch (err) {
    gallery.innerHTML = '';
    uploadStatus.textContent = err.message;
  }
}

function renderPhotos(photos) {
  if (!photos.length) {
    gallery.innerHTML = '';
    uploadStatus.textContent = 'No photos uploaded yet. Add the 8 benchmark photos to begin.';
    return;
  }

  gallery.innerHTML = photos.map((photo, index) => {
    const current = projectManifest.photoViews?.[photo.key] || 'unassigned';
    const options = VIEW_OPTIONS.map(([value, label]) =>
      `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`
    ).join('');

    return `
      <article class="photo-tile">
        <img src="${photo.url}" alt="Property photo ${index + 1}" loading="lazy" />
        <div class="photo-meta">
          <span>Photo ${index + 1}</span>
          <span>${formatBytes(photo.size)}</span>
        </div>
        <label class="view-label">
          Viewpoint
          <select class="view-select" data-key="${encodeURIComponent(photo.key)}">
            ${options}
          </select>
        </label>
        <button class="delete-photo" data-key="${encodeURIComponent(photo.key)}">Remove</button>
      </article>
    `;
  }).join('');

  gallery.querySelectorAll('.view-select').forEach((select) => {
    select.addEventListener('change', () => {
      const key = decodeURIComponent(select.dataset.key);
      saveView(key, select.value, select);
    });
  });

  gallery.querySelectorAll('.delete-photo').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Remove this photo from Test House #001?')) return;
      button.disabled = true;
      const key = decodeURIComponent(button.dataset.key);
      const res = await fetch(`/api/photos?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Could not remove photo.');
      }
      await loadPhotos();
    });
  });

  updateClassificationStatus();
}

input?.addEventListener('change', async () => {
  const files = [...input.files];
  if (!files.length) return;

  let uploaded = 0;
  for (const file of files) {
    uploadStatus.textContent = `Uploading ${uploaded + 1} of ${files.length}: ${file.name}`;
    const form = new FormData();
    form.append('projectId', PROJECT_ID);
    form.append('file', file);

    const res = await fetch('/api/photos', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      uploadStatus.textContent = data.error || `Upload failed for ${file.name}`;
      input.value = '';
      return;
    }
    uploaded += 1;
  }

  input.value = '';
  await loadPhotos();
});

analyze?.addEventListener('click', () => {
  const views = Object.values(projectManifest.photoViews || {}).filter((v) => v && v !== 'unassigned');
  if (views.length < 8) {
    analysisState.textContent = 'Assign all 8 photos to viewpoints before feature detection. This gives the geometry engine a reliable clockwise order around the house.';
    photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  analysisState.textContent = 'All viewpoints are assigned. The capture set is ready for first-pass window, door, wall-boundary, corner and roofline detection.';
});

newProject?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

openTestHouse?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

loadPhotos();
