const PROJECT_ID = 'test-house-001';

const analyze = document.querySelector('#analyze');
const analysisState = document.querySelector('#analysis-state');
const newProject = document.querySelector('#new-project');
const openTestHouse = document.querySelector('#open-test-house');
const input = document.querySelector('#photo-input');
const uploadStatus = document.querySelector('#upload-status');
const gallery = document.querySelector('#photo-gallery');
const photosCard = document.querySelector('#photos-card');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

async function loadPhotos() {
  uploadStatus.textContent = 'Loading photos…';
  try {
    const res = await fetch(`/api/photos?projectId=${encodeURIComponent(PROJECT_ID)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load photos.');
    renderPhotos(data.photos || []);
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

  uploadStatus.textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'} stored in Solaris Measure.`;
  gallery.innerHTML = photos.map((photo, index) => `
    <article class="photo-tile">
      <img src="${photo.url}" alt="Property photo ${index + 1}" loading="lazy" />
      <div class="photo-meta">
        <span>Photo ${index + 1}</span>
        <span>${formatBytes(photo.size)}</span>
      </div>
      <button class="delete-photo" data-key="${encodeURIComponent(photo.key)}">Remove</button>
    </article>
  `).join('');

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
  analysisState.textContent = 'Photo storage is connected. Next step: classify viewpoints and run first-pass feature detection.';
});

newProject?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

openTestHouse?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

loadPhotos();
