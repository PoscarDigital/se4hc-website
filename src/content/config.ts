import { defineCollection, z } from 'astro:content';

/**
 * Unified content model.
 *
 * Every collection shares the same base set of frontmatter fields so authoring
 * and rendering a Markdown entry is consistent no matter the collection:
 *
 *   lang*            "km" | "en"            (required)
 *   title*           string                 (required — the entry heading; FAQs use it as the question)
 *   excerpt          string                 short summary / teaser / answer-lead
 *   date             date                   publication / updated date (ISO: YYYY-MM-DD)
 *   category         string                 free-form tag (e.g. "Infrastructure", "general", "progress")
 *   status           enum                   lifecycle/badge state
 *   featured         boolean (false)        highlight on listings
 *   order            number (0)             manual sort weight (lower = first)
 *   featureImage     string                 path under /public for the hero image
 *   featureImageAlt  string                 alt text for the hero image
 *   attachments      Attachment[] ([])      downloadable / viewable files (any format)
 *
 * Collections add a few specific extras on top (see each below), but the base
 * is identical everywhere.
 */

const langField = z.enum(['km', 'en']);

/** Shared status values across content types (a superset; not every value is meaningful everywhere). */
const statusField = z
  .enum(['new', 'updated', 'archived', 'active', 'closing', 'awarded', 'upcoming', 'ongoing', 'completed'])
  .optional();

/**
 * A downloadable / viewable file attached to a content entry.
 * `file` is a path under /public (e.g. /documents/reports/foo.pdf).
 * `label` is an optional human-readable name; `featured` marks the primary
 * file (the one embedded/previewed first). Type & size are derived at render
 * time from the file extension and the file on disk.
 */
const attachmentSchema = z.object({
  file: z.string(),
  label: z.string().optional(),
  featured: z.boolean().default(false),
});

/** The identical base every collection schema is built from. */
const baseFields = {
  lang: langField,
  title: z.string(),
  excerpt: z.string().optional(),
  date: z.coerce.date().optional(),
  category: z.string().optional(),
  status: statusField,
  featured: z.boolean().default(false),
  order: z.number().default(0),
  featureImage: z.string().optional(),
  featureImageAlt: z.string().optional(),
  attachments: z.array(attachmentSchema).default([]),
};

// Each collection = the shared base spread inline (so Astro infers the full
// frontmatter type) + a few collection-specific extras.

const newsCollection = defineCollection({
  type: 'content',
  schema: z.object({ ...baseFields }),
});

const reportsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    /** Report kind, also drives the colored tag. */
    type: z.enum(['progress', 'financial', 'technical', 'review', 'baseline', 'engagement']).optional(),
    /** Page count of the primary document, if known. */
    pages: z.number().optional(),
  }),
});

const resourcesCollection = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    /** Resource kind label (e.g. "Training Material"). */
    type: z.string().optional(),
  }),
});

const eventsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    /** Display date label (e.g. "Q1 2026") — events are scheduled by quarter, not exact dates. */
    dateLabel: z.string().optional(),
    /** Where the event happens. */
    location: z.string().optional(),
  }),
});

const procurementCollection = defineCollection({
  type: 'content',
  schema: z.object({
    ...baseFields,
    type: z.enum(['works', 'goods', 'consulting', 'non-consulting', 'individual']).optional(),
    value: z.number().optional(),
    method: z.string().optional(),
    contracts: z.number().optional(),
  }),
});

// FAQs use only the base fields: `title` holds the question, `category` holds
// the grouping ("general" | "education" | "procurement" | "participation" |
// "technical"), `order` sorts within a group, and the Markdown body is the answer.
const faqsCollection = defineCollection({
  type: 'content',
  schema: z.object({ ...baseFields }),
});

export const collections = {
  news: newsCollection,
  reports: reportsCollection,
  resources: resourcesCollection,
  events: eventsCollection,
  procurement: procurementCollection,
  faqs: faqsCollection,
};
