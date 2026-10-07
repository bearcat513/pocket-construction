/**
 * The public website's storage: its words, its pictures, where each goes, and
 * the contact form's inbox.
 *
 * Like everything else here it holds no credential. Reading the page is done
 * anonymously because the collections are public by rule; writing is done
 * with the caller's token, and PocketBase refuses it unless that account has
 * `siteEditor` (docker/pb_migrations/1750000012_website.js). The contact form
 * creates its record anonymously too — the create rule is open, the read
 * rule is not, so a visitor can file a request and cannot read one back.
 */
import { ClientResponseError } from "pocketbase";
import {
  CONTACT_REQUEST_STATUSES,
  MAX_SITE_IMAGE_BYTES,
  SITE_IMAGE_TYPES,
  resolvePage,
  siteImageThumb,
  splitItems,
  type ContactRequest,
  type ContactRequestStatus,
  type SiteContent,
  type SiteImage,
  type SitePage,
  type SitePlacement,
  type SiteText,
  type SlotDefinition,
} from "../lib/site";
import type { ContactRequestInput, SiteImageMeta, SiteTextInput } from "../lib/validate";
import { newId, readMany, readOne, remove, write } from "./db";
import { ApiError } from "./http";
import { POCKETBASE_URL, clientFor, toApiError, toIso } from "./pocketbase";

type Row = Record<string, unknown>;

const stamps = (row: Row) => ({ createdAt: toIso(row.created), updatedAt: toIso(row.updated) });

/* -------------------------------- mapping -------------------------------- */

function toSiteText(row: Row): SiteText {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    items: splitItems(String(row.items ?? "")),
    ...stamps(row),
  };
}

/**
 * The URL is this server's, not PocketBase's: in Compose PocketBase is on a
 * network the browser cannot reach. The stored filename carries PocketBase's
 * random suffix, so a replaced picture gets a new URL and can be cached hard.
 */
export const siteImageUrl = (id: string, file: string) =>
  `/api/site/images/${encodeURIComponent(id)}/${encodeURIComponent(file)}`;

function toSiteImage(row: Row): SiteImage {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    alt: String(row.alt ?? ""),
    url: siteImageUrl(String(row.id), String(row.file ?? "")),
    ...stamps(row),
  };
}

const toPlacement = (row: Row): SitePlacement => ({
  id: String(row.id),
  slot: String(row.slot ?? ""),
  textId: String(row.text ?? ""),
  imageId: String(row.image ?? ""),
  position: Number(row.position ?? 0),
});

function toContactRequest(row: Row): ContactRequest {
  const status = String(row.status ?? "");
  return {
    id: String(row.id),
    firstName: String(row.firstName ?? ""),
    lastName: String(row.lastName ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    area: String(row.area ?? ""),
    description: String(row.description ?? ""),
    // Stored empty until someone acts on it.
    status: (CONTACT_REQUEST_STATUSES as readonly string[]).includes(status) ? (status as ContactRequestStatus) : "new",
    ...stamps(row),
  };
}

/* --------------------------------- reading -------------------------------- */

/**
 * Everything, placed or not. An empty token reads anonymously, which the
 * public rules allow — the page and the editor read the same three lists.
 */
export async function readSiteContent(token = ""): Promise<SiteContent> {
  const [texts, images, placements] = await Promise.all([
    readMany(token, "site_texts", { limit: 0, sort: "name" }),
    readMany(token, "site_images", { limit: 0, sort: "name" }),
    readMany(token, "site_config", { limit: 0, sort: "slot,position" }),
  ]);
  return {
    texts: texts.map(toSiteText),
    images: images.map(toSiteImage),
    placements: placements.map(toPlacement),
  };
}

export const readSitePage = async (): Promise<SitePage> => resolvePage(await readSiteContent());

/* ---------------------------------- texts --------------------------------- */

const textBody = (input: SiteTextInput): Row => ({
  name: input.name,
  title: input.title,
  body: input.body,
  items: input.items.join("\n"),
});

export async function createSiteText(token: string, input: SiteTextInput): Promise<SiteText> {
  const row = await write(token, "site_texts", null, { id: newId("stx"), ...textBody(input) }, "Could not save the text");
  return toSiteText(row!);
}

export async function updateSiteText(token: string, id: string, input: SiteTextInput): Promise<SiteText | null> {
  const row = await write(token, "site_texts", id, textBody(input), "Could not update the text");
  return row ? toSiteText(row) : null;
}

/** Its placements go with it — the relation cascades. */
export const deleteSiteText = (token: string, id: string) => remove(token, "site_texts", id);

/* --------------------------------- images --------------------------------- */

/**
 * Checked here as well as by PocketBase, so a wrong file is refused with a
 * sentence about the file rather than a field error about `file`.
 */
export function checkSiteImageFile(file: unknown): File {
  if (!(file instanceof File) || file.size === 0) throw new ApiError("Choose an image file to upload.");
  if (!(SITE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ApiError(`“${file.name}” is ${file.type || "not an image"}. Use JPEG, PNG, WebP, GIF or AVIF.`);
  }
  if (file.size > MAX_SITE_IMAGE_BYTES) {
    throw new ApiError(`“${file.name}” is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${MAX_SITE_IMAGE_BYTES / 1_048_576} MB.`);
  }
  return file;
}

function imageForm(meta: SiteImageMeta, file: File | null, id?: string): FormData {
  const form = new FormData();
  if (id) form.set("id", id);
  form.set("name", meta.name);
  form.set("alt", meta.alt);
  if (file) form.set("file", file);
  return form;
}

export async function createSiteImage(token: string, meta: SiteImageMeta, file: File): Promise<SiteImage> {
  // A picture uploaded without a name is called what its file was called.
  const name = meta.name || file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Image";
  try {
    const row = await clientFor(token)
      .collection("site_images")
      .create(imageForm({ ...meta, name }, file, newId("sim")));
    return toSiteImage(row);
  } catch (error) {
    throw toApiError(error, "Could not upload the image");
  }
}

/** New words, and optionally a new file in place of the old one. */
export async function updateSiteImage(
  token: string,
  id: string,
  meta: SiteImageMeta,
  file: File | null,
): Promise<SiteImage | null> {
  const existing = await readOne(token, "site_images", id);
  if (!existing) return null;
  try {
    const row = await clientFor(token)
      .collection("site_images")
      .update(id, imageForm({ name: meta.name || String(existing.name ?? ""), alt: meta.alt }, file));
    return toSiteImage(row);
  } catch (error) {
    if (error instanceof ClientResponseError && error.status === 404) return null;
    throw toApiError(error, "Could not update the image");
  }
}

export const deleteSiteImage = (token: string, id: string) => remove(token, "site_images", id);

/**
 * One picture's bytes, relayed from PocketBase.
 *
 * The id and filename are shape-checked before they reach the URL, so this
 * route cannot be walked into another collection's files. A thumbnail is
 * passed through only at the widths the field keeps.
 */
export async function siteImageResponse(id: string, file: string, width: number): Promise<Response> {
  if (!/^[a-z0-9_]+$/.test(id) || !/^[\w.-]+$/.test(file)) return new Response("Not found", { status: 404 });

  const thumb = siteImageThumb(width);
  const url = `${POCKETBASE_URL}/api/files/site_images/${id}/${file}${thumb ? `?thumb=${thumb}` : ""}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return new Response("The image store is unreachable.", { status: 502 });
  }
  if (!upstream.ok) return new Response("Not found", { status: upstream.status === 404 ? 404 : 502 });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
    // The filename changes whenever the picture does, so it never goes stale.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { headers });
}

/* --------------------------------- layout --------------------------------- */

/**
 * Replaces what one slot holds, in the order given.
 *
 * Rows are reused in place, then added or removed at the end, so a reorder is
 * a handful of updates and every intermediate state is a valid page. Whether
 * each id names a real text or image is PocketBase's to say: the relation
 * refuses one that does not exist.
 */
export async function setSlot(token: string, slot: SlotDefinition, ids: string[]): Promise<SitePlacement[]> {
  const existing = await readMany(token, "site_config", {
    limit: 0,
    sort: "position,id",
    filter: clientFor(token).filter("slot = {:slot}", { slot: slot.key }),
  });

  const body = (id: string, position: number): Row => ({
    slot: slot.key,
    text: slot.kind === "text" ? id : "",
    image: slot.kind === "image" ? id : "",
    position,
  });

  const saved: Row[] = [];
  for (const [position, id] of ids.entries()) {
    const current = existing[position];
    const row = current
      ? await write(token, "site_config", String(current.id), body(id, position), `Could not place ${id}`)
      : await write(token, "site_config", null, { id: newId("scf"), ...body(id, position) }, `Could not place ${id}`);
    if (!row) throw new ApiError("Only a website editor can change the layout.", 403);
    saved.push(row);
  }

  for (const leftover of existing.slice(ids.length)) await remove(token, "site_config", String(leftover.id));

  return saved.map(toPlacement);
}

/* -------------------------------- requests -------------------------------- */

/** The contact form. Anonymous, by design: the visitor has no account. */
export async function submitContactRequest(input: ContactRequestInput): Promise<void> {
  try {
    await clientFor()
      .collection("contact_requests")
      .create({ id: newId("enq"), ...input }, { fields: "id" });
  } catch (error) {
    throw toApiError(error, "Your message could not be sent");
  }
}

export const listContactRequests = async (token: string): Promise<ContactRequest[]> =>
  (await readMany(token, "contact_requests", { limit: 0, sort: "-created" })).map(toContactRequest);

export async function setContactRequestStatus(
  token: string,
  id: string,
  status: ContactRequestStatus,
): Promise<ContactRequest | null> {
  const row = await write(
    token,
    "contact_requests",
    id,
    { status: status === "new" ? "" : status },
    "Could not update the request",
  );
  return row ? toContactRequest(row) : null;
}

export const deleteContactRequest = (token: string, id: string) => remove(token, "contact_requests", id);

/**
 * A modest brake on the contact form: a few requests per sender per window,
 * held in memory. The honeypot stops the bots that fill every field; this
 * stops one that has learned not to from filling the inbox. Best effort by
 * nature — behind a proxy the sender is whatever the proxy says it is.
 */
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const CONTACT_LIMIT = 5;
const contactLog = new Map<string, number[]>();

export function contactAllowed(sender: string, now = Date.now()): boolean {
  const recent = (contactLog.get(sender) ?? []).filter(at => now - at < CONTACT_WINDOW_MS);
  if (recent.length >= CONTACT_LIMIT) {
    contactLog.set(sender, recent);
    return false;
  }
  recent.push(now);
  contactLog.set(sender, recent);

  // Forget senders who have gone quiet, so the map cannot grow without end.
  if (contactLog.size > 10_000) {
    for (const [key, times] of contactLog) if (times.every(at => now - at >= CONTACT_WINDOW_MS)) contactLog.delete(key);
  }
  return true;
}
