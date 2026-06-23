import kmTranslations from '../data/i18n/km.json';
import enTranslations from '../data/i18n/en.json';

const translations = {
  km: kmTranslations,
  en: enTranslations,
} as const;

export type Lang = 'km' | 'en';

export const defaultLang: Lang = 'km';
export const locales: Lang[] = ['km', 'en'];

/**
 * Derive the active language from the request URL.
 * Khmer is the default locale and is served without a prefix;
 * English lives under the `/en` prefix.
 */
export function getLangFromUrl(url: URL): Lang {
  const [, segment] = url.pathname.split('/');
  if (segment === 'en') return 'en';
  return 'km';
}

/**
 * Returns a translator bound to the given language. Supports dotted
 * key paths (e.g. `t('nav.home')`); falls back to the key when missing.
 */
export function useTranslations(lang: Lang) {
  return function t(key: string): string {
    const keys = key.split('.');
    let value: unknown = translations[lang];
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }
    return typeof value === 'string' ? value : key;
  };
}

/**
 * Prefix a root-relative path with the locale segment.
 * Khmer paths are returned unchanged; English paths gain an `/en` prefix.
 */
export function getLocalizedPath(path: string, lang: Lang): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (lang === 'km') return clean;
  return clean === '/' ? '/en' : `/en${clean}`;
}

/**
 * Strip the locale prefix from a pathname, yielding the language-neutral
 * route (always starting with `/`).
 */
export function getRoutePath(pathname: string): string {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, '');
  return stripped === '' ? '/' : stripped;
}

/**
 * Compute the equivalent path in the other language for a given pathname.
 */
export function getAlternatePath(pathname: string, lang: Lang): string {
  const route = getRoutePath(pathname);
  return lang === 'km' ? getLocalizedPath(route, 'en') : route;
}
