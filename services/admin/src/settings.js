import { one, query } from './db.js';

/**
 * Runtime settings.
 *
 * Small key/value store for things an administrator changes from the portal
 * rather than by editing the environment and restarting — currently the storage
 * driver. Environment variables remain the boot default; a value here overrides
 * one once it has been set deliberately.
 */

export async function getSetting(key) {
  const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value, user) {
  await query(
    `INSERT INTO settings (key, value, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), user?.username ?? '']
  );
}

export async function allSettings() {
  const { rows } = await query('SELECT key, value, updated_at, updated_by FROM settings ORDER BY key');
  return rows;
}
