let PROJECT_ID = localStorage.getItem('solarisMeasureProjectId') || 'test-house-001';
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
let geometryData = { photos: {} };

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
  const labels = { window:'Window', door:'Door', shutter:'Shutter', vent:'Vent', outside_corner:'Outside corner', inside_corner:'Inside corner', eave:'Eave', rake:'Rake', gable:'Gable' };

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
        <div class="verify-actions"><button class="secondary zoom-feature" data-photo-key="${encodeURIComponent(photo.key)}">Zoom / Edit</button><button class="secondary add-feature" data-photo-key="${encodeURIComponent(photo.key)}">+ Add feature</button></div>
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
    if (!['window','door','shutter','vent','outside_corner','inside_corner','eave','rake','gable','delete'].includes(value)) { alert('Invalid feature type.'); return; }
    const payload={projectId:PROJECT_ID,photoKey:decodeURIComponent(box.dataset.photoKey),type:oldType,index:Number(box.dataset.index),action:value==='delete'?'delete':'retype'};
    if(value!=='delete') payload.newType=value;
    await saveCorrection(payload);
  }));

  analysisGallery.querySelectorAll('.zoom-feature').forEach(btn => btn.addEventListener('click', () => openZoomEditor(decodeURIComponent(btn.dataset.photoKey))));

  analysisGallery.querySelectorAll('.add-feature').forEach(btn => btn.addEventListener('click', () => {
    const wrap=btn.closest('.analysis-photo').querySelector('.verify-canvas');
    const type=prompt('Add: window, door, shutter, vent, outside_corner, inside_corner, eave, rake, or gable:', 'window');
    if(!type) return;
    const clean=type.trim().toLowerCase();
    if(!['window','door','shutter','vent','outside_corner','inside_corner','eave','rake','gable'].includes(clean)){alert('Invalid feature type.');return;}
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

function openZoomEditor(photoKey){
  const photo=lastAnalysis?.photos?.find(p=>p.key===photoKey); if(!photo)return;
  const modal=document.createElement('div'); modal.className='zoom-modal';
  modal.innerHTML='<div class="zoom-panel"><div class="zoom-head"><strong>'+photo.view+' · Verification Editor</strong><div class="zoom-controls"><button data-add>+ Add</button><button data-z="out">−</button><button data-z="reset">100%</button><button data-z="in">+</button><button data-close>Close</button></div></div><div class="zoom-viewport"><div class="zoom-stage"><img src="'+photo.url+'" draggable="false"></div></div><div class="zoom-help">Zoom and pan normally. Click a colored box to change or delete it. Click + Add, choose a type, then drag a box directly on the zoomed image.</div></div>';
  document.body.appendChild(modal);
  const viewport=modal.querySelector('.zoom-viewport'),stage=modal.querySelector('.zoom-stage');
  let scale=1,tx=0,ty=0,drag=false,lastX=0,lastY=0,addType=null,startPoint=null,draft=null;
  const allowed=['window','door','shutter','vent','outside_corner','inside_corner','eave','rake','gable'];
  const apply=()=>{stage.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';modal.querySelector('[data-z="reset"]').textContent=Math.round(scale*100)+'%';};
  const stagePoint=e=>{const r=stage.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  Object.entries(photo.detections||{}).forEach(([type,list])=>(list||[]).forEach((b,index)=>{
    const el=document.createElement('button');el.className='zoom-detect detect-'+type;
    el.style.left=pct(b.x1)+'%';el.style.top=pct(b.y1)+'%';el.style.width=(pct(b.x2)-pct(b.x1))+'%';el.style.height=(pct(b.y2)-pct(b.y1))+'%';el.textContent=type.replaceAll('_',' ');
    el.onclick=async e=>{e.stopPropagation();const choice=prompt('Edit '+type+'. Enter a feature type or delete:',type);if(!choice)return;const v=choice.trim().toLowerCase();if(![...allowed,'delete'].includes(v)){alert('Invalid feature type.');return;}const payload={projectId:PROJECT_ID,photoKey,type,index,action:v==='delete'?'delete':'retype'};if(v!=='delete')payload.newType=v;await saveCorrection(payload);modal.remove();openZoomEditor(photoKey);};stage.appendChild(el);
  }));
  modal.querySelector('[data-add]').onclick=()=>{
    const choice=prompt('Add: window, door, shutter, vent, outside_corner, inside_corner, eave, rake, or gable:','window');if(!choice)return;
    const v=choice.trim().toLowerCase();if(!allowed.includes(v)){alert('Invalid feature type.');return;}
    addType=v;viewport.classList.add('adding');modal.querySelector('.zoom-help').textContent='Draw a box around the '+v.replaceAll('_',' ')+'. Click and drag on the image.';
  };
  modal.querySelector('[data-close]').onclick=()=>{window.removeEventListener('resize',syncSvg);modal.remove();};
  modal.querySelector('[data-z="in"]').onclick=()=>{scale=Math.min(5,scale+.35);apply();};
  modal.querySelector('[data-z="out"]').onclick=()=>{scale=Math.max(1,scale-.35);if(scale===1){tx=0;ty=0;}apply();};
  modal.querySelector('[data-z="reset"]').onclick=()=>{scale=1;tx=0;ty=0;apply();};
  viewport.addEventListener('wheel',e=>{e.preventDefault();if(addType)return;scale=Math.max(1,Math.min(5,scale+(e.deltaY<0?.25:-.25)));if(scale===1){tx=0;ty=0;}apply();},{passive:false});
  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('.zoom-detect'))return;
    if(addType){startPoint=stagePoint(e);draft=document.createElement('div');draft.className='draw-box detect-'+addType;stage.appendChild(draft);viewport.setPointerCapture(e.pointerId);e.preventDefault();return;}
    drag=true;lastX=e.clientX;lastY=e.clientY;viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove',e=>{
    if(addType&&startPoint&&draft){const p=stagePoint(e),x1=Math.min(startPoint.x,p.x),y1=Math.min(startPoint.y,p.y),x2=Math.max(startPoint.x,p.x),y2=Math.max(startPoint.y,p.y);Object.assign(draft.style,{left:(x1*100)+'%',top:(y1*100)+'%',width:((x2-x1)*100)+'%',height:((y2-y1)*100)+'%'});return;}
    if(!drag||scale===1)return;tx+=e.clientX-lastX;ty+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;apply();
  });
  viewport.addEventListener('pointerup',async e=>{
    if(addType&&startPoint){const p=stagePoint(e),box={x1:Math.min(startPoint.x,p.x),y1:Math.min(startPoint.y,p.y),x2:Math.max(startPoint.x,p.x),y2:Math.max(startPoint.y,p.y)},type=addType;draft?.remove();draft=null;startPoint=null;addType=null;viewport.classList.remove('adding');if(box.x2-box.x1>.003&&box.y2-box.y1>.003){await saveCorrection({projectId:PROJECT_ID,photoKey,type,action:'add',box});modal.remove();openZoomEditor(photoKey);}return;}drag=false;
  });
  apply();
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

newProject?.addEventListener('click', async () => {
  const suggested='measure-'+new Date().toISOString().slice(0,10)+'-'+Math.random().toString(36).slice(2,6);
  const name=prompt('New measurement name or address:', suggested);
  if(!name)return;
  const slug=String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||suggested;
  PROJECT_ID=slug+'-'+Date.now().toString(36);
  localStorage.setItem('solarisMeasureProjectId',PROJECT_ID);
  projectManifest={photoViews:{}};currentPhotos=[];lastAnalysis=null;geometryData={photos:{}};
  gallery.innerHTML='';analysisGallery.innerHTML='';
  uploadStatus.textContent='New measurement ready: '+name+'. Upload 15–25 overlapping exterior photos.';
  analysisState.textContent='No analysis has been run for this measurement.';
  document.querySelector('#process-results').innerHTML='';
  document.querySelector('#house-model-results').innerHTML='';
  document.querySelector('#process-state').textContent='Upload and classify the new photo set, then Process Property.';
  document.querySelector('#house-model-state').textContent='Waiting for the new property to be processed.';
  const ps=document.querySelector('#pixel-match-state');if(ps)ps.textContent='Pixel geometry: waiting for measurement model.';
  photosCard.scrollIntoView({behavior:'smooth',block:'start'});
});

openTestHouse?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

async function preserveVerified(){
  const state=document.querySelector('#geometry-state');
  const btn=document.querySelector('#preserve-verified');
  if(state) state.textContent='Preserving verified objects…';
  if(btn) btn.disabled=true;
  try{
    const res=await fetch('/api/verified',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
    const raw=await res.text();
    let d={};
    try{d=raw?JSON.parse(raw):{};}catch{throw new Error('Server returned an unreadable response (HTTP '+res.status+').');}
    if(!res.ok)throw new Error(d.error||'Could not preserve verified objects.');
    if(state) state.textContent='✓ Verified object layer preserved. You can now run Auto Reconstruction.';
    if(btn) btn.textContent='✓ Verified Objects Preserved';
    return true;
  }catch(err){
    console.error('Preserve verified objects',err);
    if(state) state.textContent='Preserve error: '+(err?.message||String(err));
    alert('Preserve verified objects failed: '+(err?.message||String(err)));
    return false;
  }finally{
    if(btn) btn.disabled=false;
  }
}
async function loadGeometry(){
  const res=await fetch('/api/geometry?projectId='+encodeURIComponent(PROJECT_ID));const d=await res.json().catch(()=>({}));
  if(res.ok)geometryData=d.geometry||{photos:{}};renderGeometry();
}
function renderGeometry(){
  const root=document.querySelector('#geometry-gallery');if(!root||!lastAnalysis)return;
  root.innerHTML=lastAnalysis.photos.map(p=>{
    const shapes=geometryData.photos?.[p.key]||[];
    const svg=shapes.map(s=>{const pts=s.points.map(q=>(q.x*100)+','+(q.y*100)).join(' ');const tag=(s.type==='wall'||s.type==='gable')?'polygon':'polyline';return '<'+tag+' class="geo-shape geo-'+s.type+'" points="'+pts+'" vector-effect="non-scaling-stroke" data-shape="'+s.id+'" data-photo="'+encodeURIComponent(p.key)+'"></'+tag+'>';}).join('');
    return '<article class="analysis-photo"><div class="verify-toolbar"><strong>'+p.view+'</strong><div class="verify-actions"><button class="secondary geo-draw" data-key="'+encodeURIComponent(p.key)+'">Draw geometry</button><button class="secondary geo-delete-last" data-key="'+encodeURIComponent(p.key)+'" '+(shapes.length?'':'disabled')+'>Delete last</button><button class="secondary geo-clear" data-key="'+encodeURIComponent(p.key)+'" '+(shapes.length?'':'disabled')+'>Clear drawing</button></div></div><div class="geo-wrap"><img src="'+p.url+'"><svg viewBox="0 0 100 100" preserveAspectRatio="none">'+svg+'</svg></div><div class="analysis-caption"><span>'+shapes.length+' geometry shapes</span><span>Click any saved line/polygon to delete it.</span></div></article>';
  }).join('');
  root.querySelectorAll('.geo-draw').forEach(b=>b.onclick=()=>openGeometryEditor(decodeURIComponent(b.dataset.key)));
  const deleteShape=async(photoKey,shapeId)=>{const res=await fetch('/api/geometry',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,photoKey,shapeId})});const d=await res.json().catch(()=>({}));if(!res.ok){alert(d.error||'Could not delete drawing.');return;}geometryData=d.geometry;renderGeometry();};
  root.querySelectorAll('.geo-delete-last').forEach(b=>b.onclick=async()=>{const key=decodeURIComponent(b.dataset.key),shapes=geometryData.photos?.[key]||[];if(!shapes.length)return;if(confirm('Delete the most recently saved drawing on this photo?'))await deleteShape(key,shapes[shapes.length-1].id);});
  root.querySelectorAll('.geo-clear').forEach(b=>b.onclick=async()=>{const key=decodeURIComponent(b.dataset.key),shapes=[...(geometryData.photos?.[key]||[])];if(!shapes.length||!confirm('Delete ALL saved geometry drawings on this photo?'))return;for(const shape of shapes)await deleteShape(key,shape.id);});
  root.querySelectorAll('.geo-shape').forEach(s=>s.onclick=async()=>{if(!confirm('Delete this '+s.classList[1].replace('geo-','').replace('_',' ')+'?'))return;const res=await fetch('/api/geometry',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,photoKey:decodeURIComponent(s.dataset.photo),shapeId:s.dataset.shape})});const d=await res.json();geometryData=d.geometry;renderGeometry();});
}
function openGeometryEditor(photoKey){
  const p=lastAnalysis.photos.find(x=>x.key===photoKey);if(!p)return;
  const type=prompt('Geometry type: wall, gable, outside_corner, inside_corner, eave, rake, ridge, or valley:','wall');if(!type)return;
  const clean=type.trim().toLowerCase(),allowed=['wall','gable','outside_corner','inside_corner','eave','rake','ridge','valley'];if(!allowed.includes(clean)){alert('Invalid geometry type.');return;}
  const polygon=clean==='wall'||clean==='gable',modal=document.createElement('div');modal.className='zoom-modal';
  modal.innerHTML='<div class="zoom-panel"><div class="zoom-head"><strong>'+p.view+' · Draw '+clean.replace('_',' ')+'</strong><div class="zoom-controls"><button data-save>Save</button><button data-undo>Undo</button><button data-close>Cancel</button></div></div><div class="geo-editor"><img src="'+p.url+'" draggable="false"><svg viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div><div class="zoom-help">'+(polygon?'Click each corner of the area. Use at least 3 points, then Save.':'Click the start and end points. Add more points if the edge bends, then Save.')+'</div></div>';
  document.body.appendChild(modal);const ed=modal.querySelector('.geo-editor'),svg=ed.querySelector('svg'),editorImg=ed.querySelector('img');let pts=[];
  const syncSvg=()=>{const r=editorImg.getBoundingClientRect(),er=ed.getBoundingClientRect();Object.assign(svg.style,{left:(r.left-er.left)+'px',top:(r.top-er.top)+'px',width:r.width+'px',height:r.height+'px'});}; const redraw=()=>{syncSvg();svg.innerHTML=pts.map(q=>'<circle cx="'+q.x*100+'" cy="'+q.y*100+'" r=".8"></circle>').join('')+(pts.length>1?'<'+(polygon?'polygon':'polyline')+' points="'+pts.map(q=>q.x*100+','+q.y*100).join(' ')+'"></'+(polygon?'polygon':'polyline')+'>':'');}; editorImg.addEventListener('load',syncSvg);window.addEventListener('resize',syncSvg);setTimeout(syncSvg,0);
  ed.onclick=e=>{const r=editorImg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;pts.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});redraw();};
  modal.querySelector('[data-undo]').onclick=()=>{pts.pop();redraw();};modal.querySelector('[data-close]').onclick=()=>modal.remove();
  modal.querySelector('[data-save]').onclick=async()=>{if(pts.length<(polygon?3:2)){alert('Add more points first.');return;}const res=await fetch('/api/geometry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,photoKey,type:clean,points:pts})});const d=await res.json().catch(()=>({}));if(!res.ok){alert(d.error||'Could not save geometry.');return;}geometryData=d.geometry;window.removeEventListener('resize',syncSvg);modal.remove();renderGeometry();document.querySelector('#geometry-state').textContent='Geometry saved separately from verified object detections.';};
}
document.querySelector('#preserve-verified')?.addEventListener('click',preserveVerified);

loadPhotos();
loadAnalysis().then?.(()=>{});
setTimeout(loadGeometry,800);

async function buildMatching(){
  const state=document.querySelector('#matching-state'),summary=document.querySelector('#matching-summary'),cal=document.querySelector('#calibration-panel');
  state.textContent='Building cross-photo matching workspace…';
  const res=await fetch('/api/matching',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
  const d=await res.json().catch(()=>({}));if(!res.ok){state.textContent=d.error||'Could not build matching map.';return;}
  const m=d.matching,wallCount=m.photos.reduce((n,p)=>n+p.walls.length,0),gableCount=m.photos.reduce((n,p)=>n+p.gables.length,0),edgeCount=m.photos.reduce((n,p)=>n+p.edges.length,0);
  state.textContent='Matching workspace built from '+m.photos.length+' traced photos. Candidate overlap pairs are ready for review.';
  summary.innerHTML='<div class="metric"><span>Traced views</span><strong>'+m.photos.length+'</strong></div><div class="metric"><span>Wall planes</span><strong>'+wallCount+'</strong></div><div class="metric"><span>Gables</span><strong>'+gableCount+'</strong></div><div class="metric"><span>Edges</span><strong>'+edgeCount+'</strong></div><div class="metric"><span>Overlap pairs</span><strong>'+m.candidatePairs.length+'</strong></div>';
  cal.textContent='Next: calibration required. We need one known real-world length on a traced wall plane before converting image geometry into feet and square feet.';
}
document.querySelector('#build-matching')?.addEventListener('click',buildMatching);

function openCalibration(){
 if(!lastAnalysis?.photos?.length){alert('Load the project photos first.');return;}
 const p=lastAnalysis.photos[0],modal=document.createElement('div');modal.className='zoom-modal';
 modal.innerHTML='<div class="zoom-panel"><div class="zoom-head"><strong>Calibration · '+p.view+'</strong><div class="zoom-controls"><button data-save>Save length</button><button data-close>Cancel</button></div></div><div class="geo-editor cal-editor"><img src="'+p.url+'" draggable="false"><svg viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div><div class="zoom-help">Click the two endpoints of one known dimension on this photo. Then enter its real length in feet.</div></div>';
 document.body.appendChild(modal);const ed=modal.querySelector('.cal-editor'),img=ed.querySelector('img'),svg=ed.querySelector('svg');let pts=[];
 const sync=()=>{const r=img.getBoundingClientRect(),er=ed.getBoundingClientRect();Object.assign(svg.style,{left:(r.left-er.left)+'px',top:(r.top-er.top)+'px',width:r.width+'px',height:r.height+'px'});};
 const draw=()=>{sync();svg.innerHTML=pts.map(q=>'<circle cx="'+q.x*100+'" cy="'+q.y*100+'" r=".9"></circle>').join('')+(pts.length===2?'<polyline points="'+pts.map(q=>q.x*100+','+q.y*100).join(' ')+'"></polyline>':'');};
 img.addEventListener('load',sync);setTimeout(sync,0);ed.onclick=e=>{const r=img.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;if(pts.length===2)pts=[];pts.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});draw();};
 modal.querySelector('[data-close]').onclick=()=>modal.remove();
 modal.querySelector('[data-save]').onclick=async()=>{if(pts.length!==2){alert('Click exactly two endpoints first.');return;}const feetRaw=prompt('Known length — feet (example: 16):','0');if(feetRaw===null)return;const inchesRaw=prompt('Additional inches (0–11, decimals allowed):','0');if(inchesRaw===null)return;const wholeFeet=Number(feetRaw),inches=Number(inchesRaw);if(!Number.isFinite(wholeFeet)||wholeFeet<0||!Number.isFinite(inches)||inches<0||inches>=12||(wholeFeet===0&&inches===0)){alert('Enter a valid length, for example 16 ft 6 in.');return;}const feet=wholeFeet+(inches/12);const res=await fetch('/api/calibration',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,photoKey:p.key,p1:pts[0],p2:pts[1],feet,feetInput:wholeFeet,inchesInput:inches})});const d=await res.json().catch(()=>({}));if(!res.ok){alert(d.error||'Could not save calibration.');return;}document.querySelector('#calibration-panel').textContent='Calibration saved: '+wholeFeet+' ft '+inches+' in reference on '+p.view+'. Next we can solve measurements on this wall plane.';modal.remove();};
}
document.querySelector('#add-calibration')?.addEventListener('click',openCalibration);

async function measureCalibratedView(){const out=document.querySelector('#measurement-result');out.textContent='Calculating perspective-corrected measurement…';const r=await fetch('/api/measure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});const d=await r.json().catch(()=>({}));if(!r.ok){out.textContent=d.error||'Measurement failed.';return;}const m=d.measurement,delta=m.grossWallArea-445;out.innerHTML='<strong>'+m.view+' perspective-corrected: '+m.grossWallArea.toFixed(1)+' ft²</strong><br>Hover benchmark front: 445 ft² · Difference: '+(delta>=0?'+':'')+delta.toFixed(1)+' ft² ('+(m.errorPct>=0?'+':'')+m.errorPct.toFixed(1)+'%)<br><span class="muted">Planar perspective correction applied. Only wall planes coplanar with the reference rectangle are metrically valid.</span>';}
function bindMeasureButton(){
 const btn=document.querySelector('#measure-front');
 if(!btn)return;
 btn.onclick=async(e)=>{
   e.preventDefault();
   const out=document.querySelector('#measurement-result');
   if(out) out.textContent='Calculating calibrated baseline…';
   btn.disabled=true;
   try{await measureCalibratedView();}
   catch(err){console.error(err);if(out)out.textContent='Measurement error: '+(err?.message||String(err));}
   finally{btn.disabled=false;}
 };
}
bindMeasureButton();

function openPerspectiveCalibration(){
 if(!lastAnalysis?.photos?.length){alert('Load the project photos first.');return;}
 const p=lastAnalysis.photos[0],modal=document.createElement('div');modal.className='zoom-modal';
 modal.innerHTML='<div class="zoom-panel"><div class="zoom-head"><strong>Perspective calibration · '+p.view+'</strong><div class="zoom-controls"><button data-save>Save rectangle</button><button data-undo>Undo</button><button data-close>Cancel</button></div></div><div class="geo-editor cal-editor"><img src="'+p.url+'" draggable="false"><svg viewBox="0 0 100 100" preserveAspectRatio="none"></svg></div><div class="zoom-help">Click the 4 corners of a known rectangle on ONE wall plane in this order: top-left, top-right, bottom-right, bottom-left. A garage door is ideal. Then enter its exact width and height.</div></div>';
 document.body.appendChild(modal);const ed=modal.querySelector('.cal-editor'),img=ed.querySelector('img'),svg=ed.querySelector('svg');let pts=[];
 const sync=()=>{const r=img.getBoundingClientRect(),er=ed.getBoundingClientRect();Object.assign(svg.style,{left:(r.left-er.left)+'px',top:(r.top-er.top)+'px',width:r.width+'px',height:r.height+'px'});};
 const draw=()=>{sync();svg.innerHTML=pts.map((q,i)=>'<circle cx="'+q.x*100+'" cy="'+q.y*100+'" r=".9"></circle><text x="'+(q.x*100+1)+'" y="'+(q.y*100-1)+'">'+(i+1)+'</text>').join('')+(pts.length>1?'<polyline points="'+pts.map(q=>q.x*100+','+q.y*100).join(' ')+'"></polyline>':'');};
 img.addEventListener('load',sync);setTimeout(sync,0);ed.onclick=e=>{const r=img.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom||pts.length>=4)return;pts.push({x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});draw();};
 modal.querySelector('[data-undo]').onclick=()=>{pts.pop();draw();};modal.querySelector('[data-close]').onclick=()=>modal.remove();
 modal.querySelector('[data-save]').onclick=async()=>{if(pts.length!==4){alert('Click all four rectangle corners first.');return;}const wf=Number(prompt('Rectangle width — feet:','16')),wi=Number(prompt('Additional width inches:','0')),hf=Number(prompt('Rectangle height — feet:','7')),hi=Number(prompt('Additional height inches:','0'));if(![wf,wi,hf,hi].every(Number.isFinite)||wf<0||hf<0||wi<0||wi>=12||hi<0||hi>=12){alert('Enter valid feet and inches.');return;}const widthFt=wf+wi/12,heightFt=hf+hi/12;if(widthFt<=0||heightFt<=0)return;const res=await fetch('/api/calibration',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,photoKey:p.key,p1:pts[0],p2:pts[1],feet:widthFt,rectPoints:pts,widthFt,heightFt})});const d=await res.json().catch(()=>({}));if(!res.ok){alert(d.error||'Could not save perspective calibration.');return;}document.querySelector('#calibration-panel').textContent='Perspective rectangle saved: '+wf+' ft '+wi+' in × '+hf+' ft '+hi+' in on '+p.view+'.';modal.remove();};
}
document.querySelector('#add-perspective')?.addEventListener('click',openPerspectiveCalibration);

async function runAutoMeasure(){
 const btn=document.querySelector('#auto-measure'),state=document.querySelector('#auto-measure-state'),root=document.querySelector('#auto-measure-results');
 if(!btn||!state||!root)return;
 btn.disabled=true;state.textContent='Building reconstruction workspace from saved viewpoints, geometry and verified objects…';root.innerHTML='<p class="muted">Working…</p>';
 try{
  const r=await fetch('/api/auto-measure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{throw Error('Server returned an unreadable response (HTTP '+r.status+').');}
  if(!r.ok)throw Error(d.error||('Auto Measure failed (HTTP '+r.status+').'));
  if(!d.result||!d.result.elevations)throw Error('Auto Measure returned no elevation results.');
  const x=d.result,n=v=>Number.isFinite(Number(v))?Number(v).toFixed(1):'—';
  const row=(name,o={})=>'<tr><td>'+name+'</td><td>'+n(o.areaFt2)+' ft²</td><td>'+n(o.benchmark)+' ft²</td><td>'+n(o.differenceFt2)+' ft²</td><td>'+n(o.errorPct)+'%</td><td>'+(o.sourceView||o.status||'—')+'</td></tr>';
  root.innerHTML='<table><thead><tr><th>Elevation</th><th>Solaris</th><th>Hover benchmark</th><th>Difference</th><th>Error</th><th>Source</th></tr></thead><tbody>'+row('Front',x.elevations.front)+row('Right',x.elevations.right)+row('Left',x.elevations.left)+row('Rear',x.elevations.rear)+'<tr><th>Whole house</th><th>'+n(x.totalAreaFt2)+' ft²</th><th>1,666.0 ft²</th><th>'+n(x.totalDifferenceFt2)+' ft²</th><th>'+n(x.totalErrorPct)+'%</th><th>'+(x.complete?'4 elevations':'partial')+'</th></tr></tbody></table>';
  state.textContent='Reconstruction diagnostic complete. Hover values are validation only; this output is not yet production-ready for ordering.';
 }catch(e){
  console.error('Auto Measure',e);state.textContent='Auto Measure error: '+(e?.message||String(e));root.innerHTML='<div class="analysis-state"><strong>Could not calculate results.</strong><br>'+(e?.message||String(e))+'</div>';
 }finally{btn.disabled=false;}
}
function bindAutoMeasure(){const btn=document.querySelector('#auto-measure');if(btn)btn.onclick=e=>{e.preventDefault();runAutoMeasure();};}
bindAutoMeasure();


function canonicalElevation(view){
  if(view==='front'||view==='front-left'||view==='front-right')return 'front';
  if(view==='rear'||view==='rear-left'||view==='rear-right')return 'rear';
  if(view==='left')return 'left';
  if(view==='right')return 'right';
  return null;
}
async function checkReconstructionReadiness(){
  const state=document.querySelector('#readiness-state'),root=document.querySelector('#readiness-results'),btn=document.querySelector('#check-readiness');
  if(!state||!root)return;
  if(btn)btn.disabled=true;state.textContent='Analyzing coverage and candidate overlaps…';
  try{
    const r=await fetch('/api/readiness',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Coverage analysis failed.');
    const x=d.readiness,names=['front','right','rear','left'],badge=s=>s==='good'?'✓ Good':s==='limited'?'△ Limited':'✕ Missing';
    root.innerHTML='<table><thead><tr><th>Elevation</th><th>Coverage</th><th>Score</th><th>Usable views</th><th>Wall planes</th><th>Next capture</th></tr></thead><tbody>'+names.map(name=>{const o=x.elevations[name];return '<tr><td>'+name[0].toUpperCase()+name.slice(1)+'</td><td><strong>'+badge(o.status)+'</strong></td><td>'+o.score+'/100</td><td>'+o.usableViews+'</td><td>'+o.wallPlanes+'</td><td>'+o.recommendation+'</td></tr>';}).join('')+'</tbody></table><div class="analysis-state">'+x.summary.candidatePairs+' overlapping photo pair'+(x.summary.candidatePairs===1?'':'s')+' identified for the next reconstruction stage.</div>';
    state.textContent=x.summary.missing?x.summary.missing+' elevation'+(x.summary.missing===1?' is':'s are')+' missing. The system will not treat the house as complete.':x.summary.limited?x.summary.good+' good · '+x.summary.limited+' limited. Additional capture is recommended before ordering-grade measurements.':'All four elevations have sufficient capture coverage.';
  }catch(e){state.textContent='Coverage analysis error: '+(e?.message||String(e));}
  finally{if(btn)btn.disabled=false;}
}
document.querySelector('#check-readiness')?.addEventListener('click',checkReconstructionReadiness);

async function runFeatureMatching(){
 const btn=document.querySelector('#run-feature-matching'),state=document.querySelector('#feature-match-state'),root=document.querySelector('#feature-match-results');
 if(!btn||!state||!root){alert('Feature matching controls did not load correctly.');return;}
 btn.disabled=true;btn.textContent='Matching…';state.textContent='Matching repeated exterior features across candidate photo pairs…';root.innerHTML='<div class="analysis-state">Working on saved overlap pairs…</div>';
 try{
  const r=await fetch('/api/feature-matching',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{};}catch{throw Error('Server returned an unreadable response (HTTP '+r.status+').');}
  if(!r.ok)throw Error(d.error||('Feature matching failed (HTTP '+r.status+').'));
  if(!d.featureMatching||!Array.isArray(d.featureMatching.results))throw Error('Feature matching returned no pair results.');
  const x=d.featureMatching,s=x.summary||{usable:0,weak:0,insufficient:0,total:x.results.length};
  root.innerHTML='<table><thead><tr><th>Photo pair</th><th>Object matches</th><th>Strong</th><th>Score</th><th>Status</th></tr></thead><tbody>'+x.results.map(p=>'<tr><td>'+p.viewA+' ↔ '+p.viewB+'</td><td>'+((p.matches||[]).length)+'</td><td>'+(p.strongMatches||0)+'</td><td>'+(p.score||0)+'/100</td><td><strong>'+p.status+'</strong></td></tr>').join('')+'</tbody></table>';
  state.textContent=s.usable+' usable · '+s.weak+' weak · '+s.insufficient+' insufficient out of '+s.total+' candidate pairs.';
 }catch(e){
  console.error('Feature matching',e);state.textContent='Feature matching error: '+(e?.message||String(e));root.innerHTML='<div class="analysis-state"><strong>Could not match photos.</strong><br>'+(e?.message||String(e))+'</div>';alert('Feature matching failed: '+(e?.message||String(e)));
 }finally{btn.disabled=false;btn.textContent='Match Overlapping Photos';}
}
function bindFeatureMatching(){const btn=document.querySelector('#run-feature-matching');if(btn)btn.onclick=e=>{e.preventDefault();runFeatureMatching();};}
bindFeatureMatching();

async function processProperty(){
 const btn=document.querySelector('#process-property'),state=document.querySelector('#process-state'),root=document.querySelector('#process-results');if(!btn||!state||!root)return;
 btn.disabled=true;btn.textContent='Processing…';state.textContent='Checking coverage, matching views and building the house reconstruction workspace…';root.innerHTML='<div class="analysis-state">Processing property…</div>';
 try{const r=await fetch('/api/process-property',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{throw Error('Unreadable server response (HTTP '+r.status+').')}if(!r.ok)throw Error(d.error||'Property processing failed.');
 const x=d.pipeline,names=['front','right','rear','left'],label=s=>s==='good'?'✓ Good':s==='limited'?'△ Limited':'✕ Missing';
 root.innerHTML='<div class="metrics"><div class="metric"><span>Reconstruction confidence</span><strong>'+x.confidence+'%</strong></div><div class="metric"><span>Candidate overlaps</span><strong>'+x.matching.candidatePairs+'</strong></div><div class="metric"><span>Usable matches</span><strong>'+x.matching.usable+'</strong></div><div class="metric"><span>Pipeline status</span><strong>'+x.status.replaceAll('-',' ')+'</strong></div></div><table><thead><tr><th>Elevation</th><th>Coverage</th><th>Score</th><th>Views</th><th>Wall planes</th><th>Action</th></tr></thead><tbody>'+names.map(n=>{const e=x.elevations[n];return '<tr><td>'+n[0].toUpperCase()+n.slice(1)+'</td><td><strong>'+label(e.status)+'</strong></td><td>'+e.score+'/100</td><td>'+e.usableViews+'</td><td>'+e.wallPlanes+'</td><td>'+e.recommendation+'</td></tr>'}).join('')+'</tbody></table>';
 state.textContent=x.status==='reconstruction-ready'?'Automated pre-reconstruction passed. The next engine can solve shared geometry from the usable cross-photo network.':x.status==='incomplete'?'Property is incomplete. Missing elevations are clearly flagged instead of generating fake measurements.':'More overlapping imagery is recommended before metric reconstruction.';
 }catch(e){state.textContent='Process Property error: '+(e?.message||String(e));root.innerHTML='<div class="analysis-state">'+(e?.message||String(e))+'</div>';}finally{btn.disabled=false;btn.textContent='Process Property';}
}
document.querySelector('#process-property')?.addEventListener('click',e=>{e.preventDefault();processProperty();});


async function buildHouseModel(){
 const btn=document.querySelector('#build-house-model');
 const state=document.querySelector('#house-model-state');
 const root=document.querySelector('#house-model-results');
 if(!btn||!state||!root)return;
 btn.disabled=true; btn.textContent='Building...';
 state.textContent='Building house model, estimating scale, and calculating siding preview...';
 try{
  async function post(url,extra){
   const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({projectId:PROJECT_ID},extra||{}))});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(d.error||'Request failed');
   return d;
  }
  let px=null;
  try{px=await runPixelGeometryWorker();}catch(pixelError){const ps=document.querySelector('#pixel-match-state');if(ps)ps.textContent='Pixel geometry paused: '+(pixelError.message||String(pixelError));}
  const hm=(await post('/api/house-model')).houseModel;
  const sc=(await post('/api/metric-scale')).scale;
  if(!sc.feetPerNormalized){state.textContent='House model built, but automatic metric scale is still unsolved.';root.innerHTML='<div class="analysis-state">No usable automatic scale candidate was found.</div>';return;}
  const t=(await post('/api/takeoff-preview',{waste:0.10})).takeoff;
  const names=['front','right','rear','left'];
  root.innerHTML='<div class="metrics"><div class="metric"><span>Model confidence</span><strong>'+hm.confidence+'%</strong></div><div class="metric"><span>Scale confidence</span><strong>'+sc.confidence+'%</strong></div><div class="metric"><span>Net siding preview</span><strong>'+t.totals.netFt2+' ft²</strong></div><div class="metric"><span>+10% preview</span><strong>'+t.totals.orderFt2+' ft²</strong></div></div><table><thead><tr><th>Elevation</th><th>Gross ft²</th><th>Openings ft²</th><th>Net ft²</th><th>+10%</th></tr></thead><tbody>'+names.map(function(n){var e=t.elevations[n]||{};return '<tr><td>'+n.charAt(0).toUpperCase()+n.slice(1)+'</td><td>'+(e.grossFt2==null?'—':e.grossFt2)+'</td><td>'+(e.openingsFt2==null?'—':e.openingsFt2)+'</td><td>'+(e.netFt2==null?'—':e.netFt2)+'</td><td>'+(e.orderFt2==null?'—':e.orderFt2)+'</td></tr>';}).join('')+'</tbody></table><div class="analysis-state"><strong>Preview only.</strong> '+t.warning+'</div>';
  state.textContent='Automatic measurement preview complete: '+t.totals.squares+' siding squares with 10% waste.';
 }catch(e){state.textContent='Measurement model error: '+(e.message||String(e));root.innerHTML='<div class="analysis-state">'+(e.message||String(e))+'</div>';}
 finally{btn.disabled=false;btn.textContent='Build Measurement Model';}
}
document.querySelector('#build-house-model')?.addEventListener('click',function(e){e.preventDefault();buildHouseModel();});

function waitForCv(ms=20000){return new Promise((resolve,reject)=>{const start=Date.now(),tick=()=>{if(window.cv&&cv.Mat){resolve(cv);return}if(Date.now()-start>ms){reject(new Error('OpenCV did not load'));return}setTimeout(tick,200)};tick()})}
async function loadMatchImage(key){
 const img=new Image();img.crossOrigin='anonymous';img.src='/api/photo?key='+encodeURIComponent(key);await img.decode();
 const max=640,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas;
}
async function pixelMatchPair(pair){
 await waitForCv();const [ca,cb]=await Promise.all([loadMatchImage(pair.a),loadMatchImage(pair.b)]);let a=cv.imread(ca),b=cv.imread(cb),ga=new cv.Mat(),gb=new cv.Mat(),ka=new cv.KeyPointVector(),kb=new cv.KeyPointVector(),da=new cv.Mat(),db=new cv.Mat(),mask=new cv.Mat(),orb=new cv.ORB(700);
 try{cv.cvtColor(a,ga,cv.COLOR_RGBA2GRAY);cv.cvtColor(b,gb,cv.COLOR_RGBA2GRAY);orb.detectAndCompute(ga,mask,ka,da);orb.detectAndCompute(gb,mask,kb,db);if(da.empty()||db.empty())return {...pair,keypointsA:ka.size(),keypointsB:kb.size(),rawMatches:0,goodMatches:0,inliers:0,inlierRatio:0,status:'insufficient'};
  let matcher=new cv.BFMatcher(cv.NORM_HAMMING,false),knn=new cv.DMatchVectorVector();matcher.knnMatch(da,db,knn,2);let ptsA=[],ptsB=[],good=0;
  for(let i=0;i<knn.size();i++){let v=knn.get(i);if(v.size()>=2){let m=v.get(0),n=v.get(1);if(m.distance<0.72*n.distance){let p=ka.get(m.queryIdx).pt,q=kb.get(m.trainIdx).pt;ptsA.push(p.x,p.y);ptsB.push(q.x,q.y);good++}}v.delete()}
  let inliers=0;if(good>=8){let ma=cv.matFromArray(good,1,cv.CV_32FC2,ptsA),mb=cv.matFromArray(good,1,cv.CV_32FC2,ptsB),rm=new cv.Mat();let F=cv.findFundamentalMat(ma,mb,cv.FM_RANSAC,2.0,0.99,rm);for(let i=0;i<rm.rows;i++)if(rm.ucharPtr(i,0)[0])inliers++;ma.delete();mb.delete();rm.delete();F.delete()}
  knn.delete();matcher.delete();const ratio=good?inliers/good:0,status=inliers>=35&&ratio>=.35?'usable':inliers>=15&&ratio>=.2?'weak':'insufficient';return {...pair,keypointsA:ka.size(),keypointsB:kb.size(),rawMatches:knn.size?0:0,goodMatches:good,inliers,inlierRatio:+ratio.toFixed(3),status};
 }finally{a.delete();b.delete();ga.delete();gb.delete();ka.delete();kb.delete();da.delete();db.delete();mask.delete();orb.delete()}
}
async function runPixelGeometry(){
 const state=document.querySelector('#pixel-match-state');if(state)state.textContent='Pixel geometry: loading OpenCV and matching overlapping photos...';
 const r=await fetch('/api/process-property?projectId='+encodeURIComponent(PROJECT_ID)),d=await r.json();const pairs=d.pipeline?.matching?.results||[];if(!pairs.length)throw new Error('No candidate overlap pairs found.');
 const out=[];for(let i=0;i<pairs.length;i++){if(state)state.textContent='Pixel geometry: pair '+(i+1)+' of '+pairs.length+'...';await new Promise(function(resolve){setTimeout(resolve,40)});out.push(await pixelMatchPair(pairs[i]));await new Promise(function(resolve){setTimeout(resolve,40)});}
 const save=await fetch('/api/pixel-matches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,pairs:out})}),sd=await save.json();if(!save.ok)throw new Error(sd.error||'Could not save pixel matches');if(state)state.textContent='Pixel geometry: '+sd.pixelMatches.summary.usable+' usable, '+sd.pixelMatches.summary.weak+' weak of '+sd.pixelMatches.summary.pairs+' overlap pairs.';return sd.pixelMatches;
}

async function runPixelGeometryWorker(){
 const state=document.querySelector('#pixel-match-state');if(state)state.textContent='Pixel geometry: starting background worker...';
 if(!window.Worker)throw new Error('Web Worker unavailable');
 const r=await fetch('/api/process-property?projectId='+encodeURIComponent(PROJECT_ID)),d=await r.json(),pairs=d.pipeline?.matching?.results||[];
 if(!pairs.length)throw new Error('No candidate overlap pairs found.');
 const worker=new Worker('/pixel-worker.js?v=2');
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.terminate();reject(new Error('background matching timed out'))},45000);worker.onmessage=e=>{const m=e.data||{};if(m.type==='progress'){if(state)state.textContent='Pixel geometry: pair '+m.current+' of '+m.total+'...';return}clearTimeout(timer);worker.terminate();m.type==='done'?resolve(m.pairs):reject(new Error(m.error||'background matching failed'))};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message||'background worker error'))};worker.postMessage({projectId:PROJECT_ID,pairs})});
 const save=await fetch('/api/pixel-matches',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID,pairs:result})}),sd=await save.json();if(!save.ok)throw new Error(sd.error||'Could not save pixel matches');if(state)state.textContent='Pixel geometry: '+sd.pixelMatches.summary.usable+' usable, '+sd.pixelMatches.summary.weak+' weak of '+sd.pixelMatches.summary.pairs+' overlap pairs.';return sd.pixelMatches;
}

function setMeasureTab(tab){
 const siding=document.querySelector('#siding-tool'),roof=document.querySelector('#roof-tool'),sb=document.querySelector('#tab-siding'),rb=document.querySelector('#tab-roof');
 const isRoof=tab==='roof';if(siding)siding.hidden=isRoof;if(roof)roof.hidden=!isRoof;
 if(sb)sb.className=isRoof?'secondary':'primary';if(rb)rb.className=isRoof?'primary':'secondary';
 localStorage.setItem('solarisMeasureTab',isRoof?'roof':'siding');window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelector('#tab-siding')?.addEventListener('click',()=>setMeasureTab('siding'));
document.querySelector('#tab-roof')?.addEventListener('click',()=>setMeasureTab('roof'));
document.querySelector('#new-roof-measurement')?.addEventListener('click',()=>{
 const name=prompt('Roof measurement name or address:','Roof '+new Date().toISOString().slice(0,10));if(!name)return;
 localStorage.setItem('solarisRoofProject',JSON.stringify({name:name,createdAt:new Date().toISOString()}));
 const s=document.querySelector('#roof-state');if(s)s.textContent='Roof project ready: '+name+'. Add roof/property photos to begin.';
});
document.querySelector('#roof-photo-input')?.addEventListener('change',e=>{
 const files=[...(e.target.files||[])],g=document.querySelector('#roof-gallery'),s=document.querySelector('#roof-state');if(!files.length)return;
 if(g){g.innerHTML='';files.forEach(file=>{const card=document.createElement('div');card.className='photo-card';const img=document.createElement('img');img.src=URL.createObjectURL(file);img.alt=file.name;card.appendChild(img);g.appendChild(card)})}
 if(s)s.textContent=files.length+' roof image'+(files.length===1?'':'s')+' selected. Persistent roof uploads and geometry are the next engine.';
});
setMeasureTab(localStorage.getItem('solarisMeasureTab')||'siding');
if((localStorage.getItem('solarisMeasureTab')||'siding')==='roof'){
 setTimeout(()=>document.querySelector('#locate-roof')?.click(),150);
}

let roofLocatedProperty=null;
let roofMapsKey=null;
async function getRoofMapsKey(){
 if(roofMapsKey)return roofMapsKey;
 const r=await fetch('/api/maps-config');const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.key)throw new Error(d.error||'Google Maps key is not configured.');
 roofMapsKey=d.key;return roofMapsKey;
}
const roofAddressInput=document.querySelector('#roof-address');
let roofAddressFirstEdit=true;
roofAddressInput?.addEventListener('pointerdown',()=>{
 if(roofAddressFirstEdit){
  roofAddressFirstEdit=false;
  setTimeout(()=>{roofAddressInput.focus();roofAddressInput.setSelectionRange(0,roofAddressInput.value.length);},0);
 }
},{once:true});
roofAddressInput?.addEventListener('keydown',e=>{
 if(e.key==='Enter'){e.preventDefault();document.querySelector('#locate-roof')?.click();}
});
document.querySelector('#locate-roof')?.addEventListener('click',async()=>{
 const address=document.querySelector('#roof-address')?.value.trim();if(!address){alert('Enter a property address first.');return;}
 const status=document.querySelector('#roof-location-status'),map=document.querySelector('#roof-map'),confirm=document.querySelector('#confirm-roof-property'),btn=document.querySelector('#locate-roof');
 if(btn)btn.disabled=true;if(status)status.textContent='Locating '+address+'…';
 try{
  const key=await getRoofMapsKey();
  roofLocatedProperty={address};
  const src='https://www.google.com/maps/embed/v1/place?key='+encodeURIComponent(key)+'&q='+encodeURIComponent(address)+'&maptype=satellite&zoom=15';
  if(map)map.innerHTML='<iframe title="Satellite property map" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="width:100%;height:460px;border:0" src="'+src+'"></iframe>';
  if(status)status.textContent='Satellite property located. Pan/zoom to verify the correct roof, then select it.';
  if(confirm)confirm.disabled=false;
 }catch(err){
  roofLocatedProperty=null;if(confirm)confirm.disabled=true;
  if(status)status.textContent='Could not load Google satellite imagery: '+err.message;
  if(map)map.innerHTML='<div style="padding:32px;text-align:center"><strong>Satellite map unavailable</strong><p class="muted">'+err.message+'</p></div>';
 }finally{if(btn)btn.disabled=false;}
});
document.querySelector('#confirm-roof-property')?.addEventListener('click',()=>{
 if(!roofLocatedProperty)return;
 localStorage.setItem('solarisRoofProject',JSON.stringify({name:roofLocatedProperty.address,address:roofLocatedProperty.address,createdAt:new Date().toISOString()}));
 const state=document.querySelector('#roof-state');if(state)state.textContent='Property selected: '+roofLocatedProperty.address;
 const geo=document.querySelector('#roof-geometry');if(geo)geo.disabled=false;
 const ws=document.querySelector('#roof-selected-workspace'),title=document.querySelector('#roof-selected-address');
 if(title)title.textContent=roofLocatedProperty.address;if(ws){ws.hidden=false;ws.scrollIntoView({behavior:'smooth',block:'start'});}
 const confirm=document.querySelector('#confirm-roof-property');if(confirm){confirm.textContent='Property Selected ✓';confirm.disabled=true;}
});
document.querySelector('#confirm-roof-property')?.addEventListener('click',()=>{
 if(!roofLocatedProperty)return;
 localStorage.setItem('solarisRoofProject',JSON.stringify({name:roofLocatedProperty.address,address:roofLocatedProperty.address,createdAt:new Date().toISOString()}));
 const state=document.querySelector('#roof-state');if(state)state.textContent='Selected property: '+roofLocatedProperty.address+'. Ready for roof geometry.';
 const geo=document.querySelector('#roof-geometry');if(geo)geo.disabled=false;
});

async function openRoofGeometryWorkspace(){
 const project=roofLocatedProperty||JSON.parse(localStorage.getItem('solarisRoofProject')||'null');if(!project?.address)return;
 const ws=document.querySelector('#roof-geometry-workspace'),map=document.querySelector('#roof-workspace-map'),title=document.querySelector('#roof-workspace-address');
 if(title)title.textContent=project.address;
 if(ws)ws.hidden=false;
 try{
  const key=await getRoofMapsKey();
  const src='https://www.google.com/maps/embed/v1/place?key='+encodeURIComponent(key)+'&q='+encodeURIComponent(project.address)+'&maptype=satellite&zoom=19';
  if(map)map.innerHTML='<iframe title="Roof measurement satellite workspace" allowfullscreen loading="eager" referrerpolicy="no-referrer-when-downgrade" style="width:100%;height:560px;border:0" src="'+src+'"></iframe>';
 }catch(err){if(map)map.innerHTML='<div style="padding:32px">Could not load satellite workspace: '+err.message+'</div>';}
 const s=document.querySelector('#roof-state');if(s)s.textContent='Roof measurement workspace active for '+project.address;
 ws?.scrollIntoView({behavior:'smooth',block:'start'});
}
document.querySelector('#start-roof-geometry')?.addEventListener('click',openRoofGeometryWorkspace);
document.querySelector('#roof-geometry')?.addEventListener('click',openRoofGeometryWorkspace);
document.querySelector('#roof-outline-tool')?.addEventListener('click',()=>{
 const s=document.querySelector('#roof-workspace-status');if(s)s.textContent='Roof Outline selected. Interactive tracing is the next tool being connected.';
});
document.querySelector('#change-roof-property')?.addEventListener('click',()=>{
 roofLocatedProperty=null;const ws=document.querySelector('#roof-selected-workspace');if(ws)ws.hidden=true;
 const confirm=document.querySelector('#confirm-roof-property');if(confirm){confirm.disabled=true;confirm.textContent='Use This Property';}
 document.querySelector('#roof-address')?.focus();document.querySelector('#roof-map')?.scrollIntoView({behavior:'smooth',block:'center'});
});
