import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import manifest from '../data/media-manifest.json';
import type { Lang } from './i18n';

export type AttachmentKind = 'pdf' | 'image' | 'word' | 'excel' | 'powerpoint' | 'archive' | 'video' | 'audio' | 'file';

export interface ResolvedAttachment {
  /** The reference as authored: a path under /public, or an absolute URL. */
  file: string;
  /** URL to link/embed. Absolute for remote files; base-prefixed for repo files. */
  href: string;
  /** Display label (falls back to the file name). */
  label: string;
  /** Uppercase extension, e.g. "PDF". */
  ext: string;
  kind: AttachmentKind;
  /** Whether the file can be embedded/previewed inline in the browser. */
  viewable: boolean;
  /** Human-readable size (e.g. "2.3 MB"), or null if unknown. */
  size: string | null;
  /** True when the bytes live in object storage rather than the repo. */
  remote: boolean;
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

const REMOTE = /^https?:\/\//i;

/**
 * Size/type metadata for files stored outside the repo.
 *
 * A remote object cannot be stat'd at build time — the object store is not
 * necessarily reachable from CI — so the media service records each upload's
 * metadata here and commits it alongside the content. See services/media.
 */
interface ManifestEntry {
  size?: number;
  mime?: string;
  uploadedAt?: string;
}
const MANIFEST = (manifest as { files?: Record<string, ManifestEntry> }).files ?? {};

function extOf(file: string): string {
  const m = file.toLowerCase().split('?')[0].match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function fileNameOf(file: string): string {
  return decodeURIComponent(file.split('?')[0].split('/').pop() ?? file);
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
function sizeOnDisk(file: string): number | null {
  try {
    const clean = file.replace(/^\//, '').split('?')[0];
    const url = new URL(`../../public/${clean}`, import.meta.url);
    return statSync(fileURLToPath(url)).size;
  } catch {
    return null;
  }
}

/**
 * Resolve a byte count for an attachment, in order of reliability:
 * the size recorded in frontmatter, then the media manifest, then the file
 * on disk. Remote files are never stat'd. Unknown size is not an error.
 */
function resolveSize(file: string, declared: number | undefined, remote: boolean): string | null {
  const bytes = declared ?? MANIFEST[file]?.size ?? (remote ? null : sizeOnDisk(file));
  return typeof bytes === 'number' ? formatBytes(bytes) : null;
}

export interface RawAttachment {
  /** Path under /public (e.g. /documents/reports/foo.pdf) or an absolute URL. */
  file: string;
  label?: string;
  featured?: boolean;
  /** Size in bytes, recorded at upload time for files not in the repo. */
  size?: number;
}

/** Resolve a raw frontmatter attachment into render-ready metadata. */
export function resolveAttachment(raw: RawAttachment, base: string): ResolvedAttachment {
  const remote = REMOTE.test(raw.file);
  const ext = extOf(raw.file);
  const kind = EXT_KIND[ext] ?? 'file';
  const cleanBase = base.replace(/\/$/, '');
  const path = raw.file.startsWith('/') ? raw.file : `/${raw.file}`;
  return {
    file: raw.file,
    href: remote ? raw.file : `${cleanBase}${path}`,
    label: raw.label ?? fileNameOf(raw.file),
    ext: ext.toUpperCase(),
    kind,
    viewable: VIEWABLE.includes(kind),
    size: resolveSize(raw.file, raw.size, remote),
    remote,
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
