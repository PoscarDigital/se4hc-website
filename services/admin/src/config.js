/**
 * Environment configuration.
 *
 * Anything the operator must set has no default and fails fast at boot — a
 * portal that starts with a missing GitHub token would appear healthy and then
 * silently fail on the first save, which is worse than not starting.
 */

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name, fallback = '') {
  return process.env[name] || fallback;
}

/**
 * Normalize a mount point: no trailing slash, a leading one required.
 *
 * A malformed value would not fail here but in every generated link, so it is
 * rejected at boot alongside the other required configuration.
 */
function basePath(value) {
  const path = value.trim().replace(/\/+$/, '');
  if (!path) return '';
  if (!path.startsWith('/')) throw new Error(`BASE_PATH must start with "/": ${value}`);
  if (/[?#\s]/.test(path)) throw new Error(`BASE_PATH must be a plain path: ${value}`);
  return path;
}

const [owner, repo] = optional('GITHUB_REPO', 'PoscarDigital/se4hc-website').split('/');

export const config = {
  port: Number(optional('PORT', '3000')),
  publicUrl: optional('ADMIN_PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),

  /**
   * Path the portal is served at. Empty means it owns the origin, which is how
   * it runs in development. Production serves it under the public site's domain
   * at `/admin`, and src/paths.js applies it to every URL the app emits.
   */
  basePath: basePath(optional('BASE_PATH', '')),

  databaseUrl: required('DATABASE_URL'),
  authSecret: required('AUTH_SECRET'),

  github: {
    owner,
    repo,
    branch: optional('GITHUB_BRANCH', 'main'),
    token: required('GITHUB_TOKEN'),
    /** Where uploaded files are committed when the GitHub storage driver is used. */
    uploadDir: optional('GITHUB_UPLOAD_DIR', 'public/documents'),
  },

  storage: {
    /** auto | minio | github — the boot default; overridable at runtime in Settings. */
    defaultDriver: optional('STORAGE_DRIVER', 'auto'),
    maxUploadBytes: Number(optional('MAX_UPLOAD_MB', '64')) * 1024 * 1024,
    minio: {
      endpoint: optional('MINIO_ENDPOINT'),
      bucket: optional('MINIO_BUCKET', 'se4hc-media'),
      accessKey: optional('MINIO_ACCESS_KEY'),
      secretKey: optional('MINIO_SECRET_KEY'),
      region: optional('MINIO_REGION', 'us-east-1'),
      /** Origin written into committed frontmatter — must be publicly reachable. */
      publicUrl: optional('MINIO_PUBLIC_URL').replace(/\/$/, ''),
    },
  },

  /** Credentials for the first admin account, created on an empty database. */
  bootstrap: {
    username: optional('BOOTSTRAP_ADMIN_USER', 'admin'),
    password: optional('BOOTSTRAP_ADMIN_PASSWORD'),
  },

  isProduction: process.env.NODE_ENV === 'production',
};

/** True when MinIO has enough configuration to be worth trying at all. */
export function minioConfigured() {
  const m = config.storage.minio;
  return Boolean(m.endpoint && m.accessKey && m.secretKey && m.publicUrl);
}
