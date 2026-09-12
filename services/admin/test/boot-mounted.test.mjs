// The boot test again, with the portal mounted at /admin as production serves it.
//
// Spawned rather than written as `BASE_PATH=/admin node test/boot.test.mjs` in
// the npm script: the inline env-var prefix is POSIX shell syntax, and on the
// Windows machines this project is developed on npm runs scripts through
// cmd.exe, where it is a syntax error. config.js reads the environment at import
// time, so a second process is the way to test a second mount point.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['test/boot.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, BASE_PATH: '/admin' },
});

process.exit(result.status ?? 1);
