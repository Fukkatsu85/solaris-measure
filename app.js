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

// Register the guided roof button immediately. Function declarations are hoisted,
// so this remains available even if a later optional UI initializer encounters an error.
const earlyProcessRoofButton=document.querySelector('#process-roof-all');
if(earlyProcessRoofButton){
  earlyProcessRoofButton.addEventListener('click',async()=>{
    const status=document.querySelector('#roof-process-status');
    try{await processRoofGuided()}
    catch(err){
      if(status)status.textContent='Process Roof failed: '+(err?.message||String(err));
      console.error('Process Roof failed',err);
    }
  });
}

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
let roofLocatorMap=null;
let roofLocatorMarker=null;
let roofMapsScriptPromise=null;
let roofAutoProcessPending=false;
let roofProcessRunning=false;

async function getRoofMapsKey(){
 if(roofMapsKey)return roofMapsKey;
 const r=await fetch('/api/maps-config');const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.key)throw new Error(d.error||'Google Maps key is not configured.');
 roofMapsKey=d.key;return roofMapsKey;
}
async function loadRoofMapsJs(){
 if(window.google?.maps?.importLibrary)return window.google.maps;
 if(roofMapsScriptPromise)return roofMapsScriptPromise;
 roofMapsScriptPromise=(async()=>{
  const key=await getRoofMapsKey();
  await new Promise((resolve,reject)=>{
   const s=document.createElement('script');
   s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&v=weekly&libraries=marker';
   s.async=true;s.defer=true;s.onload=resolve;s.onerror=()=>reject(new Error('Maps JavaScript API failed to load.'));
   document.head.appendChild(s);
  });
  return window.google.maps;
 })();
 return roofMapsScriptPromise;
}
async function showRoofLocator(address,lat,lng){
 const mapEl=document.querySelector('#roof-map');
 if(!mapEl)throw new Error('Roof map container is missing.');
 await loadRoofMapsJs();
 const {Map}=await google.maps.importLibrary('maps');
 const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');
 mapEl.innerHTML='';
 roofLocatorMap=new Map(mapEl,{
  center:{lat,lng},
  zoom:20,
  mapTypeId:'satellite',
  tilt:0,
  mapId:'DEMO_MAP_ID',
  streetViewControl:false,
  fullscreenControl:true,
  mapTypeControl:true,
  zoomControl:true
 });
 roofLocatorMarker=new AdvancedMarkerElement({
  map:roofLocatorMap,
  position:{lat,lng},
  title:'Drag onto the exact roof',
  gmpDraggable:true
 });
 const syncPosition=()=>{
  const p=roofLocatorMarker.position;
  const plat=typeof p?.lat==='function'?p.lat():Number(p?.lat);
  const plng=typeof p?.lng==='function'?p.lng():Number(p?.lng);
  if(!Number.isFinite(plat)||!Number.isFinite(plng))return;
  roofLocatedProperty={address,lat:plat,lng:plng,locationSource:'corrected-pin'};
  const status=document.querySelector('#roof-location-status');
  if(status)status.textContent='Pin location: '+plat.toFixed(6)+', '+plng.toFixed(6)+' · drag the pin onto the exact roof, then click Use This Location.';
 };
 roofLocatorMarker.addListener('dragend',syncPosition);
 roofLocatedProperty={address,lat,lng,locationSource:'browser-geocode'};
 const status=document.querySelector('#roof-location-status');
 if(status)status.textContent='Property located. Drag the pin onto the exact roof if needed, then click Use This Location.';
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
 const status=document.querySelector('#roof-location-status'),confirm=document.querySelector('#confirm-roof-property'),btn=document.querySelector('#locate-roof');
 if(btn)btn.disabled=true;if(confirm)confirm.disabled=true;if(status)status.textContent='Locating '+address+'…';
 try{
  await loadRoofMapsJs();
  const geocoder=new google.maps.Geocoder();
  const result=await geocoder.geocode({address});
  const hit=result?.results?.[0];
  const loc=hit?.geometry?.location;
  const lat=typeof loc?.lat==='function'?loc.lat():Number(loc?.lat);
  const lng=typeof loc?.lng==='function'?loc.lng():Number(loc?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('Address could not be located.');
  const formatted=hit?.formatted_address||address;
  roofLocatedProperty={address:formatted,lat,lng,locationSource:'browser-geocode'};
  await showRoofLocator(formatted,lat,lng);
  if(confirm)confirm.disabled=false;
 }catch(err){
  roofLocatedProperty=null;if(confirm)confirm.disabled=true;
  if(status)status.textContent='Could not load interactive satellite map: '+err.message;
  const map=document.querySelector('#roof-map');if(map)map.innerHTML='<div style="padding:32px;text-align:center"><strong>Interactive map unavailable</strong><p class="muted">'+err.message+'</p></div>';
 }finally{if(btn)btn.disabled=false}
});

document.querySelector('#confirm-roof-property')?.addEventListener('click',()=>{
 if(!roofLocatedProperty||!Number.isFinite(Number(roofLocatedProperty.lat))||!Number.isFinite(Number(roofLocatedProperty.lng)))return;
 const previous=JSON.parse(localStorage.getItem('solarisRoofProject')||'{}');
 const project={
  ...previous,
  name:roofLocatedProperty.address,
  address:roofLocatedProperty.address,
  lat:Number(roofLocatedProperty.lat),
  lng:Number(roofLocatedProperty.lng),
  locationSource:'corrected-pin',
  locationConfirmedAt:new Date().toISOString(),
  createdAt:previous.createdAt||new Date().toISOString()
 };
 // Correcting the pin invalidates location-derived imagery/LiDAR from an older center.
 delete project.lidarSource;delete project.lidarDataset;delete project.lidarEpt;delete project.lidarSubset;delete project.lidarDecodedSummary;
 localStorage.setItem('solarisRoofProject',JSON.stringify(project));
 const state=document.querySelector('#roof-state');if(state)state.textContent='Roof location confirmed: '+project.address+' · '+project.lat.toFixed(6)+', '+project.lng.toFixed(6);
 const geo=document.querySelector('#roof-geometry');if(geo)geo.disabled=false;
 const ws=document.querySelector('#roof-selected-workspace'),title=document.querySelector('#roof-selected-address');
 if(title)title.textContent=project.address;
 if(ws){ws.hidden=false;ws.scrollIntoView({behavior:'smooth',block:'start'});}
 const confirm=document.querySelector('#confirm-roof-property');if(confirm){confirm.textContent='Location Selected ✓';confirm.disabled=true;}
});

async function openRoofGeometryWorkspace(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null');
 const project=saved||roofLocatedProperty;if(!project?.address)return;
 const ws=document.querySelector('#roof-geometry-workspace'),map=document.querySelector('#roof-workspace-map'),title=document.querySelector('#roof-workspace-address');
 if(title)title.textContent=project.address;
 if(ws)ws.hidden=false;
 try{
  await loadRoofMapsJs();
  const lat=Number(project.lat),lng=Number(project.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('Roof coordinates are missing.');
  const {Map}=await google.maps.importLibrary('maps');
  const {AdvancedMarkerElement}=await google.maps.importLibrary('marker');
  if(map){
   map.innerHTML='';
   map.style.height='560px';
   const workspaceMap=new Map(map,{
    center:{lat,lng},
    zoom:20,
    mapTypeId:'satellite',
    tilt:0,
    mapId:'DEMO_MAP_ID',
    streetViewControl:true,
    fullscreenControl:true,
    mapTypeControl:true,
    zoomControl:true
   });
   new AdvancedMarkerElement({map:workspaceMap,position:{lat,lng},title:'Selected roof location'});
  }
 }catch(err){if(map)map.innerHTML='<div style="padding:32px">Could not load satellite workspace: '+err.message+'</div>';}
 const s=document.querySelector('#roof-state');if(s)s.textContent='Roof measurement workspace active for '+project.address;
 const aerialWrap=document.querySelector('#mn-aerial-wrap'),aerialStatus=document.querySelector('#mn-aerial-status'),aerialBadge=document.querySelector('#mn-aerial-badge');
 if(aerialWrap)aerialWrap.innerHTML='<span class="muted">Loading Minnesota aerial imagery…</span>';
 if(aerialStatus)aerialStatus.textContent='Resolving property coordinates…';if(aerialBadge)aerialBadge.textContent='Loading';
 try{
  const aerialQuery=Number.isFinite(Number(project.lat))&&Number.isFinite(Number(project.lng))
   ?('/api/mn-aerial?lat='+encodeURIComponent(project.lat)+'&lng='+encodeURIComponent(project.lng)+'&address='+encodeURIComponent(project.address))
   :('/api/mn-aerial?address='+encodeURIComponent(project.address));
  const ar=await fetch(aerialQuery);const ad=await ar.json();
  if(!ar.ok)throw new Error(ad.error||'Aerial imagery lookup failed.');
  project.lat=ad.lat;project.lng=ad.lng;project.formattedAddress=ad.address;project.imagerySource=ad.source;project.imageryLayer=ad.imageryLayer;project.imageryLabel=ad.imageryLabel;project.imageryResolution=ad.resolution;project.imageryProjection=ad.projection;project.imageryCropHalfMeters=ad.cropHalfMeters;
  localStorage.setItem('solarisRoofProject',JSON.stringify({...JSON.parse(localStorage.getItem('solarisRoofProject')||'{}'),...project}));
  if(aerialWrap){aerialWrap.innerHTML='<img id="mn-aerial-img" src="'+ad.imageryUrl+'" alt="MnGeo aerial image of selected roof" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#111"><svg id="roof-outline-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;touch-action:none;cursor:crosshair"></svg>';bindRoofOverlayEditor();}
  if(aerialStatus)aerialStatus.textContent='Analysis imagery loaded: '+ad.imageryLabel+' ('+ad.resolution+') · '+ad.county+' · '+ad.lat.toFixed(6)+', '+ad.lng.toFixed(6)+'.';
  if(aerialBadge)aerialBadge.textContent='Ready';
  setTimeout(()=>findRoofLidar().catch(()=>{}),250);
  setTimeout(()=>restoreRoofReportReadyState().catch(()=>{}),350);
  setTimeout(()=>restoreRoofSolarModel().catch(()=>{}),450);
 }catch(err){
  if(aerialWrap)aerialWrap.innerHTML='<div style="padding:28px;text-align:center"><strong>Analysis imagery unavailable</strong><p class="muted">'+err.message+'</p></div>';
  if(aerialStatus)aerialStatus.textContent='If Google reports an API error, enable Geocoding API for the Solaris Measure key.';
  if(aerialBadge)aerialBadge.textContent='Needs setup';
 }
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

let roofOutlineProposal=null;
function renderRoofOutline(poly,accepted=false){
 const svg=document.querySelector('#roof-outline-overlay');if(!svg||!poly?.length)return;
 const pts=poly.map(p=>(p.x*1000)+','+(p.y*1000)).join(' ');
 svg.innerHTML='<polygon points="'+pts+'" fill="'+(accepted?'rgba(34,197,94,.20)':'rgba(250,204,21,.22)')+'" stroke="'+(accepted?'#22c55e':'#facc15')+'" stroke-width="7" vector-effect="non-scaling-stroke"/>'+poly.map(p=>'<circle cx="'+(p.x*1000)+'" cy="'+(p.y*1000)+'" r="10" fill="#fff" stroke="#111" stroke-width="4"/>').join('');
}

function roofImageReady(img){return new Promise((resolve,reject)=>{if(img?.complete&&img.naturalWidth)return resolve();if(!img)return reject(new Error('Aerial image is not loaded.'));img.addEventListener('load',()=>resolve(),{once:true});img.addEventListener('error',()=>reject(new Error('Could not read aerial image.')),{once:true});})}
function pointLineDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y;if(dx===0&&dy===0)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy))}
function rdp(points,eps){
 if(points.length<3)return points;
 let max=0,idx=0;for(let i=1;i<points.length-1;i++){const d=pointLineDistance(points[i],points[0],points[points.length-1]);if(d>max){max=d;idx=i}}
 if(max>eps){const a=rdp(points.slice(0,idx+1),eps),b=rdp(points.slice(idx),eps);return a.slice(0,-1).concat(b)}
 return[points[0],points[points.length-1]];
}
function simplifyClosedRoofPolygon(poly,eps=.008){
 if(poly.length<5)return poly;
 const open=poly.concat([poly[0]]),simple=rdp(open,eps);simple.pop();
 return simple.length>=4?simple:poly;
}
function roofCornerImportance(a,b,c){
 const ab=Math.hypot(b.x-a.x,b.y-a.y),bc=Math.hypot(c.x-b.x,c.y-b.y);
 const dev=pointLineDistance(b,a,c);
 return dev*Math.min(ab,bc);
}
function pruneRoofContour(poly,maxPoints=14,minSpacing=.012){
 let pts=[...poly];
 // Remove near-duplicate / tiny edge points first.
 let changed=true;
 while(changed&&pts.length>4){
  changed=false;
  for(let i=0;i<pts.length;i++){
   const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
   if(Math.hypot(b.x-a.x,b.y-a.y)<minSpacing||Math.hypot(c.x-b.x,c.y-b.y)<minSpacing){
    pts.splice(i,1);changed=true;break;
   }
  }
 }
 // Keep the strongest architectural corners and discard weak curve/noise samples.
 while(pts.length>maxPoints){
  let remove=-1,best=Infinity;
  for(let i=0;i<pts.length;i++){
   const a=pts[(i-1+pts.length)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
   const score=roofCornerImportance(a,b,c);
   if(score<best){best=score;remove=i}
  }
  if(remove<0)break;
  pts.splice(remove,1);
 }
 return pts;
}
function architecturalizeRoofContour(poly){
 let pts=simplifyClosedRoofPolygon(poly,.0105);
 pts=pruneRoofContour(pts,14,.010);
 // One final simplification removes shallow bends left by radial sampling.
 pts=simplifyClosedRoofPolygon(pts,.0135);
 return pruneRoofContour(pts,12,.012);
}
async function buildRoofPixelContour(box){
 const img=document.querySelector('#mn-aerial-img');await roofImageReady(img);
 const size=520,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,size,size);
 const data=ctx.getImageData(0,0,size,size).data;
 const lum=(x,y)=>{x=Math.max(0,Math.min(size-1,Math.round(x)));y=Math.max(0,Math.min(size-1,Math.round(y)));const i=(y*size+x)*4;return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2]};
 const x1=Math.max(0,box.x1*size),y1=Math.max(0,box.y1*size),x2=Math.min(size,box.x2*size),y2=Math.min(size,box.y2*size);
 const cx=(x1+x2)/2,cy=(y1+y2)/2,bw=x2-x1,bh=y2-y1;
 const rayCount=28,pts=[];
 for(let i=0;i<rayCount;i++){
  const ang=-Math.PI/2+i*(Math.PI*2/rayCount),dx=Math.cos(ang),dy=Math.sin(ang);
  const tx=dx>0?(x2-cx)/dx:dx<0?(x1-cx)/dx:Infinity;
  const ty=dy>0?(y2-cy)/dy:dy<0?(y1-cy)/dy:Infinity;
  const expected=Math.min(Math.abs(tx),Math.abs(ty)),r0=Math.max(6,expected*.62),r1=Math.min(Math.hypot(bw,bh)*.72,expected*1.20);
  let bestR=expected,bestScore=-1;
  for(let r=r0;r<=r1;r+=1.5){
   const inside=lum(cx+dx*(r-3),cy+dy*(r-3)),outside=lum(cx+dx*(r+3),cy+dy*(r+3));
   const tangentX=-dy,tangentY=dx;
   const in2=(lum(cx+dx*(r-2)+tangentX*2,cy+dy*(r-2)+tangentY*2)+lum(cx+dx*(r-2)-tangentX*2,cy+dy*(r-2)-tangentY*2))/2;
   const out2=(lum(cx+dx*(r+2)+tangentX*2,cy+dy*(r+2)+tangentY*2)+lum(cx+dx*(r+2)-tangentX*2,cy+dy*(r+2)-tangentY*2))/2;
   const contrast=Math.abs(outside-inside)+.6*Math.abs(out2-in2);
   const proximity=1-Math.min(1,Math.abs(r-expected)/(expected*.42||1));
   // Favor edges near the detected building envelope so trees/shadows do not
   // pull the outline into a noisy rounded contour.
   const score=contrast*(.45+.55*proximity);
   if(score>bestScore){bestScore=score;bestR=r}
  }
  pts.push({x:(cx+dx*bestR)/size,y:(cy+dy*bestR)/size});
 }
 const smooth=pts.map((p,i)=>{const a=pts[(i-1+pts.length)%pts.length],b=pts[(i+1)%pts.length];return{x:(a.x+2*p.x+b.x)/4,y:(a.y+2*p.y+b.y)/4}});
 const simple=architecturalizeRoofContour(smooth);
 return simple.map(p=>({x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))}));
}

async function detectRoofAutomatically(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null'),btn=document.querySelector('#detect-roof'),status=document.querySelector('#mn-aerial-status');
 if(!saved?.lat||!saved?.lng){if(status)status.textContent='Property coordinates are not ready yet.';return}
 if(btn)btn.disabled=true;if(status)status.textContent='AI is detecting the roof on the MnGeo aerial image…';
 try{
  const r=await fetch('/api/roof-detect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:saved.lat,lng:saved.lng,address:saved.address,layer:saved.imageryLayer})}),d=await r.json();
  if(!r.ok||!d.ok)throw new Error(d.error||'Roof detection failed.');
  let polygon=d.polygon;
  try{
   const contour=await buildRoofPixelContour(d.box);
   if(contour?.length>=6)polygon=contour;
  }catch(contourErr){console.warn('Roof contour refinement unavailable',contourErr)}
  roofOutlineProposal={...d,polygon,pointCount:polygon.length,contourMethod:polygon===d.polygon?'ai-box-fallback':'pixel-edge-radial'};
  renderRoofOutline(polygon,false);
  document.querySelector('#accept-roof-outline').disabled=false;document.querySelector('#edit-roof-outline').disabled=false;document.querySelector('#redetect-roof').disabled=false;
  if(status)status.textContent='Roof proposal detected with '+polygon.length+' primary corners. Yellow outline requires review before measurements are used.';
 }catch(err){if(status)status.textContent='Automatic roof detection could not produce a usable proposal: '+err.message}
 finally{if(btn)btn.disabled=false}
}
document.querySelector('#detect-roof')?.addEventListener('click',detectRoofAutomatically);
document.querySelector('#redetect-roof')?.addEventListener('click',detectRoofAutomatically);
function localRoofPlanMetrics(poly,lat,cropHalfMeters=42){
 const size=Number(cropHalfMeters)*2,k=Math.cos(Number(lat)*Math.PI/180);
 const pts=poly.map(p=>({x:Number(p.x)*size*k,y:Number(p.y)*size*k}));
 let a2=0,perim=0;
 for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];a2+=a.x*b.y-b.x*a.y;perim+=Math.hypot(b.x-a.x,b.y-a.y)}
 const areaM2=Math.abs(a2)/2,areaFt2=areaM2*10.763910417;
 return{planAreaFt2:areaFt2,planSquares:areaFt2/100,perimeterFt:perim*3.280839895};
}
document.querySelector('#accept-roof-outline')?.addEventListener('click',async()=>{
 if(!roofOutlineProposal)return;
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 const status=document.querySelector('#mn-aerial-status'),btn=document.querySelector('#accept-roof-outline');
 const lat=Number(saved.lat),lng=Number(saved.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)){if(status)status.textContent='Could not measure outline: property coordinates are missing.';return}
 const localM=localRoofPlanMetrics(roofOutlineProposal.polygon,lat,saved.imageryCropHalfMeters||42);
 renderRoofOutline(roofOutlineProposal.polygon,true);
 const area=document.querySelector('#roof-area'),per=document.querySelector('#roof-perimeter'),sq=document.querySelector('#roof-squares');
 if(area)area.textContent=localM.planAreaFt2.toLocaleString(undefined,{maximumFractionDigits:0})+' ft²';
 if(per)per.textContent=localM.perimeterFt.toLocaleString(undefined,{maximumFractionDigits:1})+' ft';
 if(sq)sq.textContent=localM.planSquares.toFixed(2)+' plan sq';
 if(status)status.textContent='Roof outline accepted ✓ · Plan area '+localM.planAreaFt2.toFixed(0)+' ft² · Perimeter '+localM.perimeterFt.toFixed(1)+' ft. Saving…';
 if(btn)btn.disabled=true;
 try{
  const projectId=saved.projectId||('roof-'+lat.toFixed(6)+'-'+lng.toFixed(6));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  const r=await fetch('/api/roof-outline',{method:'POST',signal:controller.signal,headers:{'content-type':'application/json'},body:JSON.stringify({
    projectId,address:saved.address,lat,lng,
    imageryLayer:saved.imageryLayer,imageryLabel:saved.imageryLabel,
    projection:saved.imageryProjection||'EPSG:3857',
    cropHalfMeters:saved.imageryCropHalfMeters||42,
    polygon:roofOutlineProposal.polygon
  })});
  clearTimeout(timer);
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Could not save accepted roof outline.');
  roofOutlineProposal={...roofOutlineProposal,...d.outline,status:'accepted-plan-view'};
  if(status)status.textContent='Roof outline accepted ✓ · Plan area '+d.outline.measurement.planAreaFt2.toFixed(0)+' ft² · Perimeter '+d.outline.measurement.perimeterFt.toFixed(1)+' ft. Pitch is not applied yet.';
  if(roofAutoProcessPending)setTimeout(()=>processRoofGuided(),50);
 }catch(err){
  if(status)status.textContent='Roof measurements calculated, but cloud save did not finish. '+(err.name==='AbortError'?'Save timed out; you can continue editing and try Accept again.':err.message);
  if(btn)btn.disabled=false;
 }
});

let roofEditMode=false,dragRoofPoint=-1;
function roofSvgPoint(e,svg){const r=svg.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}}
function enableRoofPointEditing(){
 bindRoofOverlayEditor();
 const svg=document.querySelector('#roof-outline-overlay');if(!svg||!roofOutlineProposal?.polygon)return;
 roofEditMode=!roofEditMode;svg.style.pointerEvents=roofEditMode?'auto':'none';
 document.querySelector('#edit-roof-outline').textContent=roofEditMode?'Finish Editing':'Edit Points';
 renderRoofOutline(roofOutlineProposal.polygon,false);
 const s=document.querySelector('#mn-aerial-status');if(s)s.textContent=roofEditMode?'Drag white points to align them with the actual roof corners. Double-click an edge area to add another point.':'Roof point editing finished. Review the outline, then accept it.';
}
document.querySelector('#edit-roof-outline')?.addEventListener('click',enableRoofPointEditing);
function bindRoofOverlayEditor(){
 const svg=document.querySelector('#roof-outline-overlay');
 if(!svg||svg.dataset.editorBound==='1')return;
 svg.dataset.editorBound='1';
 svg.addEventListener('pointerdown',e=>{
  if(!roofEditMode||!roofOutlineProposal?.polygon)return;
  const p=roofSvgPoint(e,svg);let best=-1,dist=.05;
  roofOutlineProposal.polygon.forEach((q,i)=>{const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<dist){dist=d;best=i}});
  if(best>=0){dragRoofPoint=best;svg.setPointerCapture?.(e.pointerId);e.preventDefault();}
 });
 svg.addEventListener('pointermove',e=>{
  if(!roofEditMode||dragRoofPoint<0)return;
  roofOutlineProposal.polygon[dragRoofPoint]=roofSvgPoint(e,svg);
  renderRoofOutline(roofOutlineProposal.polygon,false);
  e.preventDefault();
 });
 const stop=()=>{dragRoofPoint=-1};
 svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);
 svg.addEventListener('dblclick',e=>{
  if(!roofEditMode||!roofOutlineProposal?.polygon)return;
  const p=roofSvgPoint(e,svg),poly=roofOutlineProposal.polygon;let best=0,bd=Infinity;
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],mx=(a.x+b.x)/2,my=(a.y+b.y)/2,d=Math.hypot(p.x-mx,p.y-my);if(d<bd){bd=d;best=i}}
  poly.splice(best+1,0,p);renderRoofOutline(poly,false);e.preventDefault();
 });
}

let roofLineProposals=[];
function pipRoof(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];const hit=((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/((b.y-a.y)||1e-9)+a.x);if(hit)inside=!inside}return inside}
function segPolyIntersections(a,b,poly){
 const out=[];const dx=b.x-a.x,dy=b.y-a.y;
 for(let i=0;i<poly.length;i++){const c=poly[i],d=poly[(i+1)%poly.length],ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;if(Math.abs(den)<1e-9)continue;
  const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;
  if(t>=0&&t<=1&&u>=0&&u<=1)out.push({x:a.x+t*dx,y:a.y+t*dy})
 }
 return out;
}
function renderRoofLines(){
 const svg=document.querySelector('#roof-outline-overlay');if(!svg||!roofOutlineProposal?.polygon)return;
 renderRoofOutline(roofOutlineProposal.polygon,roofOutlineProposal.status==='accepted-plan-view');
 const ns='http://www.w3.org/2000/svg';
 roofLineProposals.forEach((l,i)=>{
  if(l.type==='ignore')return;
  const line=document.createElementNS(ns,'line');line.setAttribute('x1',l.a.x*1000);line.setAttribute('y1',l.a.y*1000);line.setAttribute('x2',l.b.x*1000);line.setAttribute('y2',l.b.y*1000);
  line.setAttribute('stroke',l.type==='ridge'?'#22c55e':l.type==='hip'?'#60a5fa':l.type==='valley'?'#ef4444':'#f97316');line.setAttribute('stroke-width','6');line.setAttribute('vector-effect','non-scaling-stroke');svg.appendChild(line);
  const tx=document.createElementNS(ns,'text');tx.setAttribute('x',((l.a.x+l.b.x)/2)*1000);tx.setAttribute('y',((l.a.y+l.b.y)/2)*1000);tx.setAttribute('fill','#fff');tx.setAttribute('stroke','#111');tx.setAttribute('stroke-width','3');tx.setAttribute('paint-order','stroke');tx.setAttribute('font-size','34');tx.setAttribute('font-weight','700');tx.textContent=String(i+1);svg.appendChild(tx);
 });
}
async function detectInternalRoofLines(){
 const status=document.querySelector('#roof-line-status'),panel=document.querySelector('#roof-line-panel'),list=document.querySelector('#roof-line-list'),count=document.querySelector('#roof-line-count');
 if(!roofOutlineProposal?.polygon){if(status)status.textContent='Accept a roof outline first.';return}
 const img=document.querySelector('#mn-aerial-img');try{await roofImageReady(img)}catch(e){if(status)status.textContent=e.message;return}
 if(panel)panel.hidden=false;if(status)status.textContent='Scanning aerial image for strong internal roof lines…';
 const size=420,cv=document.createElement('canvas');cv.width=size;cv.height=size;const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,size,size);
 const im=ctx.getImageData(0,0,size,size).data,gray=new Float32Array(size*size);
 for(let i=0;i<size*size;i++)gray[i]=.2126*im[i*4]+.7152*im[i*4+1]+.0722*im[i*4+2];
 const edges=[];for(let y=2;y<size-2;y+=2)for(let x=2;x<size-2;x+=2){const p={x:x/size,y:y/size};if(!pipRoof(p,roofOutlineProposal.polygon))continue;
  const gx=-gray[(y-1)*size+x-1]-2*gray[y*size+x-1]-gray[(y+1)*size+x-1]+gray[(y-1)*size+x+1]+2*gray[y*size+x+1]+gray[(y+1)*size+x+1];
  const gy=-gray[(y-1)*size+x-1]-2*gray[(y-1)*size+x]-gray[(y-1)*size+x+1]+gray[(y+1)*size+x-1]+2*gray[(y+1)*size+x]+gray[(y+1)*size+x+1];
  const mag=Math.hypot(gx,gy);if(mag>110)edges.push({x,y,mag});
 }
 const thetas=[];for(let d=0;d<180;d+=3)thetas.push(d*Math.PI/180);const rhoMax=Math.ceil(Math.hypot(size,size)),acc=Array.from({length:thetas.length},()=>new Uint16Array(rhoMax*2+1));
 for(const e of edges){for(let t=0;t<thetas.length;t++){const r=Math.round(e.x*Math.cos(thetas[t])+e.y*Math.sin(thetas[t]))+rhoMax;if(r>=0&&r<acc[t].length)acc[t][r]++}}
 const peaks=[];for(let t=0;t<thetas.length;t++)for(let r=0;r<acc[t].length;r++){const v=acc[t][r];if(v>14)peaks.push({t,r,v})}peaks.sort((a,b)=>b.v-a.v);
 const chosen=[];for(const p of peaks){const th=thetas[p.t],rho=p.r-rhoMax;if(chosen.some(q=>Math.abs(q.th-th)<.12&&Math.abs(q.rho-rho)<22))continue;chosen.push({th,rho,score:p.v});if(chosen.length>=10)break}
 const poly=roofOutlineProposal.polygon,lines=[];
 for(const q of chosen){const nx=Math.cos(q.th),ny=Math.sin(q.th),tx=-ny,ty=nx,cx=nx*q.rho/size,cy=ny*q.rho/size;
  const a={x:cx-tx*2,y:cy-ty*2},b={x:cx+tx*2,y:cy+ty*2},ints=segPolyIntersections(a,b,poly);
  if(ints.length<2)continue;let best=null,bd=0;for(let i=0;i<ints.length;i++)for(let j=i+1;j<ints.length;j++){const d=Math.hypot(ints[j].x-ints[i].x,ints[j].y-ints[i].y);if(d>bd){bd=d;best=[ints[i],ints[j]]}}
  if(best&&bd>.12)lines.push({id:'line-'+(lines.length+1),type:'candidate',a:best[0],b:best[1],score:q.score});
 }
 roofLineProposals=lines.slice(0,8);renderRoofLines();
 if(count)count.textContent=roofLineProposals.length+' lines';
 if(list)list.innerHTML=roofLineProposals.map((l,i)=>'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #e5e7eb"><strong style="min-width:54px">Line '+(i+1)+'</strong><select data-roof-line="'+i+'" style="padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1"><option value="candidate">Candidate</option><option value="ridge">Ridge</option><option value="hip">Hip</option><option value="valley">Valley</option><option value="ignore">Ignore</option></select><span class="muted">edge score '+l.score+'</span></div>').join('');
 list?.querySelectorAll('select[data-roof-line]').forEach(sel=>sel.addEventListener('change',e=>{roofLineProposals[+e.target.dataset.roofLine].type=e.target.value;renderRoofLines()}));
 if(status)status.textContent=roofLineProposals.length?'Review the numbered lines and classify Ridge / Hip / Valley / Ignore.':'No strong internal lines found automatically. Manual roof geometry will be needed.';
}
document.querySelector('#detect-roof-lines')?.addEventListener('click',detectInternalRoofLines);
document.querySelector('#save-roof-lines')?.addEventListener('click',async()=>{
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},status=document.querySelector('#roof-line-status');
 if(!saved?.lat||!saved?.lng){if(status)status.textContent='Property coordinates missing.';return}
 const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 const lines=roofLineProposals.filter(l=>l.type!=='ignore'),defaultPitch=Number(document.querySelector('#roof-default-pitch')?.value||4);
 if(status)status.textContent='Saving reviewed roof geometry…';
 try{const r=await fetch('/api/roof-geometry',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,address:saved.address,lines,defaultPitch})}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Could not save roof geometry');
  const ridge=lines.filter(l=>l.type==='ridge').length,hip=lines.filter(l=>l.type==='hip').length,valley=lines.filter(l=>l.type==='valley').length;
  if(status)status.textContent='Roof geometry saved ✓ · '+ridge+' ridge · '+hip+' hip · '+valley+' valley · default pitch '+defaultPitch+'/12. Next: facet construction.';
  const p=document.querySelector('#roof-pitch');if(p)p.textContent=defaultPitch+'/12 default';
 }catch(err){if(status)status.textContent='Could not save roof geometry: '+err.message}
});

async function findRoofLidar(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 const status=document.querySelector('#roof-lidar-status'),badge=document.querySelector('#roof-lidar-badge'),details=document.querySelector('#roof-lidar-details'),btn=document.querySelector('#find-roof-lidar');
 if(!Number.isFinite(Number(saved.lat))||!Number.isFinite(Number(saved.lng))){if(status)status.textContent='Property coordinates are missing. Reopen the roof workspace first.';return}
 if(btn)btn.disabled=true;if(badge)badge.textContent='Checking';if(status)status.textContent='Searching USGS 3DEP point-cloud coverage for this roof…';
 try{
  const r=await fetch('/api/lidar-source?lat='+encodeURIComponent(saved.lat)+'&lng='+encodeURIComponent(saved.lng));
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'LiDAR lookup failed.');
  if(!d.best){if(badge)badge.textContent='No coverage';if(status)status.textContent='No USGS LPC tile was returned for this roof location.';if(details)details.innerHTML='';return}
  saved.lidarSource=d.best;saved.lidarDataset=d.dataset;saved.lidarResolvedAt=new Date().toISOString();
  localStorage.setItem('solarisRoofProject',JSON.stringify(saved));
  if(badge)badge.textContent='Coverage found';
  const extractBtn=document.querySelector('#extract-roof-lidar');if(extractBtn)extractBtn.disabled=false;
  const mb=d.best.sizeInBytes?((Number(d.best.sizeInBytes)/1048576).toFixed(1)+' MB'):'size unavailable';
  if(status)status.textContent='USGS 3DEP LiDAR coverage found. Next step is extracting only the roof-area points from this point cloud.';
  if(details)details.innerHTML='<div class="analysis-state"><strong>'+String(d.best.title||'USGS LiDAR tile').replace(/[&<>"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))+'</strong><br><span class="muted">'+
   (d.best.publicationDate?'Published '+d.best.publicationDate+' · ':'')+mb+' · '+d.count+' intersecting tile'+(d.count===1?'':'s')+' found</span></div>';
 }catch(err){
  if(badge)badge.textContent='Lookup failed';if(status)status.textContent='Could not resolve LiDAR coverage: '+err.message;if(details)details.innerHTML='';
 }finally{if(btn)btn.disabled=false}
}
document.querySelector('#find-roof-lidar')?.addEventListener('click',findRoofLidar);

async function extractRoofLidar(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 const status=document.querySelector('#roof-lidar-status'),box=document.querySelector('#roof-lidar-extract'),btn=document.querySelector('#extract-roof-lidar'),badge=document.querySelector('#roof-lidar-badge');
 if(!saved?.lidarSource){if(status)status.textContent='Find LiDAR coverage first.';return}
 if(!Number.isFinite(Number(saved.lat))||!Number.isFinite(Number(saved.lng))){if(status)status.textContent='Property coordinates are missing.';return}
 if(btn)btn.disabled=true;if(badge)badge.textContent='Extracting';if(status)status.textContent='Resolving the streamable USGS EPT resource and isolating the roof-area nodes…';
 if(box){box.hidden=false;box.textContent='Working…'}
 try{
  const r=await fetch('/api/lidar-extract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    lat:saved.lat,lng:saved.lng,source:saved.lidarSource,halfMeters:28
  })});
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'LiDAR extraction failed.');
  saved.lidarEpt=d.ept;saved.lidarSubset=d.subset;saved.lidarExtractedAt=new Date().toISOString();
  localStorage.setItem('solarisRoofProject',JSON.stringify(saved));
  const decodeBtn=document.querySelector('#decode-roof-lidar');if(decodeBtn)decodeBtn.disabled=false;
  const pts=Number(d.subset.estimatedPoints||0).toLocaleString();
  if(badge)badge.textContent='Roof window ready';
  if(status)status.textContent='Roof-area LiDAR window resolved. Solaris found '+d.subset.nodeCount+' EPT node'+(d.subset.nodeCount===1?'':'s')+' intersecting the roof search area.';
  if(box)box.innerHTML='<strong>Roof LiDAR subset ready</strong><br><span class="muted">EPT resource: '+String(d.ept.name||'USGS 3DEP').replace(/[&<>"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))+'<br>'+d.subset.nodeCount+' intersecting EPT nodes · approximately '+pts+' points represented in the selected hierarchy window.<br>Next: decode only these LAZ/EPT nodes and fit roof planes.</span>';
 }catch(err){
  if(badge)badge.textContent='Extraction needs setup';
  if(status)status.textContent='Could not isolate the roof LiDAR stream: '+err.message;
  if(box)box.textContent='The source tile was found, but Solaris could not yet resolve its matching public EPT resource.';
 }finally{if(btn)btn.disabled=false}
}
document.querySelector('#extract-roof-lidar')?.addEventListener('click',extractRoofLidar);

let roofLidarDecoded=null;
function roofMercator(lat,lng){return{x:6378137*lng*Math.PI/180,y:6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))}}
function roofPolyToMercator(poly,lat,lng,half){
 const c=roofMercator(lat,lng),size=half*2;
 return poly.map(p=>({x:c.x+(Number(p.x)-.5)*size,y:c.y+(.5-Number(p.y))*size}));
}
function renderRoofLidar(points,q,poly,minZ,maxZ){
 const wrap=document.querySelector('#roof-lidar-visual'),canvas=document.querySelector('#roof-lidar-canvas');if(!canvas)return;
 if(wrap)wrap.hidden=false;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#111';ctx.fillRect(0,0,w,h);
 const sx=x=>(x-q[0])/(q[2]-q[0])*w,sy=y=>h-(y-q[1])/(q[3]-q[1])*h,span=Math.max(.01,(maxZ??1)-(minZ??0));
 for(const p of points){const t=Math.max(0,Math.min(1,(p.z-(minZ??p.z))/span)),hue=240-240*t;ctx.fillStyle='hsl('+hue+' 90% 60%)';ctx.fillRect(sx(p.x)-1.5,sy(p.y)-1.5,3,3)}
 if(poly?.length){ctx.beginPath();poly.forEach((p,i)=>{const x=sx(p.x),y=sy(p.y);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke()}
}
async function getAcceptedRoofOutline(saved){
 if(roofOutlineProposal?.polygon?.length>=3)return roofOutlineProposal.polygon;
 const id=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 const r=await fetch('/api/roof-outline?projectId='+encodeURIComponent(id)),d=await r.json();
 if(r.ok&&d.outline?.polygon?.length>=3)return d.outline.polygon;
 throw new Error('Accept the roof outline before decoding LiDAR points.');
}
async function decodeRoofLidar(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},status=document.querySelector('#roof-lidar-status'),vstatus=document.querySelector('#roof-lidar-visual-status'),btn=document.querySelector('#decode-roof-lidar'),badge=document.querySelector('#roof-lidar-badge');
 if(!saved.lidarEpt?.url||!saved.lidarSubset?.nodes?.length){if(status)status.textContent='Extract the roof LiDAR window first.';return}
 if(btn)btn.disabled=true;if(badge)badge.textContent='Decoding';if(status)status.textContent='Decoding compressed USGS LAZ points in a background worker…';
 try{
  const outline=await getAcceptedRoofOutline(saved),lat=Number(saved.lat),lng=Number(saved.lng),half=Number(saved.imageryCropHalfMeters||42),poly=roofPolyToMercator(outline,lat,lng,half);
  const nodes=[...saved.lidarSubset.nodes].sort((a,b)=>(b.depth||0)-(a.depth||0));let selected=[],budget=0;
  for(const n of nodes){if(selected.length>=36)break;if(budget+n.count>550000&&selected.length>=4)continue;selected.push(n);budget+=Number(n.count)||0}
  if(!selected.length)throw new Error('No EPT nodes are available to decode.');
  const worker=new Worker('/lidar-decode-worker.js?v=4'),result=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{worker.terminate();reject(new Error('LiDAR decoding timed out.'))},90000);
   worker.onmessage=e=>{const m=e.data||{};if(m.type==='progress'){if(status)status.textContent='Decoding LiDAR node '+m.current+' of '+m.total+' · '+Number(m.inside||0).toLocaleString()+' roof points found…';return}
    clearTimeout(timer);worker.terminate();m.type==='done'?resolve(m):reject(new Error(m.error||'LiDAR decoder failed.'))};
   worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message||'LiDAR worker error'))};
   worker.postMessage({type:'decode',eptUrl:saved.lidarEpt.url,nodes:selected,queryBounds:saved.lidarSubset.queryBounds,polygon:poly,maxDecoded:550000,grid:.45});
  });
  roofLidarDecoded={...result,polygon:poly,queryBounds:saved.lidarSubset.queryBounds};
  renderRoofLidar(result.surfacePoints,saved.lidarSubset.queryBounds,poly,result.minZ,result.maxZ);
  const zr=(result.minZ!=null&&result.maxZ!=null)?(result.maxZ-result.minZ).toFixed(2):'—';
  if(badge)badge.textContent='Points decoded';
  if(status)status.textContent='Roof LiDAR decoded ✓ · '+Number(result.inside||0).toLocaleString()+' points inside the accepted roof · '+Number(result.surfacePoints?.length||0).toLocaleString()+' surface cells retained.';
  if(vstatus)vstatus.textContent='Top-down LiDAR roof surface · elevation range '+zr+' m · brighter/warmer points are higher. White line is the accepted aerial roof outline.';
  const planePanel=document.querySelector('#roof-plane-panel');if(planePanel)planePanel.hidden=false;
  saved.lidarDecodedSummary={decoded:result.decoded,inside:result.inside,surfaceCells:result.surfacePoints?.length||0,minZ:result.minZ,maxZ:result.maxZ,decodedAt:new Date().toISOString()};
  localStorage.setItem('solarisRoofProject',JSON.stringify(saved));
 }catch(err){
  if(badge)badge.textContent='Decode failed';if(status)status.textContent='Could not decode roof points: '+err.message;if(vstatus)vstatus.textContent='';
 }finally{if(btn)btn.disabled=false}
}
document.querySelector('#decode-roof-lidar')?.addEventListener('click',decodeRoofLidar);

let roofPlaneProposals=[];
function fitPlane3(p1,p2,p3,ox,oy){
 const x1=p1.x-ox,y1=p1.y-oy,z1=p1.z,x2=p2.x-ox,y2=p2.y-oy,z2=p2.z,x3=p3.x-ox,y3=p3.y-oy,z3=p3.z;
 const den=x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2);if(Math.abs(den)<1e-9)return null;
 const a=(z1*(y2-y3)+z2*(y3-y1)+z3*(y1-y2))/den;
 const b=(z1*(x3-x2)+z2*(x1-x3)+z3*(x2-x1))/den;
 const c=(z1*(x2*y3-x3*y2)+z2*(x3*y1-x1*y3)+z3*(x1*y2-x2*y1))/den;
 return{a,b,c};
}
function planeResidual(p,pl,ox,oy){return Math.abs(p.z-(pl.a*(p.x-ox)+pl.b*(p.y-oy)+pl.c))}
function refinePlane(points,ox,oy){
 let sxx=0,syy=0,sxy=0,sx=0,sy=0,sxz=0,syz=0,sz=0,n=points.length;
 for(const p of points){const x=p.x-ox,y=p.y-oy,z=p.z;sxx+=x*x;syy+=y*y;sxy+=x*y;sx+=x;sy+=y;sxz+=x*z;syz+=y*z;sz+=z}
 const A=[[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],B=[sxz,syz,sz];
 for(let i=0;i<3;i++){let m=i;for(let j=i+1;j<3;j++)if(Math.abs(A[j][i])>Math.abs(A[m][i]))m=j;[A[i],A[m]]=[A[m],A[i]];[B[i],B[m]]=[B[m],B[i]];
  const d=A[i][i];if(Math.abs(d)<1e-10)return null;for(let j=i;j<3;j++)A[i][j]/=d;B[i]/=d;
  for(let k=0;k<3;k++)if(k!==i){const f=A[k][i];for(let j=i;j<3;j++)A[k][j]-=f*A[i][j];B[k]-=f*B[i]}
 }
 return{a:B[0],b:B[1],c:B[2]};
}
function lcg(seed){let s=seed>>>0;return()=>((s=(1664525*s+1013904223)>>>0)/4294967296)}
function fitRoofPlanesFromPoints(points){
 if(!points||points.length<120)throw new Error('Not enough roof surface points to fit planes.');
 const ox=points.reduce((s,p)=>s+p.x,0)/points.length,oy=points.reduce((s,p)=>s+p.y,0)/points.length;
 let remaining=points.map((p,i)=>({...p,_i:i})),planes=[],rand=lcg(24681357),facetId=1;
 while(remaining.length>=90&&planes.length<10){
  let best=null,bestInliers=[];
  const iterations=Math.min(900,Math.max(350,remaining.length));
  for(let it=0;it<iterations;it++){
   const p1=remaining[Math.floor(rand()*remaining.length)],p2=remaining[Math.floor(rand()*remaining.length)],p3=remaining[Math.floor(rand()*remaining.length)];
   const pl=fitPlane3(p1,p2,p3,ox,oy);if(!pl)continue;
   const slope=Math.hypot(pl.a,pl.b);if(slope>.95)continue;
   const ins=[];for(const p of remaining)if(planeResidual(p,pl,ox,oy)<.18)ins.push(p);
   if(ins.length>bestInliers.length){best=pl;bestInliers=ins}
  }
  if(!best||bestInliers.length<80)break;
  const refined=refinePlane(bestInliers,ox,oy)||best;
  const inliers=remaining.filter(p=>planeResidual(p,refined,ox,oy)<.20);
  if(inliers.length<80)break;
  const set=new Set(inliers.map(p=>p._i));remaining=remaining.filter(p=>!set.has(p._i));
  const slope=Math.hypot(refined.a,refined.b),slopeDeg=Math.atan(slope)*180/Math.PI,pitch12=12*slope;
  let az=(Math.atan2(refined.a,refined.b)*180/Math.PI+360)%360;
  let rmse=Math.sqrt(inliers.reduce((s,p)=>{const r=planeResidual(p,refined,ox,oy);return s+r*r},0)/inliers.length);
  const xs=inliers.map(p=>p.x),ys=inliers.map(p=>p.y);
  planes.push({id:'facet-'+facetId++,accepted:true,pointCount:inliers.length,pitch12,slopeDeg,azimuthDeg:az,rmse,coefficients:refined,bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)},points:inliers});
 }
 return planes.sort((a,b)=>b.pointCount-a.pointCount);
}
function renderRoofPlanePreview(){
 if(!roofLidarDecoded?.surfacePoints?.length)return;
 const canvas=document.querySelector('#roof-lidar-canvas');if(!canvas)return;
 const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,q=roofLidarDecoded.queryBounds;
 ctx.fillStyle='#111';ctx.fillRect(0,0,w,h);
 const sx=x=>(x-q[0])/(q[2]-q[0])*w,sy=y=>h-(y-q[1])/(q[3]-q[1])*h;
 const palette=['#ef4444','#22c55e','#3b82f6','#f59e0b','#a855f7','#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6'];
 const assigned=new Map();roofPlaneProposals.forEach((pl,i)=>pl.points?.forEach(p=>assigned.set(p._i,palette[i%palette.length])));
 for(const p of roofLidarDecoded.surfacePoints){ctx.fillStyle=assigned.get(p._i)||'#555';ctx.fillRect(sx(p.x)-2,sy(p.y)-2,4,4)}
 if(roofLidarDecoded.polygon?.length){ctx.beginPath();roofLidarDecoded.polygon.forEach((p,i)=>{const x=sx(p.x),y=sy(p.y);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke()}
}
function renderRoofPlaneList(){
 const list=document.querySelector('#roof-plane-list'),count=document.querySelector('#roof-plane-count');if(count)count.textContent=roofPlaneProposals.length+' facets';
 if(!list)return;
 list.innerHTML=roofPlaneProposals.map((p,i)=>'<div style="display:grid;grid-template-columns:minmax(90px,1fr) repeat(4,minmax(70px,auto));gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #e5e7eb"><label><input type="checkbox" data-plane-accept="'+i+'" '+(p.accepted?'checked':'')+'> <strong>Facet '+(i+1)+'</strong></label><span>'+p.pointCount+' pts</span><span>'+p.pitch12.toFixed(1)+'/12</span><span>'+p.slopeDeg.toFixed(1)+'°</span><span>RMSE '+p.rmse.toFixed(2)+'m</span></div>').join('');
 list.querySelectorAll('input[data-plane-accept]').forEach(el=>el.addEventListener('change',e=>{roofPlaneProposals[+e.target.dataset.planeAccept].accepted=e.target.checked}));
}
function fitRoofPlanes(){
 const status=document.querySelector('#roof-plane-status'),accept=document.querySelector('#accept-roof-planes');
 if(!roofLidarDecoded?.surfacePoints?.length){if(status)status.textContent='Decode roof points first.';return}
 if(status)status.textContent='Fitting planar roof surfaces from LiDAR…';
 try{
  const pts=roofLidarDecoded.surfacePoints.map((p,i)=>({...p,_i:i}));
  roofLidarDecoded.surfacePoints=pts;
  roofPlaneProposals=fitRoofPlanesFromPoints(pts);
  renderRoofPlanePreview();renderRoofPlaneList();
  if(!roofPlaneProposals.length)throw new Error('No stable roof planes were found.');
  if(accept)accept.disabled=false;
  if(status)status.textContent='Found '+roofPlaneProposals.length+' LiDAR plane proposal'+(roofPlaneProposals.length===1?'':'s')+'. Review pitch/RMSE, uncheck bad facets, then Accept Facets.';
 }catch(err){if(status)status.textContent='Plane fitting failed: '+err.message}
}
document.querySelector('#fit-roof-planes')?.addEventListener('click',fitRoofPlanes);
function convexHullRoof(points){
 const pts=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);if(pts.length<=3)return pts;
 const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
 const lo=[];for(const p of pts){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
 const hi=[];for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p)}
 lo.pop();hi.pop();return lo.concat(hi);
}
function lidarPointToAerialNorm(p,saved){
 const center=roofMercator(Number(saved.lat),Number(saved.lng)),half=Number(saved.imageryCropHalfMeters||42),size=half*2;
 return{x:.5+(p.x-center.x)/size,y:.5-(p.y-center.y)/size};
}
document.querySelector('#accept-roof-planes')?.addEventListener('click',async()=>{
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},status=document.querySelector('#roof-plane-status'),btn=document.querySelector('#accept-roof-planes');
 if(!roofPlaneProposals.length)return;
 const acceptedPlanes=roofPlaneProposals.filter(p=>p.accepted);
 if(!acceptedPlanes.length){if(status)status.textContent='Select at least one facet before accepting.';return}
 if(btn)btn.disabled=true;
 const fetchWithTimeout=async(url,options={},ms=12000)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);
  try{return await fetch(url,{...options,signal:controller.signal})}
  finally{clearTimeout(timer)}
 };
 try{
  const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
  let outline=roofOutlineProposal?.polygon;
  let planMetrics=outline?.length>=3?localRoofPlanMetrics(outline,Number(saved.lat),saved.imageryCropHalfMeters||42):null;

  if(!planMetrics){
   if(status)status.textContent='Loading accepted roof outline…';
   const rr=await fetchWithTimeout('/api/roof-outline?projectId='+encodeURIComponent(projectId),{},10000);
   const rd=await rr.json().catch(()=>({}));
   if(!rr.ok||!rd.outline?.polygon?.length)throw new Error(rd.error||'Accepted roof outline is required before facets can be saved.');
   outline=rd.outline.polygon;
   planMetrics=rd.outline.measurement;
  }

  const totalPts=acceptedPlanes.reduce((s,p)=>s+Number(p.pointCount||0),0)||1;
  const payload=roofPlaneProposals.map(p=>{
   const hull=convexHullRoof((p.points||[]).map(q=>({x:q.x,y:q.y})));
   const polygon=hull.map(q=>lidarPointToAerialNorm(q,saved)).filter(q=>Number.isFinite(q.x)&&Number.isFinite(q.y));
   const share=p.accepted?Number(p.pointCount||0)/totalPts:0;
   const planAreaFt2=p.accepted?Number(planMetrics.planAreaFt2)*share:0;
   const slopedAreaFt2=planAreaFt2*Math.sqrt(1+Math.pow(Number(p.pitch12||0)/12,2));
   return{id:p.id,accepted:p.accepted,pointCount:p.pointCount,pitch12:p.pitch12,slopeDeg:p.slopeDeg,azimuthDeg:p.azimuthDeg,rmse:p.rmse,coefficients:p.coefficients,bounds:p.bounds,polygon,planAreaFt2,slopedAreaFt2};
  });

  if(status)status.textContent='Saving accepted LiDAR roof facets…';
  const r=await fetchWithTimeout('/api/roof-planes',{
   method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({projectId,address:saved.address,planes:payload})
  },12000);
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Could not save roof facets.');

  const accepted=payload.filter(p=>p.accepted);
  const avgPitch=accepted.reduce((s,p)=>s+Number(p.pitch12||0),0)/accepted.length;
  const totalSloped=accepted.reduce((s,p)=>s+Number(p.slopedAreaFt2||0),0);
  const squares=totalSloped/100;
  let displayPitch=Math.round(avgPitch);
  try{
   const sr=await fetch('/api/roof-solar-model?projectId='+encodeURIComponent(projectId));
   const sd=await sr.json();
   if(sr.ok&&sd.model?.accepted){
    const sf=sd.model.model?.facets||[];
    const wt=sf.reduce((s,p)=>s+Number(p.slopedAreaSqFt||p.flatAreaSqFt||0),0);
    const dsmPitch=sf.length?(wt>0?sf.reduce((s,p)=>s+Number(p.rise12||0)*Number(p.slopedAreaSqFt||p.flatAreaSqFt||0),0)/wt:sf.reduce((s,p)=>s+Number(p.rise12||0),0)/sf.length):Number(sd.model.model?.rise12||0);
    if(Number.isFinite(dsmPitch)&&dsmPitch>0)displayPitch=Math.round(dsmPitch);
   }
  }catch{}
  const fc=document.querySelector('#roof-facets'),pit=document.querySelector('#roof-pitch'),sq=document.querySelector('#roof-squares');
  if(fc)fc.textContent=accepted.length;
  if(pit)pit.textContent=displayPitch+'/12';
  if(sq)sq.textContent=squares.toFixed(2)+' sq';
  const takeoff=document.querySelector('#roof-takeoff'),reportInline=document.querySelector('#roof-report-inline'),reportMain=document.querySelector('#roof-report-main');
  if(takeoff)takeoff.disabled=false;
  if(reportInline)reportInline.disabled=false;
  if(reportMain)reportMain.disabled=false;
  if(status)status.textContent='LiDAR facets accepted ✓ · '+accepted.length+' facets · '+Math.round(totalSloped).toLocaleString()+' ft² sloped area · '+squares.toFixed(2)+' squares. Report is ready.';
 }catch(err){
  const msg=err?.name==='AbortError'?'The save request timed out. Please try Accept Facets again.':(err?.message||String(err));
  if(status)status.textContent='Could not accept facets: '+msg;
 }finally{
  if(btn)btn.disabled=false;
 }
});

function escRoof(v){return String(v??'').replace(/[&<>"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]))}
function roofNormLengthFt(a,b,outline){
 const size=Number(outline.cropHalfMeters||42)*2,k=Math.cos(Number(outline.lat)*Math.PI/180);
 return Math.hypot(Number(b.x)-Number(a.x),Number(b.y)-Number(a.y))*size*k*3.280839895;
}
function roofCentroid(poly){if(!poly?.length)return{x:.5,y:.5};return{x:poly.reduce((s,p)=>s+p.x,0)/poly.length,y:poly.reduce((s,p)=>s+p.y,0)/poly.length}}
function roofDiagramSvg(data){
 const sm=data.solarModel||null;
 if(sm?.outline?.length>=3&&sm?.model?.facets?.length){
  const topology=data.topology||null,outline=sm.outline,facets=sm.model.facets||[],lines=sm.model.roofLines||[],rawExteriorEdges=sm.measurements?.exteriorEdges||[];
  const all=topology?.vertices?.length?topology.vertices:[...outline,...facets.flatMap(f=>f.outline||[]),...lines.flatMap(l=>[l.a,l.b]).filter(Boolean)];
  const lats=all.map(p=>Number(p.lat)).filter(Number.isFinite),lngs=all.map(p=>Number(p.lng)).filter(Number.isFinite);
  const north=Math.max(...lats),south=Math.min(...lats),east=Math.max(...lngs),west=Math.min(...lngs);
  const midLat=(north+south)/2*Math.PI/180,cos=Math.max(.2,Math.cos(midLat));
  const width=Math.max(1e-9,(east-west)*cos),height=Math.max(1e-9,north-south),scale=820/Math.max(width,height);
  const drawW=width*scale,drawH=height*scale,ox=(1000-drawW)/2,oy=(1000-drawH)/2;
  const pt=p=>({x:ox+((Number(p.lng)-west)*cos)*scale,y:oy+(north-Number(p.lat))*scale});
  const P=p=>{const q=pt(p);return q.x.toFixed(1)+','+q.y.toFixed(1)};
  const fills=['#e8eef5','#dbe7f0','#e6e2f3','#e3efe7','#f2e8dc','#e0ebeb','#eee5e5','#e5e5ef','#edf0df','#e7e7e7'];
  const lc={ridge:'#198754',hip:'#2563eb',valley:'#dc2626'};
  let s='<svg viewBox="0 0 1000 1000" role="img" aria-label="Hybrid 2D roof measurement diagram"><rect width="1000" height="1000" fill="#fff"/>';
  if(topology?.faces?.length&&topology?.vertices?.length){
   const vById=new Map(topology.vertices.map(v=>[v.id,v]));
   topology.faces.forEach((face,i)=>{
    const poly=face.vertexIds.map(id=>vById.get(id)).filter(Boolean);if(poly.length<3)return;
    const q=poly.map(pt),cx=q.reduce((a,p)=>a+p.x,0)/q.length,cy=q.reduce((a,p)=>a+p.y,0)/q.length;
    s+='<polygon points="'+poly.map(P).join(' ')+'" fill="'+fills[i%fills.length]+'" stroke="#444" stroke-width="3"/>';
    s+='<text x="'+cx.toFixed(1)+'" y="'+cy.toFixed(1)+'" text-anchor="middle" font-size="24" font-weight="700" fill="#111">F'+face.id+'</text>';
    s+='<text x="'+cx.toFixed(1)+'" y="'+(cy+28).toFixed(1)+'" text-anchor="middle" font-size="18" fill="#333">'+Math.round(Number(face.rise12||0))+'/12 · '+Math.round(Number(face.slopedAreaSqFt||0))+' ft²</text>';
   });
   topology.edges.forEach(e=>{
    const a=vById.get(e.a),b=vById.get(e.b);if(!a||!b)return;
    const pa=pt(a),pb=pt(b),isPerimeter=e.type==='perimeter',stroke=isPerimeter?'#111':(lc[e.type]||'#555'),width=7;
    s+='<line x1="'+pa.x.toFixed(1)+'" y1="'+pa.y.toFixed(1)+'" x2="'+pb.x.toFixed(1)+'" y2="'+pb.y.toFixed(1)+'" stroke="'+stroke+'" stroke-width="'+width+'"/>';
    if(isPerimeter&&Number(e.lengthMeters||0)>0){
      const mx=(pa.x+pb.x)/2,my=(pa.y+pb.y)/2,lenFt=Number(e.lengthMeters)*3.280839895;
      s+='<text x="'+mx.toFixed(1)+'" y="'+(my-8).toFixed(1)+'" text-anchor="middle" font-size="15" font-weight="600" fill="#111" stroke="#fff" stroke-width="5" paint-order="stroke">'+lenFt.toFixed(1)+' ft</text>';
    }
   });
  }else{
   facets.forEach((f,i)=>{
    const poly=f.outline||[];if(poly.length<3)return;
    const q=poly.map(pt),cx=q.reduce((a,p)=>a+p.x,0)/q.length,cy=q.reduce((a,p)=>a+p.y,0)/q.length;
    s+='<polygon points="'+poly.map(P).join(' ')+'" fill="'+fills[i%fills.length]+'" stroke="#444" stroke-width="3"/>';
    s+='<text x="'+cx.toFixed(1)+'" y="'+cy.toFixed(1)+'" text-anchor="middle" font-size="24" font-weight="700" fill="#111">F'+(i+1)+'</text>';
    s+='<text x="'+cx.toFixed(1)+'" y="'+(cy+28).toFixed(1)+'" text-anchor="middle" font-size="18" fill="#333">'+Math.round(Number(f.rise12||0))+'/12 · '+Math.round(Number(f.slopedAreaSqFt||0))+' ft²</text>';
   });
   s+='<polygon points="'+outline.map(P).join(' ')+'" fill="none" stroke="#111" stroke-width="7"/>';
   lines.filter(l=>['ridge','hip','valley'].includes(l.type)).forEach(l=>{
    const a=pt(l.a),b=pt(l.b);
    s+='<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" stroke="'+lc[l.type]+'" stroke-width="7"/>';
   });
  }
  if(!topology?.edges?.length)rawExteriorEdges.forEach(e=>{
   const a=pt(e.a),b=pt(e.b),mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
   s+='<text x="'+mx.toFixed(1)+'" y="'+(my-7).toFixed(1)+'" text-anchor="middle" font-size="15" font-weight="600" fill="#111" stroke="#fff" stroke-width="5" paint-order="stroke">'+Number(e.lengthFt||0).toFixed(1)+' ft</text>';
  });
  s+='<g transform="translate(28 935)" font-size="17" fill="#111"><text x="0" y="0">Geometry: paired-evidence topology with shared roof-line junctions</text><text x="0" y="26">Shared vertices/edges enforce one connected roof model; LiDAR remains an independent 3D validation source</text></g></svg>';
  return s;
 }
 const outline=data.outline,poly=outline.polygon||[],planes=(data.planes?.planes||[]).filter(p=>p.accepted),geom=(data.geometry?.lines||[]).filter(l=>l.type!=='ignore'&&l.type!=='candidate');
 const P=p=>(Number(p.x)*1000).toFixed(1)+','+(Number(p.y)*1000).toFixed(1);
 const fills=['#e8eef5','#dbe7f0','#e6e2f3','#e3efe7','#f2e8dc','#e0ebeb','#eee5e5','#e5e5ef','#edf0df','#e7e7e7'];
 let s='<svg viewBox="0 0 1000 1000" role="img" aria-label="2D roof measurement diagram"><rect width="1000" height="1000" fill="#fff"/>';
 planes.forEach((f,i)=>{if(!f.polygon?.length)return;const cc=roofCentroid(f.polygon);s+='<polygon points="'+f.polygon.map(P).join(' ')+'" fill="'+fills[i%fills.length]+'" stroke="#444" stroke-width="3"/>';s+='<text x="'+(cc.x*1000).toFixed(1)+'" y="'+(cc.y*1000).toFixed(1)+'" text-anchor="middle" font-size="24" font-weight="700" fill="#111">F'+(i+1)+'</text><text x="'+(cc.x*1000).toFixed(1)+'" y="'+(cc.y*1000+28).toFixed(1)+'" text-anchor="middle" font-size="18" fill="#333">'+Number(f.pitch12).toFixed(1)+'/12 · '+Math.round(f.slopedAreaFt2||0)+' ft²</text>'});
 s+='<polygon points="'+poly.map(P).join(' ')+'" fill="none" stroke="#111" stroke-width="7"/>';
 for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],mx=(a.x+b.x)/2,my=(a.y+b.y)/2,len=roofNormLengthFt(a,b,outline);s+='<text x="'+(mx*1000).toFixed(1)+'" y="'+(my*1000-8).toFixed(1)+'" text-anchor="middle" font-size="16" font-weight="600" fill="#111" stroke="#fff" stroke-width="5" paint-order="stroke">'+len.toFixed(1)+' ft</text>'}
 const lc={ridge:'#198754',hip:'#2563eb',valley:'#dc2626'};
 geom.forEach(l=>{s+='<line x1="'+(l.a.x*1000)+'" y1="'+(l.a.y*1000)+'" x2="'+(l.b.x*1000)+'" y2="'+(l.b.y*1000)+'" stroke="'+(lc[l.type]||'#555')+'" stroke-width="6"/>'});
 s+='<g transform="translate(28 940)" font-size="17" fill="#111"><text x="0" y="0">Perimeter dimensions shown in feet</text><text x="0" y="26">F# = LiDAR facet · pitch /12 · sloped facet area</text></g></svg>';
 return s;
}
function roofLineTotals(data){
 const sm=data.solarModel||null,out={ridge:0,hip:0,valley:0,eave:0,rake:0};
 if(sm?.measurements)return{
  ridge:Number(sm.measurements.ridgeFt||0),
  hip:Number(sm.measurements.hipFt||0),
  valley:Number(sm.measurements.valleyFt||0),
  eave:Number(sm.measurements.eaveFt||0),
  rake:Number(sm.measurements.rakeFt||0)
 };
 const lines=data.geometry?.lines||[];
 for(const l of lines){if(out[l.type]==null)continue;out[l.type]+=roofNormLengthFt(l.a,l.b,data.outline)}
 return out;
}
function physicalExteriorTotalsForReport(sm){
 const edges=sm?.measurements?.exteriorEdges||[],facets=sm?.model?.facets||[];
 if(!edges.length||!facets.length)return null;
 const ll=(p,k)=>Number(p?.[k]??p?.[k==="lat"?"latitude":"longitude"]);
 const zAt=(f,p)=>{
  const lat=ll(p,"lat"),lng=ll(p,"lng"),clat=ll(f?.center,"lat"),clng=ll(f?.center,"lng");
  if(![lat,lng,clat,clng].every(Number.isFinite))return NaN;
  const lat0=clat*Math.PI/180,east=(lng-clng)*111320*Math.cos(lat0),north=(lat-clat)*111320;
  const z=Number(f?.z0),ge=Number(f?.gradientEast),gn=Number(f?.gradientNorth);
  return [z,ge,gn].every(Number.isFinite)?z-ge*east-gn*north:NaN;
 };
 let eave=0,rake=0,used=0;
 for(const ed of edges){
  const len=Number(ed?.lengthFt);
  if(!Number.isFinite(len))continue;
  const facet=facets.find(f=>Number(f?.index)===Number(ed?.facetIndex));
  let type=ed?.type==="rake"?"rake":"eave";
  if(facet&&ed?.a&&ed?.b){
   const zs=(facet.outline||[]).map(p=>zAt(facet,p)).filter(Number.isFinite);
   const za=zAt(facet,ed.a),zb=zAt(facet,ed.b);
   if(zs.length>=2&&Number.isFinite(za)&&Number.isFinite(zb)){
    const mn=Math.min(...zs),mx=Math.max(...zs),range=Math.max(.05,mx-mn);
    const verticalSpan=Math.abs(zb-za)/range;
    const midpointLevel=(((za+zb)/2)-mn)/range;
    type=verticalSpan>=.15&&midpointLevel>=.05?"rake":"eave";
   }
  }
  if(type==="rake")rake+=len;else eave+=len;
  used++;
 }
 return used?{eave,rake}:null;
}

function confidenceInternalTotalsForReport(sm){
 const roofLines=sm?.model?.roofLines;
 if(!Array.isArray(roofLines))return null;
 let hip=0,valley=0;
 for(const l of roofLines){
  const lenFt=Number(l?.length3dMeters||l?.lengthMeters||0)*3.280839895;
  if(l?.type==="hip"){
   const plane=Math.abs(Number(l?.planeStrength||0));
   const crease=Math.abs(Number(l?.creaseStrength||0));
   if(lenFt>=5&&plane>=.45&&crease>=.06)hip+=lenFt;
  }else if(l?.type==="valley"){
   const trace=Number(l?.traceStrength||0);
   const crease=Math.abs(Number(l?.creaseStrength||0));
   if(trace>=.15&&crease>=.10)valley+=lenFt;
  }
 }
 return {hip,valley};
}
async function generateRoofReport(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},panel=document.querySelector('#roof-report-panel'),content=document.querySelector('#roof-report-content'),state=document.querySelector('#roof-state'),topBtn=document.querySelector('#roof-takeoff'),inlineBtn=document.querySelector('#roof-report-inline');
 const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 if(state)state.textContent='Building roof measurement report…';
 const oldTop=topBtn?.textContent,oldInline=inlineBtn?.textContent;
 if(topBtn){topBtn.disabled=true;topBtn.textContent='Building Report…'}
 if(inlineBtn){inlineBtn.disabled=true;inlineBtn.textContent='Building Report…'}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const r=await fetch('/api/roof-report?projectId='+encodeURIComponent(projectId),{signal:controller.signal}),d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Report data is incomplete.');
  const facets=(d.planes?.planes||[]).filter(p=>p.accepted),plan=Number(d.outline.measurement?.planAreaFt2||0),basePerim=Number(d.outline.measurement?.perimeterFt||0);
  const sm=d.solarModel||null,dm=sm?.measurements||{},dsmFacets=sm?.model?.facets||[];
  if(sm?.model?.facets?.length){
   try{
    const topo=await import('/assets/js/roof-topology.js?v=20261002-opt1');
    let profileOverrides={};
    try{
     const cr=await fetch('/api/training-topology-optimizer',{cache:'no-store'}),cd=await cr.json().catch(()=>({}));
     const cfg=cd?.config||null;
     profileOverrides=(cfg?.version==='topology-opt-3-holdout'&&cfg?.scopePolicy==='primary-building-only'&&cfg?.validationPolicy==='deterministic-profile-holdout')?(cfg.profileOverrides||{}):{};
    }catch{}
    d.topology=topo.buildRoofTopology(sm,{profileOverrides});
   }catch(err){console.warn('Roof topology engine unavailable',err)}
  }
  const topologyPerimFt=(d.topology?.edges||[]).filter(e=>e.type==='perimeter').reduce((s,e)=>s+Number(e.lengthMeters||0)*3.280839895,0);
  const lines=roofLineTotals(d);
  const promotedRasterRidge=Number(sm?.measurementCandidates?.rasterLines?.ridgeFt);
  if(Number.isFinite(promotedRasterRidge)&&promotedRasterRidge>=0)lines.ridge=promotedRasterRidge;
  const confidenceInternal=confidenceInternalTotalsForReport(sm);
  if(confidenceInternal){lines.hip=confidenceInternal.hip;lines.valley=confidenceInternal.valley;}
  const physicalExterior=physicalExteriorTotalsForReport(sm);
  if(physicalExterior){lines.eave=physicalExterior.eave;lines.rake=physicalExterior.rake;}
  const roofEdgePerimFt=Number(lines.eave||0)+Number(lines.rake||0);
  const perim=roofEdgePerimFt>0?roofEdgePerimFt:(topologyPerimFt>0?topologyPerimFt:basePerim);
  const lidarSloped=facets.reduce((s,p)=>s+Number(p.slopedAreaFt2||0),0);
  const dsmSloped=Number(sm?.model?.slopedAreaSqFt||0);
  const googleWholeSloped=Number(sm?.googleWholeRoofAreaFt2||0);
  const footprintArea=Number(sm?.model?.footprintSqFt||plan||0);
  const wholePitch=v=>Math.round(Number(v)||0);
  const pitchWeightTotal=dsmFacets.reduce((s,f)=>s+Number(f.slopedAreaSqFt||f.flatAreaSqFt||0),0);
  const rawAvgPitch=dsmFacets.length
   ?(pitchWeightTotal>0?dsmFacets.reduce((s,f)=>s+Number(f.rise12||0)*Number(f.slopedAreaSqFt||f.flatAreaSqFt||0),0)/pitchWeightTotal:dsmFacets.reduce((s,f)=>s+Number(f.rise12||0),0)/dsmFacets.length)
   :(facets.length?facets.reduce((s,p)=>s+Number(p.pitch12||0),0)/facets.length:0);
  const avgPitch=wholePitch(rawAvgPitch);
  const googleToDsm=(googleWholeSloped>0&&dsmSloped>0)?googleWholeSloped/dsmSloped:null;
  const googleAreaSane=googleWholeSloped>0
    &&(googleToDsm==null||(googleToDsm>=.55&&googleToDsm<=1.8))
    &&(!footprintArea||googleWholeSloped/footprintArea<=3);
  const footprintPitchArea=footprintArea>0
    ?footprintArea*Math.sqrt(1+Math.pow(rawAvgPitch/12,2))
    :0;
  const areaCandidates=[
    googleAreaSane?googleWholeSloped:0,
    dsmSloped>0?dsmSloped:0,
    footprintPitchArea>0?footprintPitchArea:0
  ].filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  const consensusArea=areaCandidates.length===1?areaCandidates[0]
    :areaCandidates.length%2?areaCandidates[(areaCandidates.length-1)/2]
    :(areaCandidates[areaCandidates.length/2-1]+areaCandidates[areaCandidates.length/2])/2;
  const sloped=consensusArea>0?consensusArea:(lidarSloped>0?lidarSloped:dsmSloped),squares=sloped/100;
  const reportFacetCount=Number(dsmFacets.length||facets.length||d.topology?.faces?.length||0);
  const waste=[10,12,15].map(w=>({w,area:sloped*(1+w/100),sq:squares*(1+w/100)}));
  const facetRows=(dsmFacets.length?dsmFacets:facets).map((p,i)=>{
   const isDsm=dsmFacets.length>0,pitch=wholePitch(isDsm?p.rise12:p.pitch12),slope=isDsm?Number(p.pitchDegrees||0):Number(p.slopeDeg||0),planArea=isDsm?Number(p.flatAreaSqFt||0):Number(p.planAreaFt2||0),slopedArea=isDsm?Number(p.slopedAreaSqFt||0):Number(p.slopedAreaFt2||0);
   return '<tr><td>F'+(i+1)+'</td><td>'+pitch+'/12</td><td>'+slope.toFixed(1)+'°</td><td>'+Math.round(planArea).toLocaleString()+'</td><td>'+Math.round(slopedArea).toLocaleString()+'</td><td>'+(isDsm?'DSM':'LiDAR '+Number(p.rmse||0).toFixed(2)+' m')+'</td></tr>';
  }).join('');
  const v=d.validation||{};
  const dsmGeometryBlock=sm?.model?.facets?.length
   ?('<h2>Accepted Google DSM Geometry</h2><table class="roof-report-table"><tbody>'+
     '<tr><th>Solaris consensus area</th><td>'+Math.round(sloped).toLocaleString()+' ft²</td></tr>'+
     '<tr><th>Google whole-roof area</th><td>'+(Number.isFinite(Number(sm.googleWholeRoofAreaFt2))?Math.round(Number(sm.googleWholeRoofAreaFt2)).toLocaleString()+' ft²':'—')+'</td></tr>'+
     '<tr><th>DSM surface area</th><td>'+Math.round(Number(sm.model?.slopedAreaSqFt||0)).toLocaleString()+' ft²</td></tr>'+
     '<tr><th>Footprint × pitch area</th><td>'+(footprintPitchArea>0?Math.round(footprintPitchArea).toLocaleString()+' ft²':'—')+'</td></tr>'+
     '<tr><th>DSM average pitch</th><td>'+wholePitch(sm.model?.rise12||avgPitch)+'/12</td></tr>'+
     '<tr><th>DSM facets</th><td>'+Number(sm.model?.facets?.length||0)+'</td></tr>'+
     '<tr><th>Eave</th><td>'+fmtHybridFt(lines.eave)+'</td></tr>'+
     '<tr><th>Rake</th><td>'+fmtHybridFt(lines.rake)+'</td></tr>'+
     '<tr><th>Ridge</th><td>'+fmtHybridFt(lines.ridge)+'</td></tr>'+
     '<tr><th>Hip</th><td>'+fmtHybridFt(lines.hip)+'</td></tr>'+
     '<tr><th>Valley</th><td>'+fmtHybridFt(lines.valley)+'</td></tr>'+
     '</tbody></table><p class="roof-report-note">These measurements come from the Google rooftop-mask/DSM geometry used as the primary roof model. LiDAR is retained as an independent 3D cross-check.</p>')
   :'';
  const validationBlock=v.available
   ?('<h2>Hybrid Validation</h2><table class="roof-report-table"><tbody>'+
     '<tr><th>Google Solar whole-roof area</th><td>'+(Number.isFinite(Number(v.googleWholeRoofAreaFt2))?Math.round(Number(v.googleWholeRoofAreaFt2)).toLocaleString()+' ft²':'—')+'</td></tr>'+
     '<tr><th>Solaris report area</th><td>'+Math.round(sloped).toLocaleString()+' ft²</td></tr><tr><th>LiDAR cross-check area</th><td>'+Math.round(lidarSloped).toLocaleString()+' ft²</td></tr>'+
     '<tr><th>Area difference</th><td>'+(Number.isFinite(Number(v.areaDifferencePct))?Number(v.areaDifferencePct).toFixed(1)+'%':'—')+'</td></tr>'+
     '<tr><th>Google weighted pitch</th><td>'+(Number.isFinite(Number(v.googleWeightedPitchDeg))?Number(v.googleWeightedPitchDeg).toFixed(1)+'°':'—')+'</td></tr>'+
     '<tr><th>LiDAR weighted pitch</th><td>'+(Number.isFinite(Number(v.lidarWeightedPitchDeg))?Number(v.lidarWeightedPitchDeg).toFixed(1)+'°':'—')+'</td></tr>'+
     '<tr><th>Facet count</th><td>LiDAR '+Number(v.lidarFacetCount||0)+' · Google '+Number(v.googleFacetCount||0)+'</td></tr>'+
     '</tbody></table>'+
     (Array.isArray(v.warnings)&&v.warnings.length?'<div class="analysis-state"><strong>Review warnings</strong><br>'+v.warnings.map(escRoof).join('<br>')+'</div>':'<div class="analysis-state"><strong>Cross-check passed</strong><br>No material Google Solar / LiDAR disagreement was detected by the current thresholds.</div>'))
   :('<h2>Hybrid Validation</h2><div class="analysis-state">Google Solar cross-check unavailable'+(v.error?': '+escRoof(v.error):'.')+'</div>');
  content.innerHTML='<div class="roof-report-sheet">'+
   '<div class="roof-report-head"><div><div class="roof-report-brand">SOLARIS ROOFING</div><h1>Roof Measurement Report</h1><p>'+escRoof(d.outline.address||saved.address||'')+'</p></div><div style="text-align:right"><strong>Solaris Measure</strong><br><span>Generated '+new Date().toLocaleDateString()+'</span><br><span>Hybrid DSM + LiDAR geometry</span></div></div>'+
   '<div class="roof-report-grid"><div class="roof-report-stat"><span>Plan area</span><strong>'+Math.round(plan).toLocaleString()+' ft²</strong></div><div class="roof-report-stat"><span>Sloped roof area</span><strong>'+Math.round(sloped).toLocaleString()+' ft²</strong></div><div class="roof-report-stat"><span>Roofing squares</span><strong>'+squares.toFixed(2)+'</strong></div><div class="roof-report-stat"><span>Roof perimeter</span><strong>'+perim.toFixed(1)+' ft</strong></div><div class="roof-report-stat"><span>Facets</span><strong>'+reportFacetCount+'</strong></div><div class="roof-report-stat"><span>Average pitch</span><strong>'+avgPitch.toFixed(1)+'/12</strong></div><div class="roof-report-stat"><span>Ridge</span><strong>'+(lines.ridge?lines.ridge.toFixed(1)+' ft':'Not verified')+'</strong></div><div class="roof-report-stat"><span>Valley</span><strong>'+(lines.valley?lines.valley.toFixed(1)+' ft':'Not verified')+'</strong></div></div>'+
   '<h2>2D Roof Diagram</h2><div class="roof-diagram-wrap">'+roofDiagramSvg(d)+'</div>'+
   '<h2>Facet Measurements</h2><table class="roof-report-table"><thead><tr><th>Facet</th><th>Pitch</th><th>Slope</th><th>Plan ft²</th><th>Sloped ft²</th><th>Source / fit</th></tr></thead><tbody>'+facetRows+'</tbody></table>'+
   '<h2>Linear Measurements</h2><table class="roof-report-table"><tbody><tr><th>Roof perimeter</th><td>'+perim.toFixed(1)+' ft</td></tr><tr><th>Ridge</th><td>'+(lines.ridge?lines.ridge.toFixed(1)+' ft':'Not yet verified')+'</td></tr><tr><th>Hip</th><td>'+(lines.hip?lines.hip.toFixed(1)+' ft':'Not yet verified')+'</td></tr><tr><th>Valley</th><td>'+(lines.valley?lines.valley.toFixed(1)+' ft':'Not yet verified')+'</td></tr><tr><th>Eave</th><td>'+(lines.eave?lines.eave.toFixed(1)+' ft':'Not yet verified')+'</td></tr><tr><th>Rake</th><td>'+(lines.rake?lines.rake.toFixed(1)+' ft':'Not yet verified')+'</td></tr></tbody></table>'+
   '<h2>Waste / Ordering Area</h2><table class="roof-report-table"><thead><tr><th>Waste</th><th>Order area</th><th>Squares</th></tr></thead><tbody><tr><td>0%</td><td>'+Math.round(sloped).toLocaleString()+' ft²</td><td>'+squares.toFixed(2)+'</td></tr>'+waste.map(x=>'<tr><td>'+x.w+'%</td><td>'+Math.round(x.area).toLocaleString()+' ft²</td><td>'+x.sq.toFixed(2)+'</td></tr>').join('')+'</tbody></table>'+
   dsmGeometryBlock+
   validationBlock+
   '<p class="roof-report-note">Accepted Google DSM geometry is the primary source for roof facet shape, pitch and roof-line classification in this report. USGS 3DEP LiDAR remains an independent 3D cross-check for elevation planes, area and geometry consistency.</p></div>';
  if(panel){panel.hidden=false;panel.scrollIntoView({behavior:'smooth',block:'start'});}
  if(state)state.textContent='Roof measurement report ready.';
  loadRoofBenchmark();
 }catch(err){
  const msg=err?.name==='AbortError'?'Report generation timed out. The saved DSM/LiDAR data is intact; try again.':(err?.message||String(err));
  if(state)state.textContent='Could not build roof report: '+msg;
 }finally{
  clearTimeout(timer);
  if(topBtn){topBtn.disabled=false;topBtn.textContent=oldTop||'Generate Roof Measurement Report'}
  if(inlineBtn){inlineBtn.disabled=false;inlineBtn.textContent=oldInline||'Generate Roof Measurement Report'}
  document.body.style.cursor='';
 }
}
document.querySelector('#roof-takeoff')?.addEventListener('click',generateRoofReport);
document.querySelector('#roof-report-inline')?.addEventListener('click',generateRoofReport);
document.querySelector('#print-roof-report')?.addEventListener('click',()=>window.print());
document.querySelector('#close-roof-report')?.addEventListener('click',()=>{const p=document.querySelector('#roof-report-panel');if(p)p.hidden=true});

function benchNum(id){
 const v=document.querySelector(id)?.value;
 return v===''||v==null?null:Number(v);
}
function benchmarkProjectId(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 return saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
}
function fillBenchmarkForm(b){
 if(!b?.reference)return;
 const r=b.reference,map={
  '#bench-source':r.source||'Roofr','#bench-area':r.slopedAreaFt2,'#bench-facets':r.facetCount,'#bench-pitch':r.avgPitch12,
  '#bench-perimeter':r.perimeterFt,'#bench-ridge':r.ridgeFt,'#bench-hip':r.hipFt,'#bench-ridgehip':r.ridgeHipFt,
  '#bench-valley':r.valleyFt,'#bench-eave':r.eaveFt,'#bench-rake':r.rakeFt,
  '#bench-footprint-area':r.footprintAreaFt2,'#bench-footprint-perimeter':r.footprintPerimeterFt
 };
 for(const [sel,val] of Object.entries(map)){const el=document.querySelector(sel);if(el&&val!=null)el.value=val}
 const fa=document.querySelector('#bench-facet-areas');if(fa&&Array.isArray(r.facetAreasFt2))fa.value=r.facetAreasFt2.join(', ');
}
function renderBenchmarkScore(b){
 const out=document.querySelector('#roof-benchmark-result'),badge=document.querySelector('#roof-benchmark-badge');
 if(!out||!b?.score)return;
 const s=b.score,cs=s.componentScores||{},err=s.errors||{},issues=s.issues||[];
 const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(1):'—';
 if(badge)badge.textContent=s.overallScore!=null?'Score '+fmt(s.overallScore):'Scored';
 out.innerHTML='<strong>Benchmark score: '+fmt(s.overallScore)+'/100</strong><br>'+
  'Topology '+fmt(cs.topology)+' · Roof lines '+fmt(cs.edges)+' · Pitch '+fmt(cs.pitch)+' · Facet areas '+fmt(cs.facetAreas)+' · Total area '+fmt(cs.totalArea)+' · Footprint '+fmt(cs.footprint)+
  '<br><span class="muted">Area error '+fmt(err.totalAreaPct)+'% · Facet-count error '+fmt(err.facetCountPct)+'% · Pitch error '+fmt(err.pitchPct)+'% · Footprint area error '+fmt(err.footprintAreaPct)+'%</span>'+
  (issues.length?'<div style="margin-top:8px">'+issues.map(x=>'• '+escRoof(x.message)).join('<br>')+'</div>':'<div style="margin-top:8px">No material benchmark issues were flagged by the current thresholds.</div>');
}
async function loadRoofBenchmark(){
 const id=benchmarkProjectId();if(!id||id.includes('NaN'))return;
 try{
  const r=await fetch('/api/roof-benchmark?projectId='+encodeURIComponent(id)),d=await r.json().catch(()=>({}));
  if(r.ok&&d.benchmark){fillBenchmarkForm(d.benchmark);renderBenchmarkScore(d.benchmark)}
 }catch{}
}
async function extractPdfText(file){
 const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
 const data=new Uint8Array(await file.arrayBuffer()),pdf=await pdfjs.getDocument({data}).promise;
 let text='';
 for(let i=1;i<=pdf.numPages;i++){
  const page=await pdf.getPage(i),content=await page.getTextContent();
  text+='\n--- PAGE '+i+' ---\n'+content.items.map(x=>x.str).join(' ');
 }
 return text;
}
function applyExtractedBenchmark(x){
 const map={
  '#bench-source':x.source,'#bench-area':x.slopedAreaFt2,'#bench-facets':x.facetCount,'#bench-pitch':x.avgPitch12,
  '#bench-perimeter':x.perimeterFt,'#bench-ridge':x.ridgeFt,'#bench-hip':x.hipFt,'#bench-ridgehip':x.ridgeHipFt,
  '#bench-valley':x.valleyFt,'#bench-eave':x.eaveFt,'#bench-rake':x.rakeFt,
  '#bench-footprint-area':x.footprintAreaFt2,'#bench-footprint-perimeter':x.footprintPerimeterFt
 };
 for(const [sel,val] of Object.entries(map)){const el=document.querySelector(sel);if(el&&val!=null&&val!=='')el.value=val}
 const fa=document.querySelector('#bench-facet-areas');
 if(fa&&Array.isArray(x.facetAreasFt2)&&x.facetAreasFt2.length)fa.value=x.facetAreasFt2.join(', ');
}
async function processReferenceRoofReport(file){
 const status=document.querySelector('#roof-reference-status'),badge=document.querySelector('#roof-benchmark-badge');
 if(!file)return;
 if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){if(status)status.textContent='Please upload a PDF roof report.';return}
 if(status)status.textContent='Reading '+file.name+'…';if(badge)badge.textContent='Reading PDF';
 try{
  const text=await extractPdfText(file);
  if(!text.trim())throw new Error('No readable text was found in this PDF.');
  if(status)status.textContent='Extracting roof measurements…';
  const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},projectId=benchmarkProjectId();
  const r=await fetch('/api/reference-report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,address:saved.address||'',fileName:file.name,text})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Could not analyze reference report.');
  const x=d.report?.extracted||{};applyExtractedBenchmark(x);
  if(status)status.innerHTML='<strong>Reference report analyzed ✓</strong><br>'+escRoof(file.name)+' · '+(x.slopedAreaFt2?Math.round(x.slopedAreaFt2).toLocaleString()+' ft² · ':'')+(x.facetCount?x.facetCount+' facets · ':'')+(x.avgPitch12?Number(x.avgPitch12).toFixed(1)+'/12 average pitch':'Review extracted fields below.');
  if(badge)badge.textContent='Reference loaded';
  if(Number.isFinite(Number(x.slopedAreaFt2))&&Number.isFinite(Number(x.facetCount))){
   document.querySelector('#score-roof-benchmark')?.click();
  }
 }catch(err){if(badge)badge.textContent='Upload issue';if(status)status.textContent='Could not analyze report: '+(err?.message||String(err))}
}
const roofDrop=document.querySelector('#roof-reference-drop'),roofFile=document.querySelector('#roof-reference-file');
roofDrop?.addEventListener('click',()=>roofFile?.click());
roofDrop?.addEventListener('dragover',e=>{e.preventDefault();roofDrop.style.borderColor='#2563eb'});
roofDrop?.addEventListener('dragleave',()=>{roofDrop.style.borderColor='#94a3b8'});
roofDrop?.addEventListener('drop',e=>{e.preventDefault();roofDrop.style.borderColor='#94a3b8';processReferenceRoofReport(e.dataTransfer?.files?.[0])});
roofFile?.addEventListener('change',()=>processReferenceRoofReport(roofFile.files?.[0]));

document.querySelector('#score-roof-benchmark')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#score-roof-benchmark'),out=document.querySelector('#roof-benchmark-result'),badge=document.querySelector('#roof-benchmark-badge');
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},projectId=benchmarkProjectId();
 const facetAreas=String(document.querySelector('#bench-facet-areas')?.value||'').split(',').map(v=>Number(v.trim())).filter(v=>Number.isFinite(v)&&v>0);
 const payload={
  projectId,address:saved.address||'',source:String(document.querySelector('#bench-source')?.value||'Roofr').trim()||'Roofr',
  slopedAreaFt2:benchNum('#bench-area'),facetCount:benchNum('#bench-facets'),avgPitch12:benchNum('#bench-pitch'),
  perimeterFt:benchNum('#bench-perimeter'),footprintAreaFt2:benchNum('#bench-footprint-area'),footprintPerimeterFt:benchNum('#bench-footprint-perimeter'),
  ridgeFt:benchNum('#bench-ridge'),hipFt:benchNum('#bench-hip'),ridgeHipFt:benchNum('#bench-ridgehip'),valleyFt:benchNum('#bench-valley'),
  eaveFt:benchNum('#bench-eave'),rakeFt:benchNum('#bench-rake'),facetAreasFt2:facetAreas
 };
 if(!Number.isFinite(payload.slopedAreaFt2)||!Number.isFinite(payload.facetCount)){if(out)out.textContent='Reference sloped area and facet count are required.';return}
 const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Scoring…'}if(badge)badge.textContent='Scoring';
 try{
  const r=await fetch('/api/roof-benchmark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Could not score benchmark.');
  renderBenchmarkScore(d.benchmark);
  if(out)out.scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(err){if(badge)badge.textContent='Needs review';if(out)out.textContent='Benchmark scoring failed: '+(err?.message||String(err))}
 finally{if(btn){btn.disabled=false;btn.textContent=old||'Save Reference & Score Solaris'}}
});

function fmtRegression(v,suffix=''){
 const n=Number(v);return Number.isFinite(n)?n.toFixed(1)+suffix:'—';
}
function renderRoofRegression(data){
 const s=data?.summary||{},rows=data?.rows||[],summary=document.querySelector('#roof-regression-summary'),status=document.querySelector('#roof-regression-status'),results=document.querySelector('#roof-regression-results');
 if(summary){
  const cards=[
   ['Training cases',s.totalCases??rows.length],
   ['Processed',s.processedCases??0],
   ['Average score',fmtRegression(s.averageScore,' /100')],
   ['Area error',fmtRegression(s.averageAreaErrorPct,'%')],
   ['DSM facet error',fmtRegression(s.averageDsmFacetErrorPct??s.averageFacetErrorPct,'%')],
   ['Google segment err',fmtRegression(s.averageGoogleSegmentFacetErrorPct,'%')],
   ['Topology face err',fmtRegression(s.averageTopologyFaceErrorPct,'%')],
   ['Roof-line error',fmtRegression(s.averageEdgeErrorPct,'%')],
   ['Boundary candidate',fmtRegression(s.averageDetailBoundaryEdgeErrorPct,'%')],
   ['Raster line candidate',fmtRegression(s.averageRasterLineCandidateEdgeErrorPct,'%')],
   ['Production confidence lines',fmtRegression(s.averageEdgeErrorPct,'%')],
   ['Topology internal candidate',fmtRegression(s.averageTopologyInternalEdgeErrorPct,'%')],
   ['Hip-only candidate',fmtRegression(s.averageHipConfidenceEdgeErrorPct,'%')],
   ['Promoted hip + valley',fmtRegression(s.averageInternalConfidenceEdgeErrorPct,'%')],
   ['Line v5 restored',(s.lineEngineV5RestoredCases??0)+' / '+(s.geometryProcessedCases??s.processedCases??0)]
  ];
  summary.innerHTML=cards.map(([a,b])=>'<div class="metric"><span>'+escRoof(a)+'</span><strong>'+escRoof(b)+'</strong></div>').join('');
 }
 const scored=rows.filter(r=>r.status==='scored').sort((a,b)=>(a.score?.overall??999)-(b.score?.overall??999));
 const failures=scored.filter(r=>r.gatePass===false);
 if(status){
  status.innerHTML='<strong>Regression complete.</strong> '+Number((s.geometryProcessedCases??s.processedCases)||0)+' of '+Number(s.totalCases||rows.length)+' cases currently have saved Solaris geometry; '+Number(s.comparableCases??0)+' are directly comparable single-building references. '+
   '<br><span class="muted">Facet diagnostics: DSM '+fmtRegression(s.averageDsmFacetErrorPct??s.averageFacetErrorPct,'%')+' · Google segments '+fmtRegression(s.averageGoogleSegmentFacetErrorPct,'%')+' · Topology faces '+fmtRegression(s.averageTopologyFaceErrorPct,'%')+'.</span>'+
   '<br><span class="muted">Line engine v5: '+Number(s.lineEngineV5RestoredCases||0)+' current · '+Number(s.staleLineEngineCases||0)+' stale. Boundary candidates: '+Number(s.detailBoundaryCases||0)+' · Raster-line candidates: '+Number(s.rasterLineCandidateCases||0)+'.</span> '+
   (failures.length?'<strong>'+failures.length+' comparable case'+(failures.length===1?'':'s')+' fail the regression gate.</strong>':'All comparable cases pass the current gate.')+
   (Number(s.pendingCases||0)?' '+Number(s.pendingCases)+' case'+(Number(s.pendingCases)===1?'':'s')+' still need an initial Solaris process run.':'');
 }
 if(!results)return;
 const ordered=[...scored,...rows.filter(r=>r.status!=='scored')];
 results.innerHTML='<table><thead><tr><th>Roof</th><th>Type</th><th>Engine</th><th>Ref</th><th>Google seg</th><th>DSM facets</th><th>Topo faces</th><th>Area err</th><th>Lines err</th><th>Score</th><th>Gate</th></tr></thead><tbody>'+
  ordered.map(r=>{
   const e=r.score?.errors||{},cur=r.current||{},pending=r.status!=='scored';
   const gate=pending?'Pending':(r.gatePass?'Pass':'Review');
   return '<tr>'+
    '<td><strong>'+escRoof(r.address)+'</strong><br><span class="muted">'+escRoof(r.source||'')+'</span></td>'+
    '<td>'+escRoof(r.archetype||'—')+'</td>'+
    '<td>'+(pending?'—':escRoof((cur.facetEngineVersion||cur.geometryMode||'—')+(cur.lineEngineVersion?' / '+cur.lineEngineVersion.replace('plane-dsm-trace-','line-'):'')))+'</td>'+
    '<td>'+escRoof(r.reference?.facetCount??'—')+'</td>'+
    '<td>'+(pending?'—':escRoof(cur.googleSegmentCount??'—'))+'</td>'+
    '<td>'+(pending?'—':escRoof(cur.dsmFacetCount??cur.facetCount??'—'))+'</td>'+
    '<td>'+(pending?'—':escRoof(cur.topologyFaceCount??'—'))+'</td>'+
    '<td>'+fmtRegression(e.area,'%')+'</td>'+
    '<td>'+fmtRegression(e.edges,'%')+'</td>'+
    '<td>'+(pending?'—':fmtRegression(r.score?.overall,' /100'))+'</td>'+
    '<td><strong>'+gate+'</strong></td>'+
   '</tr>';
  }).join('')+'</tbody></table>';
}
function trainingSlug(address){
 return 'training-'+String(address||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72);
}
async function bootstrapTrainingCase(row,engine){
 const address=row.address;
 // Training geometry must start from a rooftop-level coordinate. The server
 // geocoder can fall back to Census interpolation, which is good enough for a
 // map but can select a neighboring building in Google Solar.
 await loadRoofMapsJs();
 const geocoder=new google.maps.Geocoder();
 const gres=await geocoder.geocode({address});
 const hit=gres?.results?.[0],loc=hit?.geometry?.location;
 const lat=typeof loc?.lat==='function'?loc.lat():Number(loc?.lat);
 const lng=typeof loc?.lng==='function'?loc.lng():Number(loc?.lng);
 const precision=hit?.geometry?.location_type||null;
 if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('Google Maps could not geocode this address.');
 if(precision!=='ROOFTOP')throw new Error('Google Maps geocode was not rooftop-precise ('+(precision||'unknown')+').');
 const geo={source:'google-browser',address:hit?.formatted_address||address,lat,lng,precision,rooftop:true};
 const br=await fetch('/api/solar-building?lat='+encodeURIComponent(lat)+'&lng='+encodeURIComponent(lng),{cache:'no-store'});
 const building=await br.json().catch(()=>({}));
 if(!br.ok||!building.ok)throw new Error(building.error||'Google Solar Building Insights unavailable.');
 const bc=building.center;
 if(bc&&Number.isFinite(Number(bc.latitude))&&Number.isFinite(Number(bc.longitude))){
  const dy=(Number(bc.latitude)-lat)*111320;
  const dx=(Number(bc.longitude)-lng)*111320*Math.cos(lat*Math.PI/180);
  const centerDistance=Math.hypot(dx,dy);
  if(centerDistance>35)throw new Error('Google Solar selected a building '+centerDistance.toFixed(1)+' m from the rooftop geocode.');
 }
 const result=await engine.buildSolarRoofModel(lat,lng,building.roofSegments||[]);
 const measurements=engine.buildRoofMeasurements(result.outline,result.model.facets||[],result.model.roofLines||[]);
 const detailBoundaryMeasurements=Array.isArray(result.measurementOutlineCandidate)&&result.measurementOutlineCandidate.length>=3
  ?engine.buildRoofMeasurements(result.measurementOutlineCandidate,result.model.facets||[],result.model.roofLines||[])
  :null;
 const rasterLineMeasurements=result.rasterLineMeasurements||null;
 const projectId=trainingSlug(address);
 const solarModel={
  source:'google-solar-dsm',
  trainingAuto:true,
  trainingVersion:'r39-browser-rooftop-v2',
  geocodeSource:geo.source||null,
  geocodePrecision:geo.precision||null,
  geocodeRooftop:Boolean(geo.rooftop),
  geocodeAddress:geo.address||address,
  lat,lng,
  imageryQuality:building.imageryQuality||result.quality||null,
  imageryDate:building.imageryDate||null,
  googleWholeRoofAreaFt2:Number.isFinite(Number(building.roofAreaMeters2))?Number(building.roofAreaMeters2)*10.7639104167:null,
  googleRoofSegmentCount:Array.isArray(building.roofSegments)?building.roofSegments.length:null,
  outline:result.outline,
  rawCornerCount:result.rawCornerCount,
  model:result.model,
  measurements,
  measurementCandidates:{detailBoundary:detailBoundaryMeasurements,rasterLines:rasterLineMeasurements}
 };
 const sr=await fetch('/api/roof-solar-model',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,address,accepted:false,model:solarModel})});
 const sd=await sr.json().catch(()=>({}));if(!sr.ok||!sd.ok)throw new Error(sd.error||'Could not save DSM model.');
 const or=await fetch('/api/training-solar-outline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,address,lat,lng,outline:result.outline,cropHalfMeters:42})});
 const od=await or.json().catch(()=>({}));if(!or.ok||!od.ok)throw new Error(od.error||'Could not save Solar outline.');
 return {projectId,address,lat,lng,facets:Number(result.model?.facets?.length||0),area:Number(result.model?.slopedAreaSqFt||0)};
}
document.querySelector('#bootstrap-roof-training')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#bootstrap-roof-training'),status=document.querySelector('#roof-regression-status');
 const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Preparing…'}
 try{
  const rr=await fetch('/api/training-regression',{cache:'no-store'}),rd=await rr.json().catch(()=>({}));
  if(!rr.ok||!rd.ok)throw new Error(rd.error||'Could not load training cases.');
  const pendingRows=(rd.rows||[]).filter(r=>(r.scope==='primary-building'||r.scope==='all-structures'||!r.scope)&&(
    r.status==='not-processed' ||
    r.current?.lineEngineVersion!=='plane-dsm-trace-v5-restored' ||
    r.current?.detailBoundaryPerimeterFt==null ||
    r.current?.rasterLineCandidateRidgeFt==null
  ));
  const byAddress=new Map();for(const r of pendingRows)if(!byAddress.has(r.address))byAddress.set(r.address,r);
  const queue=[...byAddress.values()];
  if(!queue.length){if(status)status.textContent='All eligible training roofs already have the restored v5 engine plus both shadow candidates.';return}
  const engine=await import('/assets/js/solar-roof-engine.js?v=20261004-exterior-z-v1');
  let done=0,failed=0;const failures=[];
  const worker=async()=>{
   while(queue.length){
    const row=queue.shift();if(!row)break;
    if(status)status.textContent='Automatic DSM bootstrap: '+done+' complete · '+failed+' failed · '+(queue.length+1)+' remaining. Processing '+row.address+'…';
    try{await bootstrapTrainingCase(row,engine);done++}
    catch(err){failed++;failures.push(row.address+': '+(err?.message||String(err)))}
   }
  };
  await Promise.all([worker(),worker()]);
  const rebuildSummary='<strong>Training rebuild complete.</strong> '+done+' roofs updated with restored v5 plus boundary and raster-line shadow candidates · '+failed+' failed.'+(failures.length?'<br><span class="muted">'+failures.slice(0,8).map(escRoof).join('<br>')+(failures.length>8?'<br>…and '+(failures.length-8)+' more':'')+'</span>':'');
  if(status)status.innerHTML=rebuildSummary+'<br>Running regression now…';
  const reg=await fetch('/api/training-regression',{cache:'no-store'}),data=await reg.json().catch(()=>({}));
  if(!reg.ok||!data.ok)throw new Error(data.error||'Bootstrap finished, but regression could not run.');
  renderRoofRegression(data);
  if(status)status.innerHTML=rebuildSummary+'<br><span class="muted">Regression refreshed below.</span>';
 }catch(err){if(status)status.textContent='Training bootstrap failed: '+(err?.message||String(err))}
 finally{if(btn){btn.disabled=false;btn.textContent=old||'Rebuild Training Models'}}
});

document.querySelector('#optimize-roof-topology')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#optimize-roof-topology'),status=document.querySelector('#roof-optimizer-status'),regStatus=document.querySelector('#roof-regression-status');
 const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Optimizing…'}
 if(status)status.textContent='Testing profile-specific topology settings across the processed training corpus…';
 try{
  const r=await fetch('/api/training-topology-optimizer',{method:'POST',headers:{'content-type':'application/json'}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Topology optimization failed.');
  const cfg=d.config||{},rows=(cfg.results||[]).filter(x=>x.best);
  if(status)status.innerHTML='<strong>Topology optimization complete.</strong> '+Number(cfg.trainingCases||0)+' comparable roofs evaluated with a deterministic holdout set across '+rows.length+' solver profiles.<br>'+
    rows.map(x=>{
      const b=x.best||{},base=x.baseline||{},tag=x.promoted?'promoted':'kept baseline';
      return escRoof(x.profile)+': '+escRoof(b.name||'current')+' · train '+Number(b.score||0).toFixed(1)+' · validation '+Number((b.validationScore??b.score)||0).toFixed(1)+' · '+tag+' (baseline validation '+Number((base.validationScore??base.score)||0).toFixed(1)+')';
    }).join('<br>');
  if(regStatus)regStatus.textContent='Optimized topology settings saved. Running regression with the new profile overrides…';
  const rr=await fetch('/api/training-regression',{cache:'no-store'}),rd=await rr.json().catch(()=>({}));
  if(!rr.ok||!rd.ok)throw new Error(rd.error||'Optimizer saved, but regression failed.');
  renderRoofRegression(rd);
 }catch(err){if(status)status.textContent='Topology optimization failed: '+(err?.message||String(err))}
 finally{if(btn){btn.disabled=false;btn.textContent=old||'Optimize Topology'}}
});

document.querySelector('#run-roof-regression')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#run-roof-regression'),status=document.querySelector('#roof-regression-status');
 const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='Running 39 cases…'}if(status)status.textContent='Running the current solver against the verified training corpus…';
 try{
  const r=await fetch('/api/training-regression',{cache:'no-store'}),d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Regression runner failed.');
  renderRoofRegression(d);
 }catch(err){if(status)status.textContent='Regression failed: '+(err?.message||String(err))}
 finally{if(btn){btn.disabled=false;btn.textContent=old||'Run Regression'}}
});

async function restoreRoofReportReadyState(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 if(!Number.isFinite(Number(saved.lat))||!Number.isFinite(Number(saved.lng)))return;
 const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 const r=await fetch('/api/roof-report?projectId='+encodeURIComponent(projectId));if(!r.ok)return;
 const d=await r.json();if(!d.ok)return;
 const facets=(d.planes?.planes||[]).filter(p=>p.accepted);
 if(!facets.length)return;
 const takeoff=document.querySelector('#roof-takeoff'),reportInline=document.querySelector('#roof-report-inline'),reportMain=document.querySelector('#roof-report-main');if(takeoff)takeoff.disabled=false;if(reportInline)reportInline.disabled=false;if(reportMain)reportMain.disabled=false;
 const fc=document.querySelector('#roof-facets'),pit=document.querySelector('#roof-pitch'),sq=document.querySelector('#roof-squares'),area=document.querySelector('#roof-area'),per=document.querySelector('#roof-perimeter');
 const sloped=facets.reduce((s,p)=>s+Number(p.slopedAreaFt2||0),0),avg=facets.reduce((s,p)=>s+Number(p.pitch12||0),0)/facets.length;
 let displayPitch=Math.round(avg);
 const sm=d.solarModel;
 if(sm?.accepted){
  const sf=sm.model?.facets||[],wt=sf.reduce((s,p)=>s+Number(p.slopedAreaSqFt||p.flatAreaSqFt||0),0);
  const dsmPitch=sf.length?(wt>0?sf.reduce((s,p)=>s+Number(p.rise12||0)*Number(p.slopedAreaSqFt||p.flatAreaSqFt||0),0)/wt:sf.reduce((s,p)=>s+Number(p.rise12||0),0)/sf.length):Number(sm.model?.rise12||0);
  if(Number.isFinite(dsmPitch)&&dsmPitch>0)displayPitch=Math.round(dsmPitch);
 }
 if(fc)fc.textContent=facets.length;if(pit)pit.textContent=displayPitch+'/12';if(sq&&sloped>0)sq.textContent=(sloped/100).toFixed(2)+' sq';
 if(area&&d.outline?.measurement?.planAreaFt2)area.textContent=Math.round(d.outline.measurement.planAreaFt2).toLocaleString()+' ft²';
 if(per&&d.outline?.measurement?.perimeterFt)per.textContent=Number(d.outline.measurement.perimeterFt).toFixed(1)+' ft';
 loadRoofBenchmark();
}

let roofSolarProposal=null;
function fmtHybridFt(v){return Number.isFinite(Number(v))?Number(v).toFixed(1)+' ft':'—'}
function renderRoofSolarProposal(proposal){
 const badge=document.querySelector('#roof-solar-badge'),summary=document.querySelector('#roof-solar-summary'),lines=document.querySelector('#roof-solar-lines'),accept=document.querySelector('#accept-roof-solar');
 const m=proposal?.measurements||{},model=proposal?.model||{},facets=model.facets||[],roofLines=model.roofLines||[];
 if(badge)badge.textContent='DSM ready';
 if(summary)summary.innerHTML='<strong>Google DSM roof model ready</strong><br>'+
   Math.round(Number(model.slopedAreaSqFt||0)).toLocaleString()+' ft² sloped area · '+
   (Number(model.slopedAreaSqFt||0)/100).toFixed(2)+' squares · '+
   facets.length+' facets · '+Number(model.rise12||0).toFixed(1)+'/12 average pitch<br>'+
   'Perimeter '+fmtHybridFt(m.perimeterFt)+' · Eave '+fmtHybridFt(m.eaveFt)+' · Rake '+fmtHybridFt(m.rakeFt)+' · Ridge '+fmtHybridFt(m.ridgeFt)+' · Hip '+fmtHybridFt(m.hipFt)+' · Valley '+fmtHybridFt(m.valleyFt)+
   '<br><span class="muted">Geometry mode: '+escRoof(model.geometryMode||'detailed')+' · facet coverage '+Math.round(Number(model.facetCoverage||0)*100)+'%'+(model.rgbAssisted?' · RGB edge assist':'')+'</span>';
 if(lines){
  const rows=roofLines.filter(l=>['ridge','hip','valley'].includes(l.type)).map((l,i)=>'<div style="display:grid;grid-template-columns:80px 1fr 90px;gap:10px;padding:7px 0;border-bottom:1px solid #e5e7eb"><strong>'+escRoof(l.type)+'</strong><span>DSM shared boundary '+(i+1)+'</span><span>'+fmtHybridFt(Number(l.length3dMeters||l.lengthMeters||0)*3.280839895)+'</span></div>').join('');
  lines.innerHTML=rows||'<span class="muted">No confident ridge / hip / valley proposals were produced.</span>';
 }
 if(accept)accept.disabled=false;
}
async function saveRoofSolarModel(accepted=false){
 if(!roofSolarProposal)return;
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch('/api/roof-solar-model',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,address:saved.address,accepted,model:roofSolarProposal}),signal:controller.signal});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.ok)throw new Error(d.error||'Could not save Google DSM roof model.');
  return d.model;
 }finally{clearTimeout(timer)}
}
async function runRoofSolarAnalysis(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{},btn=document.querySelector('#run-roof-solar'),badge=document.querySelector('#roof-solar-badge'),summary=document.querySelector('#roof-solar-summary'),accept=document.querySelector('#accept-roof-solar');
 const lat=Number(saved.lat),lng=Number(saved.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)){if(summary)summary.textContent='Confirm the roof location first.';return}
 if(btn)btn.disabled=true;if(accept)accept.disabled=true;if(badge)badge.textContent='Analyzing';if(summary)summary.textContent='Loading Google rooftop mask, DSM, RGB and roof-segment metadata…';
 try{
  const br=await fetch('/api/solar-building?lat='+encodeURIComponent(lat)+'&lng='+encodeURIComponent(lng)),building=await br.json();
  if(!br.ok||!building.ok)throw new Error(building.error||'Google Solar Building Insights is unavailable for this roof.');
  const engine=await import('/assets/js/solar-roof-engine.js?v=20261004-exterior-z-v1');
  const result=await engine.buildSolarRoofModel(lat,lng,building.roofSegments||[]);
  const measurements=engine.buildRoofMeasurements(result.outline,result.model.facets||[],result.model.roofLines||[]);
  const detailBoundaryMeasurements=Array.isArray(result.measurementOutlineCandidate)&&result.measurementOutlineCandidate.length>=3
   ?engine.buildRoofMeasurements(result.measurementOutlineCandidate,result.model.facets||[],result.model.roofLines||[])
   :null;
  const rasterLineMeasurements=result.rasterLineMeasurements||null;
  roofSolarProposal={
   source:'google-solar-dsm',
   lat,lng,
   imageryQuality:building.imageryQuality||result.quality||null,
   imageryDate:building.imageryDate||null,
   googleWholeRoofAreaFt2:Number.isFinite(Number(building.roofAreaMeters2))?Number(building.roofAreaMeters2)*10.7639104167:null,
   googleRoofSegmentCount:Array.isArray(building.roofSegments)?building.roofSegments.length:null,
   outline:result.outline,
   rawCornerCount:result.rawCornerCount,
   model:result.model,
   measurements,
   measurementCandidates:{detailBoundary:detailBoundaryMeasurements,rasterLines:rasterLineMeasurements}
  };
  renderRoofSolarProposal(roofSolarProposal);
  await saveRoofSolarModel(false);
 }catch(err){
  roofSolarProposal=null;if(badge)badge.textContent='Unavailable';if(summary)summary.textContent='Google DSM analysis could not run: '+err.message;
 }finally{if(btn)btn.disabled=false}
}
document.querySelector('#run-roof-solar')?.addEventListener('click',runRoofSolarAnalysis);
document.querySelector('#accept-roof-solar')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#accept-roof-solar'),badge=document.querySelector('#roof-solar-badge'),summary=document.querySelector('#roof-solar-summary');
 if(!roofSolarProposal)return;
 if(btn){btn.disabled=true;btn.textContent='Saving DSM Geometry…'}
 if(badge)badge.textContent='Saving';
 try{
  await saveRoofSolarModel(true);
  if(badge)badge.textContent='Accepted ✓';
  if(btn)btn.textContent='DSM Geometry Accepted ✓';
  if(summary)summary.innerHTML+='<br><strong>DSM geometry accepted ✓</strong>';
 }catch(err){
  const msg=err?.name==='AbortError'?'The DSM save request timed out. Please try again.':(err?.message||String(err));
  if(badge)badge.textContent='Save failed';
  if(summary)summary.innerHTML+='<br><strong>Could not save DSM acceptance:</strong> '+escRoof(msg);
  if(btn){btn.disabled=false;btn.textContent='Accept DSM Geometry'}
 }finally{
  document.body.style.cursor='';
 }
});
function waitForRoofCondition(test,timeout=20000,interval=200){
 return new Promise((resolve,reject)=>{
  const started=Date.now(),tick=()=>{
   try{if(test())return resolve(true)}catch{}
   if(Date.now()-started>=timeout)return reject(new Error('Timed out waiting for the roof analysis step to finish.'));
   setTimeout(tick,interval);
  };tick();
 });
}
async function hasAcceptedRoofOutline(){
 if(roofOutlineProposal?.status==='accepted-plan-view'&&roofOutlineProposal?.polygon?.length>=3)return true;
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 if(!Number.isFinite(Number(saved.lat))||!Number.isFinite(Number(saved.lng)))return false;
 const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 try{
  const r=await fetch('/api/roof-outline?projectId='+encodeURIComponent(projectId)),d=await r.json();
  return Boolean(r.ok&&d.outline?.polygon?.length>=3);
 }catch{return false}
}
async function processRoofGuided(){
 if(roofProcessRunning)return;
 const btn=document.querySelector('#process-roof-all'),badge=document.querySelector('#roof-process-badge'),status=document.querySelector('#roof-process-status'),approve=document.querySelector('#approve-roof-analysis');
 if(!(await hasAcceptedRoofOutline())){
  roofAutoProcessPending=true;
  if(badge)badge.textContent='Outline review';
  if(status)status.textContent='Detecting the roof outline… Review the yellow outline, adjust points if needed, then click Confirm Roof Outline. Solaris will continue automatically.';
  await detectRoofAutomatically();
  return;
 }
 roofAutoProcessPending=false;roofProcessRunning=true;
 if(btn){btn.disabled=true;btn.textContent='Processing Roof…'}
 if(approve)approve.disabled=true;
 try{
  if(badge)badge.textContent='DSM';
  if(status)status.textContent='Step 1 of 4 · Running Google DSM roof analysis…';
  await runRoofSolarAnalysis();

  if(badge)badge.textContent='LiDAR';
  if(status)status.textContent='Step 2 of 4 · Finding and extracting USGS LiDAR…';
  await findRoofLidar();
  let saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
  if(!saved.lidarSource)throw new Error('No usable LiDAR coverage was found for this property.');
  await extractRoofLidar();
  saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
  if(!saved.lidarEpt?.url||!saved.lidarSubset?.nodes?.length)throw new Error('LiDAR coverage was found, but the roof point-cloud subset could not be prepared.');

  if(badge)badge.textContent='3D points';
  if(status)status.textContent='Step 3 of 4 · Decoding roof LiDAR points…';
  await decodeRoofLidar();
  if(!roofLidarDecoded?.surfacePoints?.length)throw new Error('Roof LiDAR points could not be decoded.');

  if(badge)badge.textContent='Facets';
  if(status)status.textContent='Step 4 of 4 · Fitting roof planes…';
  fitRoofPlanes();
  if(!roofPlaneProposals?.length)throw new Error('No stable LiDAR roof planes were produced.');

  const reportMain=document.querySelector('#roof-report-main');
  if(approve)approve.disabled=false;
  if(reportMain)reportMain.disabled=false;
  if(badge)badge.textContent='Ready';
  if(status)status.textContent='Roof analysis ready ✓ · DSM geometry and LiDAR facets are prepared. Generate the report when ready.';
 }catch(err){
  if(badge)badge.textContent='Needs review';
  if(status)status.textContent='Automatic processing stopped: '+(err?.message||String(err))+' Open Advanced / Troubleshooting for the individual step controls.';
 }finally{
  roofProcessRunning=false;
  if(btn){btn.disabled=false;btn.textContent='Process Roof'}
 }
}
// Process Roof listener is registered near the top of this file for resilience.

async function ensureRoofMeasurementsAccepted(){
 const badge=document.querySelector('#roof-process-badge'),status=document.querySelector('#roof-process-status');
 if(roofSolarProposal){
  const solarBadge=document.querySelector('#roof-solar-badge');
  if(solarBadge?.textContent!=='Accepted ✓'){
   document.querySelector('#accept-roof-solar')?.click();
   await waitForRoofCondition(()=>document.querySelector('#roof-solar-badge')?.textContent==='Accepted ✓',15000);
  }
 }
 if(roofPlaneProposals?.length){
  const planeStatus=document.querySelector('#roof-plane-status');
  if(!String(planeStatus?.textContent||'').includes('facets accepted ✓')){
   document.querySelector('#accept-roof-planes')?.click();
   await waitForRoofCondition(()=>String(document.querySelector('#roof-plane-status')?.textContent||'').includes('facets accepted ✓'),18000);
  }
 }
 if(badge)badge.textContent='Approved ✓';
 if(status)status.textContent='Measurements approved ✓ · Building report…';
}

document.querySelector('#approve-roof-analysis')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#approve-roof-analysis'),badge=document.querySelector('#roof-process-badge'),status=document.querySelector('#roof-process-status'),reportMain=document.querySelector('#roof-report-main');
 if(btn){btn.disabled=true;btn.textContent='Approving…'}
 try{
  if(roofSolarProposal){
   const solarBadge=document.querySelector('#roof-solar-badge');
   if(solarBadge?.textContent!=='Accepted ✓'){
    document.querySelector('#accept-roof-solar')?.click();
    await waitForRoofCondition(()=>document.querySelector('#roof-solar-badge')?.textContent==='Accepted ✓',15000);
   }
  }
  if(roofPlaneProposals?.length){
   const planeStatus=document.querySelector('#roof-plane-status');
   if(!String(planeStatus?.textContent||'').includes('facets accepted ✓')){
    document.querySelector('#accept-roof-planes')?.click();
    await waitForRoofCondition(()=>String(document.querySelector('#roof-plane-status')?.textContent||'').includes('facets accepted ✓'),18000);
   }
  }
  if(reportMain)reportMain.disabled=false;
  if(badge)badge.textContent='Approved ✓';
  if(status)status.textContent='Measurements approved ✓ · Generate the roof measurement report when ready.';
  if(btn)btn.textContent='Measurements Approved ✓';
 }catch(err){
  if(badge)badge.textContent='Approval issue';
  if(status)status.textContent='Could not finish approval: '+(err?.message||String(err))+'. Open Advanced / Troubleshooting to see which source needs attention.';
  if(btn){btn.disabled=false;btn.textContent='Approve Measurements'}
 }
});
document.querySelector('#roof-report-main')?.addEventListener('click',async()=>{
 const btn=document.querySelector('#roof-report-main'),status=document.querySelector('#roof-process-status');
 const oldText=btn?.textContent;
 if(btn)btn.textContent='Building Report…';
 try{
  await generateRoofReport();
 }catch(err){
  if(status)status.textContent='Could not build report: '+(err?.message||String(err));
 }finally{
  if(btn)btn.textContent=oldText||'Generate Roof Measurement Report';
 }
});

async function restoreRoofSolarModel(){
 const saved=JSON.parse(localStorage.getItem('solarisRoofProject')||'null')||{};
 if(!Number.isFinite(Number(saved.lat))||!Number.isFinite(Number(saved.lng)))return;
 const projectId=saved.projectId||('roof-'+Number(saved.lat).toFixed(6)+'-'+Number(saved.lng).toFixed(6));
 const r=await fetch('/api/roof-solar-model?projectId='+encodeURIComponent(projectId));if(!r.ok)return;
 const d=await r.json();if(!d.model)return;roofSolarProposal=d.model;renderRoofSolarProposal(roofSolarProposal);
 const badge=document.querySelector('#roof-solar-badge');if(d.model.accepted&&badge)badge.textContent='Accepted ✓';
}
