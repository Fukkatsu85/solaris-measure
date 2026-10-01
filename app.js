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
const analysisGallery = document.querySelector('#analysis-gallery');

let projectManifest = { photoViews: {} };
let currentPhotos = [];
let lastAnalysis = null;

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
  const keys = new Set(currentPhotos.map((p) => p.key));
  const assignedViews = Object.entries(projectManifest.photoViews || {})
    .filter(([key, view]) => keys.has(key) && view && view !== 'unassigned')
    .map(([, view]) => view);
  const assigned = assignedViews.length;
  const unique = new Set(assignedViews).size;
  const total = currentPhotos.length;
  uploadStatus.textContent = total
    ? `${assigned} of ${total} photos classified · ${unique} unique viewpoints assigned.`
    : 'No photos uploaded yet.';
}

async function loadPhotos() {
  uploadStatus.textContent = 'Loading photos…';
  try {
    await loadManifest();
    const res = await fetch(`/api/photos?projectId=${encodeURIComponent(PROJECT_ID)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load photos.');
    currentPhotos = (data.photos || []).filter((p) => !p.key.endsWith('/_project.json') && !p.key.endsWith('/_analysis.json'));
    renderPhotos(currentPhotos);
  } catch (err) {
    gallery.innerHTML = '';
    uploadStatus.textContent = err.message;
  }
}

function renderPhotos(photos) {
  if (!photos.length) {
    gallery.innerHTML = '';
    uploadStatus.textContent = 'No photos uploaded yet.';
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
          <select class="view-select" data-key="${encodeURIComponent(photo.key)}">${options}</select>
        </label>
        <button class="delete-photo" data-key="${encodeURIComponent(photo.key)}">Remove</button>
      </article>`;
  }).join('');

  gallery.querySelectorAll('.view-select').forEach((select) => {
    select.addEventListener('change', () => {
      saveView(decodeURIComponent(select.dataset.key), select.value, select);
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

function pct(v) {
  return Math.max(0, Math.min(100, Number(v) * 100));
}

function renderAnalysis(analysis) {
  if (!analysisGallery) return;
  if (!analysis?.photos?.length) { analysisGallery.innerHTML = ''; return; }
  const labels = { window: 'Window', door: 'Door', shutter: 'Shutter', vent: 'Vent' };

  analysisGallery.innerHTML = analysis.photos.map((photo) => {
    const boxes = Object.entries(photo.detections || {}).flatMap(([type, list]) =>
      (list || []).map((b, index) => {
        const left=pct(b.x1), top=pct(b.y1), width=Math.max(0,pct(b.x2)-left), height=Math.max(0,pct(b.y2)-top);
        return `<button class="detect-box detect-${type}" data-photo-key="${encodeURIComponent(photo.key)}" data-type="${type}" data-index="${index}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"><span>${labels[type]||type}</span></button>`;
      })).join('');
    const counts=Object.entries(photo.detections||{}).map(([type,list])=>`${labels[type]||type}: ${(list||[]).length}`).join(' · ');
    return `<article class="analysis-photo">
      <div class="verify-toolbar">
        <strong>${photo.view}</strong>
        <button class="secondary add-feature" data-photo-key="${encodeURIComponent(photo.key)}">+ Add missing feature</button>
      </div>
      <div class="overlay-wrap verify-canvas" data-photo-key="${encodeURIComponent(photo.key)}">
        <img src="${photo.url}" alt="${photo.view} analysis" draggable="false" />${boxes}
      </div>
      <div class="analysis-caption"><span>${counts}</span><span>Click a box to edit it.</span></div>
    </article>`;
  }).join('');

  analysisGallery.querySelectorAll('.detect-box').forEach(box => box.addEventListener('click', async e => {
    e.preventDefault(); e.stopPropagation();
    const oldType=box.dataset.type;
    const choice=prompt(`Edit ${oldType}. Type window, door, shutter, vent, or delete:`, oldType);
    if (!choice) return;
    const value=choice.trim().toLowerCase();
    if (!['window','door','shutter','vent','delete'].includes(value)) { alert('Use window, door, shutter, vent, or delete.'); return; }
    const payload={projectId:PROJECT_ID,photoKey:decodeURIComponent(box.dataset.photoKey),type:oldType,index:Number(box.dataset.index),action:value==='delete'?'delete':'retype'};
    if(value!=='delete') payload.newType=value;
    await saveCorrection(payload);
  }));

  analysisGallery.querySelectorAll('.add-feature').forEach(btn => btn.addEventListener('click', () => {
    const wrap=btn.closest('.analysis-photo').querySelector('.verify-canvas');
    const type=prompt('What are you adding? window, door, shutter, or vent:', 'window');
    if(!type) return;
    const clean=type.trim().toLowerCase();
    if(!['window','door','shutter','vent'].includes(clean)){alert('Use window, door, shutter, or vent.');return;}
    analysisState.textContent=`Draw a box around the missing ${clean}: click and drag across the photo.`;
    beginDraw(wrap, clean, decodeURIComponent(btn.dataset.photoKey));
  }));
}

async function saveCorrection(payload){
  const res=await fetch('/api/correction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){alert(data.error||'Could not save correction.');return;}
  lastAnalysis=data.analysis; renderAnalysis(lastAnalysis);
  const t=lastAnalysis.totals||{};
  analysisState.textContent=`Verification saved: ${t.window||0} windows · ${t.door||0} doors · ${t.shutter||0} shutters · ${t.vent||0} vents.`;
}

function beginDraw(wrap,type,photoKey){
  wrap.classList.add('drawing');
  let start=null, draft=null;
  const point=e=>{const r=wrap.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  const down=e=>{if(e.target.closest('.detect-box'))return;start=point(e);draft=document.createElement('div');draft.className=`draw-box detect-${type}`;wrap.appendChild(draft);e.preventDefault();};
  const move=e=>{if(!start||!draft)return;const p=point(e),x1=Math.min(start.x,p.x),y1=Math.min(start.y,p.y),x2=Math.max(start.x,p.x),y2=Math.max(start.y,p.y);Object.assign(draft.style,{left:`${x1*100}%`,top:`${y1*100}%`,width:`${(x2-x1)*100}%`,height:`${(y2-y1)*100}%`});};
  const up=async e=>{if(!start)return;const p=point(e),box={x1:Math.min(start.x,p.x),y1:Math.min(start.y,p.y),x2:Math.max(start.x,p.x),y2:Math.max(start.y,p.y)};cleanup();if(box.x2-box.x1>.01&&box.y2-box.y1>.01)await saveCorrection({projectId:PROJECT_ID,photoKey,type,action:'add',box});};
  const cleanup=()=>{wrap.classList.remove('drawing');wrap.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);draft?.remove();};
  wrap.addEventListener('pointerdown',down);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
}

async function loadAnalysis() {
  try {
    const res = await fetch(`/api/analyze?projectId=${encodeURIComponent(PROJECT_ID)}`);
    const data = await res.json();
    if (res.ok && data.analysis) {
      lastAnalysis = data.analysis;
      renderAnalysis(lastAnalysis);
      const t = lastAnalysis.totals || {};
      analysisState.textContent = `Last detection: ${t.window || 0} windows · ${t.door || 0} doors · ${t.shutter || 0} shutters · ${t.vent || 0} vents.`;
    }
  } catch {}
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

analyze?.addEventListener('click', async () => {
  const keys = new Set(currentPhotos.map((p) => p.key));
  const views = Object.entries(projectManifest.photoViews || {})
    .filter(([key, view]) => keys.has(key) && view && view !== 'unassigned')
    .map(([, view]) => view);

  if (!currentPhotos.length) {
    analysisState.textContent = 'Upload at least one exterior photo before analysis.';
    return;
  }

  if (views.length < currentPhotos.length) {
    analysisState.textContent = `Assign viewpoints to all ${currentPhotos.length} uploaded photos before feature detection.`;
    photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (new Set(views).size < 4) {
    analysisState.textContent = 'We need at least 4 distinct viewpoints around the house for a useful first-pass analysis.';
    return;
  }

  analyze.disabled = true;
  const oldText = analyze.textContent;
  analyze.textContent = 'Analyzing…';
  analysisState.textContent = `Running real vision detection on ${currentPhotos.length} photos…`;

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Analysis failed.');

    lastAnalysis = data.analysis;
    renderAnalysis(lastAnalysis);
    const t = lastAnalysis.totals || {};
    analysisState.textContent = `Detection complete: ${t.window || 0} windows · ${t.door || 0} doors · ${t.shutter || 0} shutters · ${t.vent || 0} vents. Review the boxes below for misses and false detections.`;
  } catch (err) {
    analysisState.textContent = `Analysis error: ${err.message}`;
  } finally {
    analyze.disabled = false;
    analyze.textContent = oldText;
  }
});

newProject?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

openTestHouse?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

loadPhotos();
loadAnalysis();
