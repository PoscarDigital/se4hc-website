import { extname } from 'node:path';
import { config, minioConfigured } from '../config.js';
import { commitFiles, authorFor, listDir, readFile } from '../github.js';
import { getSetting, setSetting } from '../settings.js';
import * as minio from './minio.js';

/**
 * Where uploaded files go.
 *
 * Two drivers behind one interface, chosen at runtime:
 *
 *   minio  — bytes to the bucket, only a URL in the repository
 *   github — bytes committed under public/documents, exactly as before MinIO
 *
 * `auto` prefers MinIO when it is configured and answering, and falls back to
 * GitHub otherwise, so a deployment without object storage still works and a
 * MinIO outage degrades to a slower upload instead of a failed one.
 */

const MANIFEST_PATH = 'src/data/media-manifest.json';
const SETTING_KEY = 'storage_driver';

export async function currentDriverSetting() {
  return (await getSetting(SETTING_KEY)) ?? config.storage.defaultDriver;
}

export async function setDriverSetting(driver, user) {
  if (!['auto', 'minio', 'github'].includes(driver)) throw new Error(`Unknown storage driver: ${driver}`);
  await setSetting(SETTING_KEY, driver, user);
}

/** Resolve the configured setting into the driver an upload would actually use. */
export async function resolveDriver() {
  const setting = await currentDriverSetting();
  if (setting === 'github') return { driver: 'github', setting, reason: 'Configured to always use the repository.' };

  if (!minioConfigured()) {
    if (setting === 'minio') {
      return { driver: 'minio', setting, reason: 'Forced to MinIO, but it is not configured.', broken: true };
    }
    return { driver: 'github', setting, reason: 'MinIO is not configured.' };
  }

  const reachable = await minio.isReachable();
  if (reachable) return { driver: 'minio', setting, reason: 'MinIO is configured and reachable.' };

  if (setting === 'minio') {
    return { driver: 'minio', setting, reason: 'Forced to MinIO, but it is not reachable.', broken: true };
  }
  return { driver: 'github', setting, reason: 'MinIO is configured but not reachable — falling back to the repository.' };
}

export async function storageStatus() {
  const resolved = await resolveDriver();
  return {
    ...resolved,
    minio: {
      configured: minioConfigured(),
      endpoint: config.storage.minio.endpoint || null,
      bucket: config.storage.minio.bucket,
      publicUrl: config.storage.minio.publicUrl || null,
      reachable: minioConfigured() ? await minio.isReachable() : false,
    },
    maxUploadMb: Math.round(config.storage.maxUploadBytes / 1024 / 1024),
  };
}

/** Keep uploaded names predictable and safe to put in a URL. */
export function safeFileName(name) {
  const ext = extname(name).toLowerCase();
  const stem = name
    .slice(0, name.length - ext.length)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
  return `${stem}${ext}`;
}

const keyFor = (folder, fileName) => `${folder}/${Date.now().toString(36)}-${fileName}`;

/**
 * Metadata for files held outside the repository.
 *
 * A remote object cannot be stat'd during the static build — the object store
 * is not reachable from CI — so its size is recorded here and committed with
 * the content. Repo-local files are stat'd directly and get no entry.
 */
async function recordInManifest({ url, size, contentType, user }) {
  const existing = await readFile(MANIFEST_PATH);
  const manifest = existing ? JSON.parse(existing.text) : { files: {} };
  manifest.files = manifest.files ?? {};
  manifest.files[url] = { size, mime: contentType || null, uploadedAt: new Date().toISOString() };

  return commitFiles({
    files: [{ path: MANIFEST_PATH, content: `${JSON.stringify(manifest, null, 2)}\n` }],
    message: `Record uploaded file metadata\n\nUploaded by ${user.display_name || user.username} via the admin portal.`,
    author: authorFor(user),
  });
}

/**
 * Store an uploaded file and return the reference to write into content.
 *
 * The returned `file` is what goes into frontmatter: an absolute URL for MinIO,
 * a `/documents/...` path for the repository. Both resolve identically at
 * render time — see utils/attachments.ts in the website.
 */
export async function store({ buffer, fileName, contentType, folder = 'uploads', user }) {
  if (buffer.length > config.storage.maxUploadBytes) {
    throw new Error(
      `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, over the ${Math.round(
        config.storage.maxUploadBytes / 1024 / 1024
      )} MB limit.`
    );
  }

  const safeName = safeFileName(fileName);
  const { driver, broken, reason } = await resolveDriver();
  if (broken) throw new Error(`Cannot upload: ${reason}`);

  if (driver === 'minio') {
    const key = keyFor(folder, safeName);
    const result = await minio.upload({ key, buffer, contentType });
    await recordInManifest({ url: result.url, size: result.size, contentType, user });
    return { file: result.url, size: result.size, driver: 'minio', name: safeName };
  }

  // GitHub driver: commit the bytes into the repository under public/documents.
  const path = `${config.github.uploadDir}/${folder}/${safeName}`;
  await commitFiles({
    files: [{ path, content: buffer }],
    message: `Upload ${safeName}\n\nUploaded by ${user.display_name || user.username} via the admin portal.`,
    author: authorFor(user),
  });

  // Strip the leading `public/` — frontmatter references paths as the browser
  // sees them, not as they sit on disk.
  const publicPath = `/${path.replace(/^public\//, '')}`;
  return { file: publicPath, size: buffer.length, driver: 'github', name: safeName };
}

/** Everything available to attach, from whichever stores are in play. */
export async function listMedia() {
  const items = [];

  if (minioConfigured() && (await minio.isReachable())) {
    try {
      items.push(...(await minio.list()));
    } catch {
      // A listing failure must not take the media page down.
    }
  }

  const walk = async (dir) => {
    for (const entry of await listDir(dir)) {
      if (entry.type === 'dir') await walk(entry.path);
      else if (entry.type === 'file') {
        items.push({
          key: entry.path,
          name: entry.name,
          size: entry.size,
          url: `/${entry.path.replace(/^public\//, '')}`,
          uploadedAt: null,
          driver: 'github',
        });
      }
    }
  };
  await walk(config.github.uploadDir);

  return items;
}
