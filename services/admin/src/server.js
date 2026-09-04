import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { config } from './config.js';
import { migrate } from './db.js';
import { loadUser, bootstrapAdmin, purgeExpiredSessions } from './auth.js';
import { checkAccess } from './github.js';
import { page } from './views/layout.js';

import authRoutes from './routes/auth.js';
import entryRoutes from './routes/entries.js';
import dataRoutes from './routes/data.js';
import mediaRoutes from './routes/media.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';

const here = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: { level: config.isProduction ? 'info' : 'debug' },
  // Caddy terminates TLS in front of this service; without this, redirects and
  // secure cookies would be built from the container's own scheme and host.
  trustProxy: true,
  bodyLimit: config.storage.maxUploadBytes + 1024 * 1024,
});

await app.register(cookie, { secret: config.authSecret });
await app.register(formbody);
await app.register(multipart, { limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });
await app.register(fastifyStatic, { root: join(here, '..', 'public'), prefix: '/static/' });

/** Every request knows who is making it; individual routes decide what to require. */
app.addHook('preHandler', loadUser);

// Liveness for the container healthcheck. Deliberately unauthenticated and
// dependency-free: it answers whether the process is up, nothing more.
app.get('/healthz', async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(settingsRoutes);
await app.register(entryRoutes);
await app.register(dataRoutes);
await app.register(mediaRoutes);
await app.register(userRoutes);

app.setNotFoundHandler((request, reply) => {
  reply
    .code(404)
    .type('text/html')
    .send(page({ title: 'Not found', user: request.user, body: '<h1>404</h1><p>That page does not exist.</p>' }));
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  // GitHub API failures are the likely cause and their messages are useful, but
  // they can carry repository detail, so only signed-in staff see them.
  const detail = request.user ? error.message : 'Something went wrong. Please try again.';
  reply
    .code(error.statusCode ?? 500)
    .type('text/html')
    .send(
      page({
        title: 'Error',
        user: request.user,
        flash: { type: 'error', message: detail },
        body: '<h1>Something went wrong</h1><p><a href="/">Back to the dashboard</a></p>',
      })
    );
});

async function start() {
  await migrate();
  await bootstrapAdmin(app.log);
  await purgeExpiredSessions();

  // Fail fast on a bad token or branch: the portal would otherwise look healthy
  // and only break when someone tried to save.
  try {
    const repo = await checkAccess();
    app.log.info(`GitHub OK — ${repo.fullName} (${repo.branch})`);
  } catch (error) {
    app.log.error(`GitHub access check failed: ${error.message}`);
    throw error;
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

// Expired sessions are cleared hourly; they are already rejected on read, this
// just stops the table growing without bound.
setInterval(() => purgeExpiredSessions().catch(() => {}), 3600_000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
