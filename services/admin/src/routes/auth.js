import {
  authenticate,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  requireUser,
  hashPassword,
  verifyPassword,
} from '../auth.js';
import { query, recordAudit } from '../db.js';
import { page, escapeHtml, field, flashFrom } from '../views/layout.js';

/** Only ever redirect within this app — never to a host supplied in the query. */
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default async function authRoutes(app) {
  app.get('/login', async (request, reply) => {
    if (request.user) return reply.redirect('/');
    const next = safeNext(request.query.next);

    return reply.type('text/html').send(
      page({
        title: 'Sign in',
        user: null,
        flash: flashFrom(request.query),
        body: `
<div class="login">
  <h1>SE4HC <span>Admin</span></h1>
  <p class="sub">Sign in to manage the project website.</p>
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    ${field({ type: 'text', name: 'username', label: 'Username', required: true })}
    <div class="field">
      <label for="f_password">Password</label>
      <input type="password" id="f_password" name="password" required>
    </div>
    <button class="btn primary" type="submit">Sign in</button>
  </form>
</div>`,
      })
    );
  });

  app.post('/login', async (request, reply) => {
    const { username = '', password = '', next } = request.body ?? {};
    const user = await authenticate(username, password);

    if (!user) {
      request.log.warn({ username, ip: request.ip }, 'failed login');
      const params = new URLSearchParams({ error: 'Incorrect username or password.', next: safeNext(next) });
      return reply.redirect(`/login?${params}`);
    }

    setSessionCookie(reply, await createSession(user.id));
    await recordAudit({ user, action: 'login' });
    return reply.redirect(user.must_change ? '/account?error=Please choose a new password.' : safeNext(next));
  });

  app.post('/logout', async (request, reply) => {
    await destroySession(readSessionCookie(request));
    clearSessionCookie(reply);
    return reply.redirect('/login');
  });

  app.get('/account', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const user = request.user;

    return reply.type('text/html').send(
      page({
        title: 'My account',
        user,
        flash: flashFrom(request.query),
        body: `
<h1>My account</h1>
${user.must_change ? '<div class="flash warn">You are using a temporary password. Please set a new one.</div>' : ''}

<form method="post" action="/account" class="card">
  <h2>Profile</h2>
  ${field({ type: 'text', name: 'display_name', label: 'Display name', value: user.display_name, help: 'Shown on the commits your edits create.' })}
  ${field({ type: 'text', name: 'email', label: 'Email', value: user.email })}
  <button class="btn primary" type="submit">Save profile</button>
</form>

<form method="post" action="/account/password" class="card">
  <h2>Change password</h2>
  <div class="field">
    <label for="current_password">Current password</label>
    <input type="password" id="current_password" name="current_password" required>
  </div>
  <div class="field">
    <label for="new_password">New password</label>
    <input type="password" id="new_password" name="new_password" minlength="10" required>
    <p class="help">At least 10 characters.</p>
  </div>
  <button class="btn primary" type="submit">Change password</button>
</form>`,
      })
    );
  });

  app.post('/account', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const { display_name = '', email = '' } = request.body ?? {};
    await query('UPDATE users SET display_name = $1, email = $2 WHERE id = $3', [
      display_name.trim(),
      email.trim(),
      request.user.id,
    ]);
    return reply.redirect('/account?ok=Profile updated.');
  });

  app.post('/account/password', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;
    const { current_password = '', new_password = '' } = request.body ?? {};

    if (!verifyPassword(current_password, request.user.password_hash)) {
      return reply.redirect('/account?error=Current password is incorrect.');
    }
    if (new_password.length < 10) {
      return reply.redirect('/account?error=New password must be at least 10 characters.');
    }

    await query('UPDATE users SET password_hash = $1, must_change = FALSE WHERE id = $2', [
      hashPassword(new_password),
      request.user.id,
    ]);
    // Other sessions for this account are dropped, so a password change also
    // ends any session someone else may have been holding.
    await query('DELETE FROM sessions WHERE user_id = $1', [request.user.id]);
    setSessionCookie(reply, await createSession(request.user.id));
    await recordAudit({ user: request.user, action: 'change_password' });

    return reply.redirect('/account?ok=Password changed.');
  });
}
