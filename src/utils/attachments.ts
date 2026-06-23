import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Lang } from './i18n';

export type AttachmentKind = 'pdf' | 'image' | 'word' | 'excel' | 'powerpoint' | 'archive' | 'video' | 'audio' | 'file';

export interface ResolvedAttachment {
  /** Path under /public, e.g. /documents/reports/foo.pdf */
  file: string;
  /** URL honoring the configured base path. */
  href: string;
  /** Display label (falls back to the file name). */
  label: string;
  /** Uppercase extension, e.g. "PDF". */
  ext: string;
  kind: AttachmentKind;
  /** Whether the file can be embedded/previewed inline in the browser. */
  viewable: boolean;
  /** Human-readable size (e.g. "2.3 MB"), or null if the file is missing. */
  size: string | null;
  featured: boolean;
}

const EXT_KIND: Record<string, AttachmentKind> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  doc: 'word', docx: 'word',
  xls: 'excel', xlsx: 'excel', csv: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio',
};

/** Kinds we can render directly in the browser. */
const VIEWABLE: AttachmentKind[] = ['pdf', 'image', 'video', 'audio'];

function extOf(file: string): string {
  const m = file.toLowerCase().match(/\.([a-z0-9]+)(?:\?.*)?$/);
  return m ? m[1] : '';
}

function fileNameOf(file: string): string {
  return decodeURIComponent(file.split('/').pop() ?? file);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Read the on-disk size of a file under /public. Returns null if missing. */
function sizeOf(file: string): string | null {
  try {
    const clean = file.replace(/^\//, '').split('?')[0];
    const url = new URL(`../../public/${clean}`, import.meta.url);
    const stat = statSync(fileURLToPath(url));
    return formatBytes(stat.size);
  } catch {
    return null;
  }
}

export interface RawAttachment {
  file: string;
  label?: string;
  featured?: boolean;
}

/** Resolve a raw frontmatter attachment into render-ready metadata. */
export function resolveAttachment(raw: RawAttachment, base: string): ResolvedAttachment {
  const ext = extOf(raw.file);
  const kind = EXT_KIND[ext] ?? 'file';
  const cleanBase = base.replace(/\/$/, '');
  const path = raw.file.startsWith('/') ? raw.file : `/${raw.file}`;
  return {
    file: raw.file,
    href: `${cleanBase}${path}`,
    label: raw.label ?? fileNameOf(raw.file),
    ext: ext.toUpperCase(),
    kind,
    viewable: VIEWABLE.includes(kind),
    size: sizeOf(raw.file),
    featured: raw.featured ?? false,
  };
}

/** Resolve and order a list: featured first, then viewable, preserving order otherwise. */
export function resolveAttachments(raw: RawAttachment[] | undefined, base: string): ResolvedAttachment[] {
  if (!raw || raw.length === 0) return [];
  const resolved = raw.map((r) => resolveAttachment(r, base));
  return resolved
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      if (x.a.featured !== y.a.featured) return x.a.featured ? -1 : 1;
      if (x.a.viewable !== y.a.viewable) return x.a.viewable ? -1 : 1;
      return x.i - y.i;
    })
    .map(({ a }) => a);
}

/** Short localized label for an attachment kind. */
export function kindLabel(kind: AttachmentKind, lang: Lang): string {
  const labels: Record<AttachmentKind, Record<Lang, string>> = {
    pdf: { en: 'PDF Document', km: 'ឯកសារ PDF' },
    image: { en: 'Image', km: 'រូបភាព' },
    word: { en: 'Word Document', km: 'ឯកសារ Word' },
    excel: { en: 'Spreadsheet', km: 'សៀវភៅបញ្ជី' },
    powerpoint: { en: 'Presentation', km: 'បទបង្ហាញ' },
    archive: { en: 'Archive', km: 'ឯកសារបង្ហាប់' },
    video: { en: 'Video', km: 'វីដេអូ' },
    audio: { en: 'Audio', km: 'សំឡេង' },
    file: { en: 'File', km: 'ឯកសារ' },
  };
  return labels[kind][lang];
}
