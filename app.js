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

newProject?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

openTestHouse?.addEventListener('click', () => {
  photosCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

async function preserveVerified(){
  const state=document.querySelector('#geometry-state');
  const res=await fetch('/api/verified',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
  const d=await res.json().catch(()=>({})); if(!res.ok){state.textContent=d.error||'Could not preserve verified objects.';return false;}
  state.textContent='Verified object layer preserved. Geometry edits are stored separately.'; return true;
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
 btn.disabled=true;state.textContent='Auto-measuring house from saved geometry and verified objects…';root.innerHTML='<p class="muted">Working…</p>';
 try{
  const r=await fetch('/api/auto-measure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:PROJECT_ID})});
  const raw=await r.text();let d={};try{d=raw?JSON.parse(raw):{}}catch{throw Error('Server returned an unreadable response (HTTP '+r.status+').');}
  if(!r.ok)throw Error(d.error||('Auto Measure failed (HTTP '+r.status+').'));
  if(!d.result||!d.result.elevations)throw Error('Auto Measure returned no elevation results.');
  const x=d.result,n=v=>Number.isFinite(Number(v))?Number(v).toFixed(1):'—';
  const row=(name,o={})=>'<tr><td>'+name+'</td><td>'+n(o.areaFt2)+' ft²</td><td>'+n(o.benchmark)+' ft²</td><td>'+n(o.differenceFt2)+' ft²</td><td>'+n(o.errorPct)+'%</td><td>'+(o.sourceView||o.status||'—')+'</td></tr>';
  root.innerHTML='<table><thead><tr><th>Elevation</th><th>Solaris</th><th>Hover benchmark</th><th>Difference</th><th>Error</th><th>Source</th></tr></thead><tbody>'+row('Front',x.elevations.front)+row('Right',x.elevations.right)+row('Left',x.elevations.left)+row('Rear',x.elevations.rear)+'<tr><th>Whole house</th><th>'+n(x.totalAreaFt2)+' ft²</th><th>1,666.0 ft²</th><th>'+n(x.totalDifferenceFt2)+' ft²</th><th>'+n(x.totalErrorPct)+'%</th><th>'+(x.complete?'4 elevations':'partial')+'</th></tr></tbody></table>';
  state.textContent='Auto Measure complete. Hover values are validation only.';
 }catch(e){
  console.error('Auto Measure',e);state.textContent='Auto Measure error: '+(e?.message||String(e));root.innerHTML='<div class="analysis-state"><strong>Could not calculate results.</strong><br>'+(e?.message||String(e))+'</div>';
 }finally{btn.disabled=false;}
}
function bindAutoMeasure(){const btn=document.querySelector('#auto-measure');if(btn)btn.onclick=e=>{e.preventDefault();runAutoMeasure();};}
bindAutoMeasure();
