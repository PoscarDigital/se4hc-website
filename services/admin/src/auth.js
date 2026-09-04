import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from './config.js';
import { query, one, recordAudit } from './db.js';

const SESSION_COOKIE = 'se4hc_session';
const SESSION_DAYS = 7;
const SCRYPT_KEYLEN = 64;

/**
 * Password hashing uses scrypt from Node's standard library — no native build
 * step, no third-party dependency to keep patched, and memory-hard by design.
 * Stored as `scrypt$<salt-hex>$<hash-hex>`.
 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Sessions are server-side and revocable: the cookie carries a random token and
 * the database stores only its HMAC. Reading the table therefore never yields a
 * usable credential, and deactivating a user kills their sessions at once.
 */
const tokenHash = (token) => createHmac('sha256', config.authSecret).update(token).digest('hex');

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    tokenHash(token),
    userId,
    expires,
  ]);
  return { token, expires };
}

export async function destroySession(token) {
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
}

export async function purgeExpiredSessions() {
  await query('DELETE FROM sessions WHERE expires_at < now()');
}

export async function userForToken(token) {
  if (!token) return null;
  return one(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [tokenHash(token)]
  );
}

export function setSessionCookie(reply, { token, expires }) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    expires,
  });
}

export function clearSessionCookie(reply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const readSessionCookie = (request) => request.cookies?.[SESSION_COOKIE];

/** Attach `request.user` to every request; routes decide what to do about it. */
export async function loadUser(request) {
  request.user = await userForToken(readSessionCookie(request));
}

/** Send anonymous visitors to the login page, preserving where they were going. */
export function requireUser(request, reply) {
  if (request.user) return true;
  reply.redirect('/login?next=' + encodeURIComponent(request.url));
  return false;
}

export function requireAdmin(request, reply) {
  if (!requireUser(request, reply)) return false;
  if (request.user.role !== 'admin') {
    reply.code(403).type('text/html').send('<h1>403 — administrators only</h1>');
    return false;
  }
  return true;
}

const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

export async function authenticate(username, password) {
  const user = await one('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  // Always run a verification, so an unknown username and a wrong password
  // take the same time to reject.
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) return null;
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return user;
}

/**
 * Create the first administrator on an empty database, so a fresh deployment is
 * reachable without shelling into the container.
 */
export async function bootstrapAdmin(log) {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return;

  const generated = !config.bootstrap.password;
  const password = config.bootstrap.password || randomBytes(12).toString('base64url');

  await query(
    `INSERT INTO users (username, display_name, password_hash, role, must_change)
     VALUES ($1, $2, $3, 'admin', TRUE)`,
    [config.bootstrap.username, 'Administrator', hashPassword(password)]
  );
  await recordAudit({ user: null, action: 'bootstrap_admin', target: config.bootstrap.username });

  log.warn(
    `Created initial admin "${config.bootstrap.username}". ` +
      (generated
        ? `Generated password: ${password}  <- shown once. Change it after first login.`
        : 'Password taken from BOOTSTRAP_ADMIN_PASSWORD. Change it after first login.')
  );
}
