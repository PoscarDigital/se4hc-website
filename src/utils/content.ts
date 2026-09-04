import type { CollectionEntry, CollectionKey } from 'astro:content';
import type { Lang } from './i18n';

/**
 * Derive an entry's language from its path rather than its frontmatter.
 *
 * Content lives at `src/content/<collection>/<lang>/<slug>.md`, so the folder
 * already encodes the language. Reading it from the path keeps a single source
 * of truth: an editor working in the CMS cannot save a `km/` entry that claims
 * `lang: en`, and the CMS never has to write a per-locale frontmatter field
 * (which its i18n model has no clean way to produce).
 */
export function langOf(entry: { id: string }): Lang {
  return entry.id.split('/')[0] === 'en' ? 'en' : 'km';
}

/** Filter predicate for `getCollection`: keep only entries in the given language. */
export function inLang<C extends CollectionKey>(lang: Lang) {
  return (entry: CollectionEntry<C>) => langOf(entry) === lang;
}
