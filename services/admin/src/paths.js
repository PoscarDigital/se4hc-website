/**
 * Where the portal is mounted.
 *
 * In development it owns the origin and `basePath` is empty. In production it is
 * served at a path on the public site — `https://se4hc.moeys.gov.kh/admin` — so
 * every link, form action, redirect and the session cookie has to carry that
 * prefix, or the browser walks straight out of the portal and into the website's
 * 404 page.
 *
 * Rather than prefixing 50-odd call sites and hoping every future route
 * remembers, this module holds the two chokepoints every URL already passes
 * through: `applyBase` for `Location` headers, `withBase` for rendered HTML.
 */
import { config } from './config.js';

/** Prefix one root-relative path. Idempotent, and leaves other URLs alone. */
export function applyBase(path, base = config.basePath) {
  if (!base || typeof path !== 'string') return path;
  // Not ours to touch: absolute URLs, protocol-relative ones, and anything
  // already mounted. The `${base}/` test rather than `base` is deliberate —
  // without the slash, a future route named /administrators would look like it
  // was already prefixed and silently escape the mount point.
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

const ATTRIBUTE_URL = /\b(href|src|action)="(\/[^"]*)"/g;

/**
 * Rewrite the root-relative URLs in a rendered document.
 *
 * Safe because every interpolated value is escaped before it reaches here: a
 * quote becomes `&quot;`, so `href="/…"` can only have come from this codebase,
 * never from an entry title or a filename someone uploaded.
 */
export function withBase(html, base = config.basePath) {
  if (!base) return html;
  return String(html).replace(ATTRIBUTE_URL, (match, attribute, path) => {
    const mounted = applyBase(path, base);
    return mounted === path ? match : `${attribute}="${mounted}"`;
  });
}
