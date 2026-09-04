import { config } from './config.js';

/**
 * Minimal GitHub Contents API client.
 *
 * The portal keeps no local checkout: every read and write goes straight to
 * GitHub, so the repository is the only copy of the content and there is no
 * second store to drift out of sync with it. For a handful of editors the
 * request volume is trivial against the 5,000/hour authenticated limit.
 */

const API = 'https://api.github.com';
const { owner, repo, branch, token } = config.github;

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'se4hc-admin',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`GitHub ${method} ${path} failed: ${response.status} ${detail.slice(0, 400)}`);
    error.status = response.status;
    throw error;
  }

  return raw ? response.text() : response.json();
}

const contentsUrl = (path, ref = branch) =>
  `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`;

/** List a directory. Returns [] when it does not exist. */
export async function listDir(path) {
  const entries = await gh(contentsUrl(path));
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => ({ name: e.name, path: e.path, type: e.type, sha: e.sha, size: e.size }));
}

/**
 * Read a file. Returns `{ text, sha }`, or null when absent.
 *
 * The sha is the file's blob hash and is required to update it — GitHub rejects
 * a write carrying a stale one, which is what stops two editors from silently
 * overwriting each other.
 */
export async function readFile(path) {
  const meta = await gh(contentsUrl(path));
  if (!meta || Array.isArray(meta) || meta.type !== 'file') return null;
  const text = meta.content
    ? Buffer.from(meta.content, meta.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')
    : await gh(contentsUrl(path), { raw: true });
  return { text, sha: meta.sha, size: meta.size };
}

export async function fileSha(path) {
  const meta = await gh(contentsUrl(path));
  return meta && !Array.isArray(meta) ? meta.sha : null;
}

/**
 * Create or replace a file.
 *
 * Pass the `sha` from the read that the edit was based on. Omitting it creates
 * a new file and fails if one already exists, which is the behaviour we want
 * when an editor picks a slug that is already taken.
 */
export async function writeFile({ path, content, message, sha, author }) {
  const body = {
    message,
    branch,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
    ...(author ? { author: { name: author.name, email: author.email } } : {}),
  };

  const result = await gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    body,
  });
  return { sha: result.content.sha, commitSha: result.commit.sha };
}

export async function deleteFile({ path, message, sha, author }) {
  const resolved = sha ?? (await fileSha(path));
  if (!resolved) return null;
  const result = await gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    body: {
      message,
      branch,
      sha: resolved,
      ...(author ? { author: { name: author.name, email: author.email } } : {}),
    },
  });
  return { commitSha: result.commit.sha };
}

/**
 * Commit several files as a single commit, via the Git Data API.
 *
 * Saving an entry touches both the Khmer and the English file, and a run of
 * per-file Contents API writes would produce one commit — and therefore one CI
 * build and one deployment — per file. Building the tree explicitly keeps a
 * save to exactly one commit, and leaves the repository consistent even if the
 * request dies partway: nothing moves until the ref update at the end.
 *
 * `files` is a list of `{ path, content }` to write, or `{ path, delete: true }`.
 */
export async function commitFiles({ files, message, author }) {
  if (!files.length) return null;

  const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!ref) throw new Error(`Branch ${branch} not found in ${owner}/${repo}.`);
  const parentSha = ref.object.sha;

  const parent = await gh(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTree = parent.tree.sha;

  const tree = [];
  for (const file of files) {
    if (file.delete) {
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    // Blobs are uploaded separately so binary uploads survive intact; inlining
    // content in the tree would force it through UTF-8.
    const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: {
        content: Buffer.isBuffer(file.content)
          ? file.content.toString('base64')
          : Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      },
    });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: baseTree, tree },
  });

  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: newTree.sha,
      parents: [parentSha],
      ...(author ? { author: { ...author, date: new Date().toISOString() } } : {}),
    },
  });

  await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });

  return { commitSha: commit.sha };
}

/**
 * Commit attribution.
 *
 * Editors have no GitHub account, so commits are authored under a per-user
 * noreply address. The git history still shows who made each change.
 */
export function authorFor(user) {
  if (!user) return undefined;
  return {
    name: user.display_name || user.username,
    email: user.email || `${user.username}@users.noreply.se4hc.local`,
  };
}

/** Recent commits, for the dashboard's "what changed" list. */
export async function recentCommits(limit = 10) {
  const commits = await gh(
    `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`
  );
  if (!Array.isArray(commits)) return [];
  return commits.map((c) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author?.name ?? '',
    date: c.commit.author?.date ?? '',
    url: c.html_url,
  }));
}

/** Verify the token and branch at boot, so misconfiguration surfaces immediately. */
export async function checkAccess() {
  const info = await gh(`/repos/${owner}/${repo}`);
  if (!info) throw new Error(`Repository ${owner}/${repo} not found, or the token cannot see it.`);
  if (!info.permissions?.push) throw new Error(`Token lacks write access to ${owner}/${repo}.`);
  return { fullName: info.full_name, branch, private: info.private };
}

export const repoInfo = { owner, repo, branch };
