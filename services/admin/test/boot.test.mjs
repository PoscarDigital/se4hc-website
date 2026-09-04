// Build the app exactly as server.js does, but call ready() instead of listen().
// This links every module (catching missing named exports) and builds the route
// tree (catching duplicate or conflicting routes) without touching Postgres or
// the GitHub API.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { config } from '../src/config.js';
import { loadUser } from '../src/auth.js';
import authRoutes from '../src/routes/auth.js';
import entryRoutes from '../src/routes/entries.js';
import dataRoutes from '../src/routes/data.js';
import mediaRoutes from '../src/routes/media.js';
import userRoutes from '../src/routes/users.js';
import settingsRoutes from '../src/routes/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: false, trustProxy: true });

await app.register(cookie, { secret: config.authSecret });
await app.register(formbody);
await app.register(multipart, { limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });
await app.register(fastifyStatic, { root: join(here, '..', 'public'), prefix: '/static/' });
app.addHook('preHandler', loadUser);
app.get('/healthz', async () => ({ ok: true }));
await app.register(authRoutes);
await app.register(settingsRoutes);
await app.register(entryRoutes);
await app.register(dataRoutes);
await app.register(mediaRoutes);
await app.register(userRoutes);

await app.ready();
console.log(app.printRoutes({ commonPrefix: false }));

// The login page must render for a signed-out visitor: it is the one view that
// has to work before anything else is reachable.
const res = await app.inject({ method: 'GET', url: '/login' });
console.log('GET /login ->', res.statusCode);
if (res.statusCode !== 200) { console.error('login page did not render'); process.exit(1); }
for (const needle of ['name="username"', 'name="password"', 'admin.css']) {
  if (!res.body.includes(needle)) { console.error('login page missing ' + needle); process.exit(1); }
}
console.log('login page renders with the expected form');

// An anonymous request to a protected page must redirect, not leak content.
const guarded = await app.inject({ method: 'GET', url: '/collections/news' });
console.log('GET /collections/news (anonymous) ->', guarded.statusCode, guarded.headers.location ?? '');
if (guarded.statusCode !== 302) { console.error('protected route did not redirect'); process.exit(1); }

const health = await app.inject({ method: 'GET', url: '/healthz' });
console.log('GET /healthz ->', health.statusCode, health.body);

await app.close();
console.log('\nOK: module graph links, routes register, guards work.');
