/**
 * The public website: its slots, and how a page is assembled from the three
 * collections behind it.
 *
 * Content and layout are kept apart on purpose. A `SiteText` or a `SiteImage`
 * is a thing; a `SitePlacement` (a `site_config` row) says which thing goes in
 * which slot, at which position. Swapping the hero photo, or reordering the
 * services, is a change to placements and never to the content — and the same
 * photo can sit in two slots without being uploaded twice.
 *
 * The slots are a closed list because the page is code: a slot the page does
 * not draw is a placement nobody would ever see. `resolvePage` drops those,
 * and drops anything placed in a slot of the wrong kind, rather than letting
 * the page find out at render time.
 *
 * Pure: the server runs it for `GET /api/site`, and the editor runs it to
 * preview a layout before it is saved.
 */

export type SlotKind = "text" | "image";

export type SlotDefinition = {
  key: string;
  /** Which part of the page it is on, for grouping in the editor. */
  section: SiteSection;
  label: string;
  kind: SlotKind;
  /** Whether it takes a list (a gallery, the services) or one thing. */
  many: boolean;
  /** What the page does with a text's title, body and list in this slot. */
  hint: string;
};

export const SITE_SECTIONS = ["Brand", "Hero", "About", "Services", "Projects", "Contact"] as const;
export type SiteSection = (typeof SITE_SECTIONS)[number];

export const SITE_SLOTS = [
  { key: "brand.name", section: "Brand", label: "Business name", kind: "text", many: false, hint: "Title is the name; body is the tagline under it." },
  { key: "brand.logo", section: "Brand", label: "Logo mark", kind: "image", many: false, hint: "A small mark drawn above the name in the header." },
  { key: "hero.text", section: "Hero", label: "Headline", kind: "text", many: false, hint: "Title is the headline; body is the line under it." },
  { key: "hero.image", section: "Hero", label: "Background photo", kind: "image", many: false, hint: "Darkened behind the headline, so a busy photo still reads." },
  { key: "about.text", section: "About", label: "Introduction", kind: "text", many: false, hint: "Title is the heading; body is the opening paragraph." },
  { key: "about.timeline", section: "About", label: "Timeline", kind: "text", many: true, hint: "Each entry's title is its label (a year); body is what happened." },
  { key: "about.note", section: "About", label: "Callout", kind: "text", many: false, hint: "A shaded note under the timeline. **Bold** works." },
  { key: "about.image", section: "About", label: "Photo", kind: "image", many: false, hint: "Beside the introduction." },
  { key: "services.text", section: "Services", label: "Introduction", kind: "text", many: false, hint: "Title is the heading; body is the line under it." },
  { key: "services.list", section: "Services", label: "Services", kind: "text", many: true, hint: "Title, a description, and a list of examples (one per line)." },
  { key: "services.images", section: "Services", label: "Photos", kind: "image", many: true, hint: "Stacked beside the services on a wide screen." },
  { key: "projects.text", section: "Projects", label: "Introduction", kind: "text", many: false, hint: "Title is the heading; body is the line under it." },
  { key: "projects.gallery", section: "Projects", label: "Gallery", kind: "image", many: true, hint: "Each photo opens larger when selected." },
  { key: "contact.text", section: "Contact", label: "Introduction", kind: "text", many: false, hint: "Title is the heading; body is the line under it." },
  { key: "contact.phone", section: "Contact", label: "Phone", kind: "text", many: false, hint: "The body is the number, as it should be printed." },
  { key: "contact.email", section: "Contact", label: "Email", kind: "text", many: false, hint: "The body is the address." },
  { key: "contact.location", section: "Contact", label: "Location", kind: "text", many: false, hint: "The body is the town or area served." },
  { key: "contact.areas", section: "Contact", label: "Form: area choices", kind: "text", many: false, hint: "Title labels the field; the list is the choices. No list hides it." },
  { key: "contact.thanks", section: "Contact", label: "Form: thank-you", kind: "text", many: false, hint: "Shown once the form is sent." },
] as const satisfies readonly SlotDefinition[];

export type SlotKey = (typeof SITE_SLOTS)[number]["key"];

const SLOT_BY_KEY = new Map<string, SlotDefinition>(SITE_SLOTS.map(slot => [slot.key, slot]));

export const slotDefinition = (key: string): SlotDefinition | undefined => SLOT_BY_KEY.get(key);

/* --------------------------------- records -------------------------------- */

export type SiteText = {
  id: string;
  /** The editor's label for it. Never on the page. */
  name: string;
  title: string;
  body: string;
  items: string[];
  createdAt: string;
  updatedAt: string;
};

export type SiteImage = {
  id: string;
  name: string;
  alt: string;
  /** Where the page loads it from — this server, which proxies PocketBase. */
  url: string;
  createdAt: string;
  updatedAt: string;
};

/** One `site_config` row. */
export type SitePlacement = {
  id: string;
  slot: string;
  textId: string;
  imageId: string;
  position: number;
};

/** What `GET /api/site/content` hands the editor: everything, placed or not. */
export type SiteContent = {
  texts: SiteText[];
  images: SiteImage[];
  placements: SitePlacement[];
};

/** What the public page reads: each slot, filled, in order. */
export type SitePage = {
  texts: Partial<Record<SlotKey, SiteText[]>>;
  images: Partial<Record<SlotKey, SiteImage[]>>;
};

export type ContactRequestStatus = "new" | "replied" | "archived";
export const CONTACT_REQUEST_STATUSES: readonly ContactRequestStatus[] = ["new", "replied", "archived"];

export type ContactRequest = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  area: string;
  description: string;
  status: ContactRequestStatus;
  createdAt: string;
  updatedAt: string;
};

/* -------------------------------- assembly -------------------------------- */

/**
 * Fills every slot from the placements, in position order.
 *
 * A placement is dropped — never an error — when its slot is not one the page
 * has, when it names content of the other kind, or when the content is gone.
 * A single-valued slot keeps its first placement only, so a duplicate row
 * left by an interrupted save shows one hero photo rather than two.
 */
export function resolvePage(content: SiteContent): SitePage {
  const texts = new Map(content.texts.map(text => [text.id, text]));
  const images = new Map(content.images.map(image => [image.id, image]));
  const page: SitePage = { texts: {}, images: {} };

  const ordered = [...content.placements].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  for (const placement of ordered) {
    const slot = slotDefinition(placement.slot);
    if (!slot) continue;
    const key = slot.key as SlotKey;

    if (slot.kind === "text") {
      const text = texts.get(placement.textId);
      if (!text) continue;
      const list = (page.texts[key] ??= []);
      if (slot.many || list.length === 0) list.push(text);
    } else {
      const image = images.get(placement.imageId);
      if (!image) continue;
      const list = (page.images[key] ??= []);
      if (slot.many || list.length === 0) list.push(image);
    }
  }

  return page;
}

/** The first text in a slot, if any. */
export const pageText = (page: SitePage, key: SlotKey): SiteText | undefined => page.texts[key]?.[0];
export const pageTexts = (page: SitePage, key: SlotKey): SiteText[] => page.texts[key] ?? [];
export const pageImage = (page: SitePage, key: SlotKey): SiteImage | undefined => page.images[key]?.[0];
export const pageImages = (page: SitePage, key: SlotKey): SiteImage[] => page.images[key] ?? [];

/** `513-616-9757` → `tel:+15136169757`. A number with no digits gets no link. */
export function phoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  // A bare ten-digit number is a North American one; anything else is
  // assumed to carry its own country code.
  return `tel:+${digits.length === 10 ? `1${digits}` : digits}`;
}

/** A text's list, stored one entry per line. */
export const splitItems = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

/** Paragraphs are separated by a blank line. */
export const paragraphs = (body: string): string[] =>
  body
    .split(/\r?\n\s*\r?\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

/* --------------------------------- limits --------------------------------- */

/** Matches `mimeTypes` on `site_images.file`. No SVG: it can carry script. */
export const SITE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;

/** Matches `maxSize` on `site_images.file`. */
export const MAX_SITE_IMAGE_BYTES = 10 * 1024 * 1024;

/** How many things one slot may hold — a gallery, not an archive. */
export const MAX_SLOT_ENTRIES = 60;

/** Matches the `max` on `contact_requests.description`. */
export const MAX_CONTACT_MESSAGE = 5_000;

/**
 * The form's hidden field. A person never sees it, so never fills it; a bot
 * filling every input it finds does. A request with it set is answered as if
 * it were received, and dropped.
 */
export const CONTACT_HONEYPOT = "website";

/**
 * The widths PocketBase keeps a thumbnail at — `thumbs` on `site_images.file`.
 * The page offers them as a srcset, so a phone is not sent a 2000px hero.
 */
export const SITE_IMAGE_WIDTHS = [480, 960, 1920] as const;

/** `?thumb=960x0` for one of those widths; anything else is the original. */
export const siteImageThumb = (width: number): string =>
  (SITE_IMAGE_WIDTHS as readonly number[]).includes(width) ? `${width}x0` : "";

/** A srcset over the thumbnail widths, for an image served by this server. */
export const siteImageSrcSet = (url: string): string =>
  SITE_IMAGE_WIDTHS.map(width => `${url}?thumb=${siteImageThumb(width)} ${width}w`).join(", ");
