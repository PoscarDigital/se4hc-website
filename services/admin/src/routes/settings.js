import { requireAdmin, requireUser } from '../auth.js';
import { recordAudit, all } from '../db.js';
import { storageStatus, setDriverSetting, currentDriverSetting } from '../storage/index.js';
import { recentCommits, repoInfo } from '../github.js';
import { COLLECTIONS } from '../schema.js';
import { listEntries } from '../content.js';
import { page, escapeHtml, flashFrom } from '../views/layout.js';

export default async function settingsRoutes(app) {
  /** Dashboard. */
  app.get('/', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const [commits, status, counts] = await Promise.all([
      recentCommits(8).catch(() => []),
      storageStatus(),
      Promise.all(
        COLLECTIONS.map(async (collection) => {
          const entries = await listEntries(collection.name);
          return {
            ...collection,
            total: entries.length,
            incomplete: entries.filter((e) => !e.complete).length,
          };
        })
      ),
    ]);

    const totalIncomplete = counts.reduce((sum, c) => sum + c.incomplete, 0);

    return reply.type('text/html').send(
      page({
        title: 'Dashboard',
        user: request.user,
        active: '/',
        flash: flashFrom(request.query),
        wide: true,
        body: `
<div class="page-head">
  <div>
    <h1>Dashboard</h1>
    <p class="help">Editing <code>${escapeHtml(repoInfo.owner)}/${escapeHtml(repoInfo.repo)}</code> on branch <code>${escapeHtml(repoInfo.branch)}</code>.</p>
  </div>
</div>

${
  totalIncomplete
    ? `<div class="flash warn">${totalIncomplete} entr${totalIncomplete === 1 ? 'y is' : 'ies are'} missing a translation. The site build rejects these, so publishing is blocked until both languages exist.</div>`
    : ''
}

<div class="cards">
${counts
  .map(
    (collection) => `<a class="card link stat" href="/collections/${collection.name}">
  <span class="count">${collection.total}</span>
  <h2>${escapeHtml(collection.label)}</h2>
  <p class="km">${escapeHtml(collection.labelKm)}</p>
  ${collection.incomplete ? `<p class="warn-text">${collection.incomplete} untranslated</p>` : ''}
</a>`
  )
  .join('')}
</div>

<div class="card">
  <h2>File uploads</h2>
  <p>Going to <strong>${status.driver === 'minio' ? 'MinIO object storage' : 'the GitHub repository'}</strong>. ${escapeHtml(status.reason)}</p>
</div>

<div class="card">
  <h2>Recent changes</h2>
  ${
    commits.length
      ? `<ul class="commits">${commits
          .map(
            (commit) => `<li>
    <code>${escapeHtml(commit.sha)}</code>
    <span>${escapeHtml(commit.message)}</span>
    <em>${escapeHtml(commit.author)} · ${escapeHtml(commit.date.slice(0, 16).replace('T', ' '))}</em>
  </li>`
          )
          .join('')}</ul>`
      : '<p class="help">Could not read the commit history.</p>'
  }
</div>`,
      })
    );
  });

  app.get('/settings', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const [status, setting, audit] = await Promise.all([
      storageStatus(),
      currentDriverSetting(),
      all('SELECT username, action, target, commit_sha, created_at FROM audit_log ORDER BY created_at DESC LIMIT 30'),
    ]);

    const option = (value, title, description) => `
<label class="radio">
  <input type="radio" name="driver" value="${value}"${setting === value ? ' checked' : ''}>
  <span><strong>${escapeHtml(title)}</strong><br><span class="help">${escapeHtml(description)}</span></span>
</label>`;

    return reply.type('text/html').send(
      page({
        title: 'Settings',
        user: request.user,
        active: '/settings',
        flash: flashFrom(request.query),
        wide: true,
        body: `
<div class="page-head"><h1>Settings</h1></div>

<form method="post" action="/settings/storage" class="card">
  <h2>File storage</h2>
  <p class="help">Where uploaded documents and images are kept. Existing files are unaffected by a change here — only new uploads follow the new setting.</p>

  ${option('auto', 'Automatic (recommended)', 'Use MinIO when it is configured and reachable; otherwise commit files into the repository.')}
  ${option('minio', 'Always MinIO', 'Fail the upload rather than falling back. Use when object storage is mandatory.')}
  ${option('github', 'Always the repository', 'Commit every file into the repository, as before MinIO was introduced.')}

  <div class="status-box">
    <h3>Current state</h3>
    <table class="kv">
      <tr><th>Uploads go to</th><td><strong>${status.driver === 'minio' ? 'MinIO' : 'GitHub repository'}</strong> — ${escapeHtml(status.reason)}</td></tr>
      <tr><th>MinIO configured</th><td>${status.minio.configured ? 'Yes' : 'No — MINIO_ENDPOINT, credentials or MINIO_PUBLIC_URL are unset'}</td></tr>
      <tr><th>MinIO reachable</th><td>${status.minio.reachable ? 'Yes' : 'No'}</td></tr>
      <tr><th>Endpoint</th><td><code>${escapeHtml(status.minio.endpoint ?? '—')}</code></td></tr>
      <tr><th>Bucket</th><td><code>${escapeHtml(status.minio.bucket)}</code></td></tr>
      <tr><th>Public URL</th><td><code>${escapeHtml(status.minio.publicUrl ?? '—')}</code></td></tr>
      <tr><th>Upload limit</th><td>${status.maxUploadMb} MB</td></tr>
    </table>
  </div>

  <button class="btn primary" type="submit">Save storage setting</button>
</form>

<div class="card">
  <h2>Recent activity</h2>
  <table class="list">
    <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Commit</th></tr></thead>
    <tbody>${
      audit.length
        ? audit
            .map(
              (row) => `<tr>
      <td>${escapeHtml(new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' '))}</td>
      <td>${escapeHtml(row.username)}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.target)}</td>
      <td>${row.commit_sha ? `<code>${escapeHtml(row.commit_sha.slice(0, 7))}</code>` : '—'}</td>
    </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="empty">Nothing recorded yet.</td></tr>'
    }</tbody>
  </table>
</div>`,
      })
    );
  });

  app.post('/settings/storage', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const driver = request.body?.driver;
    try {
      await setDriverSetting(driver, request.user);
      await recordAudit({ user: request.user, action: 'set_storage_driver', target: driver });
      return reply.redirect(`/settings?ok=${encodeURIComponent(`Storage setting saved: ${driver}.`)}`);
    } catch (error) {
      return reply.redirect(`/settings?error=${encodeURIComponent(error.message)}`);
    }
  });
}
