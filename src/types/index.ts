import type { Lang } from '../utils/i18n';

/** A field localized into both supported languages. */
export type Localized = Record<Lang, string>;

export interface NavItem {
  key: string;
  href: string;
  icon?: string;
}

export interface Partner {
  id: string;
  name: Localized;
  shortName: string;
  logo: string;
  website?: string;
}

export interface ImplementingAgency {
  id: string;
  name: Localized;
  description: Localized;
}

export interface ContactPerson {
  name: Localized;
  title: Localized;
  phone: string;
  email: string;
}

export interface StatItem {
  key: string;
  value: Localized | string;
  icon?: string;
  label?: Localized;
}

export interface ProjectOutput {
  id: number;
  title: Localized;
  description?: Localized;
}
