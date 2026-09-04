import { randomBytes } from 'node:crypto';
import { requireAdmin, hashPassword } from '../auth.js';
import { all, one, query, recordAudit } from '../db.js';
import { page, escapeHtml, field, flashFrom } from '../views/layout.js';

const formatDate = (value) => (value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') : '—');

export default async function userRoutes(app) {
  app.get('/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const users = await all('SELECT * FROM users ORDER BY username');

    const rows = users
      .map(
        (user) => `<tr class="${user.is_active ? '' : 'inactive'}">
  <td>${escapeHtml(user.username)}</td>
  <td>${escapeHtml(user.display_name)}</td>
  <td><span class="tag">${escapeHtml(user.role)}</span></td>
  <td>${user.is_active ? 'Active' : 'Disabled'}</td>
  <td>${formatDate(user.last_login_at)}</td>
  <td class="row-actions">
    <form method="post" action="/users/${user.id}/reset"
          onsubmit="return confirm('Issue a new temporary password for ${escapeHtml(user.username)}?')">
      <button class="btn secondary" type="submit">Reset password</button>
    </form>
    ${
      user.id === request.user.id
        ? ''
        : `<form method="post" action="/users/${user.id}/toggle">
      <button class="btn secondary" type="submit">${user.is_active ? 'Disable' : 'Enable'}</button>
    </form>`
    }
  </td>
</tr>`
      )
      .join('');

    return reply.type('text/html').send(
      page({
        title: 'Users',
        user: request.user,
        active: '/users',
        flash: flashFrom(request.query),
        wide: true,
        body: `
<div class="page-head"><h1>Users</h1></div>

<table class="list">
  <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<form method="post" action="/users" class="card">
  <h2>Add a user</h2>
  <p class="help">A temporary password is generated and shown once. The user must change it at first sign-in.</p>
  ${field({ type: 'text', name: 'username', label: 'Username', required: true })}
  ${field({ type: 'text', name: 'display_name', label: 'Display name', help: 'Shown on the commits their edits create.' })}
  ${field({ type: 'text', name: 'email', label: 'Email' })}
  ${field({ type: 'select', name: 'role', label: 'Role', options: ['editor', 'admin'] })}
  <button class="btn primary" type="submit">Create user</button>
</form>`,
      })
    );
  });

  app.post('/users', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const username = String(request.body?.username ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return reply.redirect('/users?error=Username must be 3-32 characters: letters, numbers, dot, dash or underscore.');
    }

    const existing = await one('SELECT id FROM users WHERE lower(username) = $1', [username]);
    if (existing) return reply.redirect('/users?error=That username is already taken.');

    const password = randomBytes(9).toString('base64url');
    const role = request.body?.role === 'admin' ? 'admin' : 'editor';

    await query(
      `INSERT INTO users (username, display_name, email, password_hash, role, must_change)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [
        username,
        String(request.body?.display_name ?? '').trim(),
        String(request.body?.email ?? '').trim(),
        hashPassword(password),
        role,
      ]
    );
    await recordAudit({ user: request.user, action: 'create_user', target: username, detail: { role } });

    return reply.redirect(
      `/users?ok=${encodeURIComponent(`Created ${username}. Temporary password: ${password} — copy it now, it is not shown again.`)}`
    );
  });

  app.post('/users/:id/reset', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const target = await one('SELECT * FROM users WHERE id = $1', [request.params.id]);
    if (!target) return reply.redirect('/users?error=User not found.');

    const password = randomBytes(9).toString('base64url');
    await query('UPDATE users SET password_hash = $1, must_change = TRUE WHERE id = $2', [
      hashPassword(password),
      target.id,
    ]);
    // Any session they still hold stops working immediately.
    await query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await recordAudit({ user: request.user, action: 'reset_password', target: target.username });

    return reply.redirect(
      `/users?ok=${encodeURIComponent(`New temporary password for ${target.username}: ${password} — copy it now, it is not shown again.`)}`
    );
  });

  app.post('/users/:id/toggle', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    const target = await one('SELECT * FROM users WHERE id = $1', [request.params.id]);
    if (!target) return reply.redirect('/users?error=User not found.');
    if (target.id === request.user.id) return reply.redirect('/users?error=You cannot disable your own account.');

    await query('UPDATE users SET is_active = NOT is_active WHERE id = $1', [target.id]);
    if (target.is_active) await query('DELETE FROM sessions WHERE user_id = $1', [target.id]);
    await recordAudit({
      user: request.user,
      action: target.is_active ? 'disable_user' : 'enable_user',
      target: target.username,
    });

    return reply.redirect(`/users?ok=${encodeURIComponent(`${target.username} ${target.is_active ? 'disabled' : 'enabled'}.`)}`);
  });
}
