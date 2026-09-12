// Build the real application — the same buildApp() server.js runs — and call
// ready() instead of listen(). This links every module (catching a missing named
// export) and builds the route tree (catching a duplicate or conflicting route)
// without touching Postgres or the GitHub API.
//
// Run twice by `npm test`: once at the origin, once with BASE_PATH=/admin, which
// is how production serves it under the public site. Every assertion below is
// written against config.basePath, so the second run proves the mount point
// reaches routes, links, redirects and static assets alike.
import { config } from '../src/config.js';
import { buildApp } from '../src/app.js';

const base = config.basePath;
const at = (path) => `${base}${path}`;
let failed = 0;

function check(ok, description, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${description}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

console.log(`\n--- mounted at ${base || '/'} ---`);

const app = await buildApp({ logger: false });
await app.ready();
console.log(app.printRoutes({ commonPrefix: false }));

// The login page must render for a signed-out visitor: it is the one view that
// has to work before anything else is reachable.
const login = await app.inject({ method: 'GET', url: at('/login') });
check(login.statusCode === 200, `GET ${at('/login')} renders`, String(login.statusCode));
for (const needle of ['name="username"', 'name="password"', at('/static/admin.css')]) {
  check(login.body.includes(needle), `login page contains ${needle}`);
}
check(
  login.body.includes(`action="${at('/login')}"`),
  'the login form posts to its mounted path'
);

// The whole point of the mount point: nothing may link above it, or the browser
// leaves the portal and lands on the public site's 404 page.
if (base) {
  const escaped = [...login.body.matchAll(/\b(?:href|src|action)="(\/[^"]*)"/g)]
    .map((match) => match[1])
    .filter((path) => path !== base && !path.startsWith(`${base}/`));
  check(escaped.length === 0, 'no link escapes the mount point', escaped.join(' '));
}

// An anonymous request to a protected page must redirect, not leak content — and
// must come back to the login page inside the mount point, carrying where it was
// going so the user lands there after signing in.
const guarded = await app.inject({ method: 'GET', url: at('/collections/news') });
check(guarded.statusCode === 302, `GET ${at('/collections/news')} redirects when anonymous`);
check(
  guarded.headers.location === `${at('/login')}?next=${encodeURIComponent(at('/collections/news'))}`,
  'the redirect keeps the mount point and the next parameter',
  guarded.headers.location
);

// Applied once, never twice: `next` already carries the prefix on the way in.
check(
  !guarded.headers.location.includes(`${base}${base}`) || !base,
  'the mount point is not applied twice'
);

// The healthcheck stays at the origin: the container probe talks to the process
// directly and never goes through the proxy.
const health = await app.inject({ method: 'GET', url: '/healthz' });
check(health.statusCode === 200 && health.body === '{"ok":true}', 'GET /healthz answers at the root');

// A path above the mount point belongs to the public site, not to the portal.
if (base) {
  const outside = await app.inject({ method: 'GET', url: '/collections/news' });
  check(outside.statusCode === 404, 'an unmounted path is not served', String(outside.statusCode));
}

await app.close();

if (failed) {
  console.error(`\n${failed} boot assertion(s) failed at base "${base || '/'}"`);
  process.exit(1);
}
console.log(`\nOK: module graph links, routes register, guards work, mount point holds (${base || '/'}).`);
