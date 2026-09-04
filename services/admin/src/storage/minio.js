import { Client } from 'minio';
import { config } from '../config.js';

/**
 * MinIO / S3-compatible object storage.
 *
 * Used for uploaded documents and images when it is available. Only the public
 * URL is committed to the repository, so large binaries stay out of git history
 * and clones stay small.
 */

const settings = config.storage.minio;
let client = null;
let bucketReady = false;

function parseEndpoint(endpoint) {
  const url = new URL(endpoint);
  return {
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    useSSL: url.protocol === 'https:',
  };
}

export function getClient() {
  if (client) return client;
  if (!settings.endpoint) throw new Error('MINIO_ENDPOINT is not set.');
  client = new Client({
    ...parseEndpoint(settings.endpoint),
    accessKey: settings.accessKey,
    secretKey: settings.secretKey,
    region: settings.region,
  });
  return client;
}

/**
 * Anonymous read on the bucket.
 *
 * These are published project documents — reports, leaflets, photos — linked
 * directly from public pages, so the objects have to be readable without
 * credentials. Write access stays with the service account.
 */
const PUBLIC_READ_POLICY = (bucket) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });

export async function ensureBucket() {
  if (bucketReady) return;
  const minio = getClient();
  const bucket = settings.bucket;

  if (!(await minio.bucketExists(bucket))) {
    await minio.makeBucket(bucket, settings.region);
  }
  try {
    await minio.setBucketPolicy(bucket, PUBLIC_READ_POLICY(bucket));
  } catch (error) {
    // A managed deployment may forbid policy changes; the bucket may already be
    // public by other means. Surface it without blocking the upload.
    error.nonFatal = true;
    throw error;
  }
  bucketReady = true;
}

/** Cheap reachability probe used by `auto` mode and the settings page. */
export async function isReachable() {
  try {
    await getClient().bucketExists(settings.bucket);
    return true;
  } catch {
    return false;
  }
}

export async function upload({ key, buffer, contentType }) {
  const minio = getClient();
  try {
    await ensureBucket();
  } catch (error) {
    if (!error.nonFatal) throw error;
  }

  await minio.putObject(settings.bucket, key, buffer, buffer.length, {
    'Content-Type': contentType || 'application/octet-stream',
  });

  return {
    url: `${settings.publicUrl}/${key}`,
    size: buffer.length,
    contentType,
  };
}

export async function remove(key) {
  await getClient().removeObject(settings.bucket, key);
}

/** List stored objects, newest first, for the media browser. */
export async function list(prefix = '', limit = 500) {
  const minio = getClient();
  const objects = [];
  await new Promise((resolve, reject) => {
    const stream = minio.listObjectsV2(settings.bucket, prefix, true);
    stream.on('data', (object) => {
      if (objects.length < limit) objects.push(object);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return objects
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
    .map((object) => ({
      key: object.name,
      name: object.name.split('/').pop(),
      size: object.size,
      url: `${settings.publicUrl}/${object.name}`,
      uploadedAt: object.lastModified,
      driver: 'minio',
    }));
}
