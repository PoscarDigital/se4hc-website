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

const [owner, repo] = optional('GITHUB_REPO', 'PoscarDigital/se4hc-website').split('/');

export const config = {
  port: Number(optional('PORT', '3000')),
  publicUrl: optional('ADMIN_PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),

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
