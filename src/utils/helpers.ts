import type { Lang } from './i18n';

/** A string field that has been localized into both supported languages. */
export type Localized = Record<Lang, string>;

/** Pick the value for the active language from a localized field. */
export function localize(field: Localized, lang: Lang): string {
  return field[lang] ?? field.en ?? '';
}

/** Format a USD amount as e.g. "$83.92 million". */
export function formatMillions(amount: number): string {
  const millions = amount / 1_000_000;
  return `$${millions.toFixed(2)} million`;
}

/** Format a USD amount with thousands separators, e.g. "$901,264". */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format an ISO date string for display in the given language. Empty string when no date. */
export function formatDate(iso: string | Date | undefined | null, lang: Lang): string {
  if (!iso) return '';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(lang === 'km' ? 'km-KH' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Slugify a string for use in routes/ids. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Derive a clean route slug from a content entry id (strips lang prefix and .md). */
export function entrySlug(id: string): string {
  return id.replace(/^(km|en)\//, '').replace(/\.(md|mdx)$/, '');
}

/** Resolve a public asset path, honoring the configured base path. */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}
