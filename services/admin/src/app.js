/**
 * Wiring: every plugin, hook, route and handler the portal runs.
 *
 * Kept apart from server.js so the boot test can build the real application and
 * assert against it. When the two were separate listings, a change here — the
 * mount point, for one — could not be covered by a test that had quietly gone
 * out of step.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { config } from './config.js';
import { loadUser } from './auth.js';
import { page } from './views/layout.js';
import { applyBase } from './paths.js';

import authRoutes from './routes/auth.js';
import entryRoutes from './routes/entries.js';
import dataRoutes from './routes/data.js';
import mediaRoutes from './routes/media.js';
import userRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';

const here = dirname(fileURLToPath(import.meta.url));

/** @param {{ logger?: unknown }} [options] test runs quiet, production logs. */
export async function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? { level: config.isProduction ? 'info' : 'debug' },
    // nginx terminates TLS in front of this service; without this, redirects and
    // secure cookies would be built from the container's own scheme and host.
    trustProxy: true,
    bodyLimit: config.storage.maxUploadBytes + 1024 * 1024,
  });

  await app.register(cookie, { secret: config.authSecret });
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });
  await app.register(fastifyStatic, {
    root: join(here, '..', 'public'),
    prefix: `${config.basePath}/static/`,
  });

  /** Every request knows who is making it; individual routes decide what to require. */
  app.addHook('preHandler', loadUser);

  // Redirects are written as root-relative paths at some thirty call sites, so the
  // mount point is applied to the Location header here instead of at each one.
  if (config.basePath) {
    app.addHook('onSend', async (request, reply, payload) => {
      const location = reply.getHeader('location');
      if (typeof location === 'string') reply.header('location', applyBase(location));
      return payload;
    });
  }

  // Liveness for the container healthcheck. Outside the mount point on purpose:
  // the probe talks to the container directly, never through the proxy.
  app.get('/healthz', async () => ({ ok: true }));

  // Everything else lives under the mount point. Registering the routes inside one
  // encapsulated scope means `prefix` applies to all of them at once, so mounting
  // the portal somewhere else is a configuration change and not a code change.
  await app.register(
    async (portal) => {
      await portal.register(authRoutes);
      await portal.register(settingsRoutes);
      await portal.register(entryRoutes);
      await portal.register(dataRoutes);
      await portal.register(mediaRoutes);
      await portal.register(userRoutes);
    },
    { prefix: config.basePath }
  );

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

  return app;
}
