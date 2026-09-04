import { requireUser } from '../auth.js';
import { recordAudit } from '../db.js';
import { store, listMedia, storageStatus } from '../storage/index.js';
import { page, escapeHtml, flashFrom } from '../views/layout.js';

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export default async function mediaRoutes(app) {
  app.get('/media', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const [status, items] = await Promise.all([storageStatus(), listMedia()]);

    const rows = items.length
      ? items
          .map(
            (item) => `<tr>
  <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name)}</a></td>
  <td>${formatBytes(item.size)}</td>
  <td><span class="tag ${item.driver}">${item.driver === 'minio' ? 'MinIO' : 'Repository'}</span></td>
  <td><button type="button" class="btn secondary copy-url" data-url="${escapeHtml(item.url)}">Copy link</button></td>
</tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="empty">Nothing uploaded yet.</td></tr>';

    return reply.type('text/html').send(
      page({
        title: 'Media',
        user: request.user,
        active: '/media',
        flash: flashFrom(request.query),
        wide: true,
        body: `
<div class="page-head">
  <h1>Media</h1>
</div>

<div class="card">
  <h2>Upload</h2>
  <p class="help">
    New files go to <strong>${status.driver === 'minio' ? 'MinIO object storage' : 'the GitHub repository'}</strong>.
    ${escapeHtml(status.reason)} Maximum ${status.maxUploadMb} MB.
  </p>
  <form method="post" action="/media/upload" enctype="multipart/form-data" class="upload-form">
    <input type="file" name="file" required>
    <select name="folder">
      <option value="reports">reports</option>
      <option value="resources">resources</option>
      <option value="images">images</option>
      <option value="uploads">uploads</option>
    </select>
    <button class="btn primary" type="submit">Upload</button>
  </form>
</div>

<table class="list">
  <thead><tr><th>File</th><th>Size</th><th>Stored in</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>`,
      })
    );
  });

  app.post('/media/upload', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const parts = request.parts();
    let file = null;
    let folder = 'uploads';

    for await (const part of parts) {
      if (part.type === 'file') {
        file = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        };
      } else if (part.fieldname === 'folder') {
        folder = String(part.value).replace(/[^a-z0-9-]/gi, '') || 'uploads';
      }
    }

    if (!file || !file.filename) return reply.redirect('/media?error=No file was selected.');

    try {
      const result = await store({
        buffer: file.buffer,
        fileName: file.filename,
        contentType: file.mimetype,
        folder,
        user: request.user,
      });
      await recordAudit({ user: request.user, action: 'upload', target: result.file, detail: { driver: result.driver } });
      return reply.redirect(`/media?ok=${encodeURIComponent(`Uploaded ${result.name} to ${result.driver === 'minio' ? 'MinIO' : 'the repository'}.`)}`);
    } catch (error) {
      request.log.error({ err: error }, 'upload failed');
      return reply.redirect(`/media?error=${encodeURIComponent(error.message)}`);
    }
  });

  /** Backs the "Choose…" picker in the entry editor. */
  app.get('/api/media', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    return reply.send({ items: await listMedia() });
  });
}
