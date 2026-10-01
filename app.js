const analyze = document.querySelector('#analyze');
const state = document.querySelector('#analysis-state');
const newProject = document.querySelector('#new-project');

analyze?.addEventListener('click', () => {
  state.textContent = 'Prototype UI is online. The next build step is wiring photo upload/storage and the first feature-detection service.';
});

newProject?.addEventListener('click', () => {
  state.textContent = 'New Measurement workflow will be enabled after R2 upload storage is connected.';
  state.scrollIntoView({ behavior: 'smooth', block: 'center' });
});