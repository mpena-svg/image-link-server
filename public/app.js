const BATCH_SIZE = 15; // cuantas imagenes se envian por request; ajustable segun tamano de archivos

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const progressPanel = document.getElementById('progressPanel');
const progressLabel = document.getElementById('progressLabel');
const progressPct = document.getElementById('progressPct');
const progressFill = document.getElementById('progressFill');
const resultsSection = document.getElementById('resultsSection');
const resultsCount = document.getElementById('resultsCount');
const resultsBody = document.getElementById('resultsBody');
const exportBtn = document.getElementById('exportBtn');
const copyAllBtn = document.getElementById('copyAllBtn');
const toast = document.getElementById('toast');
const healthStatus = document.getElementById('healthStatus');

let allResults = [];
let toastTimer = null;

// ---------------------------------------------------------------------------
// Estado de salud del servidor
// ---------------------------------------------------------------------------

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error();
    healthStatus.textContent = 'servidor listo';
    healthStatus.classList.add('is-ok');
  } catch {
    healthStatus.textContent = 'no se pudo conectar al servidor';
    healthStatus.classList.add('is-error');
  }
}
checkHealth();

// ---------------------------------------------------------------------------
// Interaccion de la dropzone
// ---------------------------------------------------------------------------

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  })
);

['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  })
);

dropzone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
  if (files.length) handleFiles(files);
});

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (files.length) handleFiles(files);
  fileInput.value = '';
});

// ---------------------------------------------------------------------------
// Subida por lotes
// ---------------------------------------------------------------------------

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function handleFiles(files) {
  const batches = chunk(files, BATCH_SIZE);
  let done = 0;

  progressPanel.hidden = false;
  updateProgress(done, files.length);

  for (const batch of batches) {
    const formData = new FormData();
    batch.forEach((file) => formData.append('images', file));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Error al subir un lote de imágenes');
      } else {
        appendResults(data.items, batch);
      }
    } catch (err) {
      showToast('Error de red al subir un lote de imágenes');
    }

    done += batch.length;
    updateProgress(done, files.length);
  }

  showToast(`Listo: ${allResults.filter((r) => r.success).length} imágenes subidas`);
}

function updateProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  progressLabel.textContent = `Subiendo ${done} / ${total}`;
  progressPct.textContent = `${pct}%`;
  progressFill.style.width = `${pct}%`;
}

// ---------------------------------------------------------------------------
// Tabla de resultados
// ---------------------------------------------------------------------------

function appendResults(items, originalFiles) {
  items.forEach((item, i) => {
    const localFile = originalFiles[i];
    const previewUrl = localFile ? URL.createObjectURL(localFile) : '';
    allResults.push({ ...item, previewUrl });
  });

  renderResults();
}

function renderResults() {
  resultsSection.hidden = allResults.length === 0;
  resultsCount.textContent = `${allResults.length} imágenes procesadas`;
  resultsBody.innerHTML = '';

  allResults.forEach((item) => {
    const tr = document.createElement('tr');

    const thumbTd = document.createElement('td');
    if (item.previewUrl) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = item.previewUrl;
      img.alt = '';
      thumbTd.appendChild(img);
    }

    const nameTd = document.createElement('td');
    nameTd.className = 'file-name';
    nameTd.textContent = item.originalName;
    nameTd.title = item.originalName;

    const linkTd = document.createElement('td');
    if (item.success) {
      const a = document.createElement('a');
      a.className = 'file-link';
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.url;
      linkTd.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'row-error';
      span.textContent = item.error || 'Error al subir';
      linkTd.appendChild(span);
    }

    const actionTd = document.createElement('td');
    if (item.success) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copiar';
      btn.addEventListener('click', () => copyToClipboard(item.url, 'Link copiado'));
      actionTd.appendChild(btn);
    }

    tr.append(thumbTd, nameTd, linkTd, actionTd);
    resultsBody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// Acciones globales: copiar todo / exportar a excel
// ---------------------------------------------------------------------------

copyAllBtn.addEventListener('click', () => {
  const links = allResults.filter((r) => r.success).map((r) => r.url).join('\n');
  copyToClipboard(links, 'Todos los links copiados');
});

exportBtn.addEventListener('click', async () => {
  const links = allResults.filter((r) => r.success);
  if (links.length === 0) {
    showToast('No hay links exitosos para exportar');
    return;
  }

  try {
    const res = await fetch('/api/export-excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    });

    if (!res.ok) throw new Error('No se pudo generar el Excel');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links-imagenes.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message || 'Error al exportar el Excel');
  }
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function copyToClipboard(text, message) {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast(message))
    .catch(() => showToast('No se pudo copiar al portapapeles'));
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}
