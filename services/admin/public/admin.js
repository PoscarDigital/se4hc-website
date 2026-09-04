/**
 * Progressive enhancement for the editor.
 *
 * Everything here is optional: the forms submit and save without it. It adds
 * the repeating attachments group and the media picker, which are the two
 * places where a plain form would be genuinely painful to use.
 */

/* ------------------------------------------------------------ attachments -- */

const attachmentList = document.getElementById('attachments');
const attachmentTemplate = document.getElementById('attachment-template');

if (attachmentList && attachmentTemplate) {
  document.getElementById('add-attachment')?.addEventListener('click', () => {
    // Index off a counter rather than the row count, so removing a row and
    // adding another cannot produce two inputs with the same name.
    const index = Date.now();
    const html = attachmentTemplate.innerHTML.replaceAll('__INDEX__', String(index));
    attachmentList.insertAdjacentHTML('beforeend', html);
  });

  attachmentList.addEventListener('click', (event) => {
    if (event.target.classList.contains('remove-attachment')) {
      event.target.closest('.attachment-row')?.remove();
    }
  });
}

/* ---------------------------------------------------------- media picker --- */

let mediaCache = null;

async function loadMedia() {
  if (mediaCache) return mediaCache;
  const response = await fetch('/api/media');
  if (!response.ok) throw new Error('Could not load the media list.');
  mediaCache = (await response.json()).items ?? [];
  return mediaCache;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return value.toFixed(value >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
}

function buildDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'picker';
  dialog.innerHTML = `
    <div class="picker-head">
      <strong>Choose a file</strong>
      <button type="button" class="btn secondary" data-close>Close</button>
    </div>
    <div class="picker-body"><p class="help">Loading…</p></div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('click', (event) => {
    if (event.target.hasAttribute('data-close')) dialog.close();
  });
  return dialog;
}

async function pickMedia(onChoose) {
  const dialog = buildDialog();
  dialog.showModal();
  const body = dialog.querySelector('.picker-body');

  try {
    const items = await loadMedia();
    body.innerHTML = items.length
      ? items
          .map(
            (item, index) => `<div class="picker-item">
      <span class="picker-name">${item.name}</span>
      <span class="help">${formatBytes(item.size)} · ${item.driver === 'minio' ? 'MinIO' : 'Repository'}</span>
      <button type="button" class="btn secondary" data-pick="${index}">Select</button>
    </div>`
          )
          .join('')
      : '<p class="help">Nothing uploaded yet. Add files on the Media page first.</p>';

    body.addEventListener('click', (event) => {
      const index = event.target.getAttribute('data-pick');
      if (index === null) return;
      onChoose(items[Number(index)]);
      dialog.close();
    });
  } catch (error) {
    body.innerHTML = `<p class="flash error">${error.message}</p>`;
  }

  dialog.addEventListener('close', () => dialog.remove());
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.pick-media');
  if (!button) return;

  const targetId = button.getAttribute('data-target');
  const rowIndex = button.getAttribute('data-target-row');

  pickMedia((item) => {
    if (targetId) {
      const input = document.getElementById(targetId);
      if (input) input.value = item.url;
      return;
    }

    // Attachment row: carry the size across too. It is captured at upload time
    // because a file in object storage cannot be measured during the build.
    const row = button.closest('.attachment-row');
    if (!row) return;
    const file = row.querySelector('.att-file');
    const size = row.querySelector('.att-size');
    if (file) file.value = item.url;
    if (size) size.value = Number.isFinite(item.size) ? item.size : '';
    const label = row.querySelector('input[name*="[label]"]');
    if (label && !label.value) label.value = item.name;
  });
});

/* -------------------------------------------------------------- copy link -- */

document.addEventListener('click', async (event) => {
  const button = event.target.closest('.copy-url');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.getAttribute('data-url'));
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1500);
  } catch {
    // Clipboard access can be denied; the link is visible in the row anyway.
  }
});

/* ------------------------------------------------------ unsaved changes ---- */

const editForm = document.querySelector('main form[action*="/collections/"]');
if (editForm) {
  let dirty = false;
  editForm.addEventListener('input', () => { dirty = true; });
  editForm.addEventListener('submit', () => { dirty = false; });
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
