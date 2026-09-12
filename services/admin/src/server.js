/**
 * Process lifecycle: migrate, bootstrap, verify access, listen, shut down.
 * The application itself is built in app.js.
 */
import { config } from './config.js';
import { migrate } from './db.js';
import { bootstrapAdmin, purgeExpiredSessions } from './auth.js';
import { checkAccess } from './github.js';
import { buildApp } from './app.js';

const app = await buildApp();

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
