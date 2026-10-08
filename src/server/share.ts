/**
 * The things this server cannot do on its own, relayed to PocketBase.
 *
 * Both need to turn an email address into an account, which means reading the
 * `users` collection — something no user token may do, and something this
 * server holds no credentials to do either. So the work happens inside
 * PocketBase (docker/pb_hooks/), and these functions are a proxy that carries
 * the caller's own token along, so PocketBase still decides whether they own
 * the record they are talking about.
 *
 *   sharing    — who else may read a quote, invoice, project, feed or template
 *   directory  — the accounts on this instance, for the pickers that name one
 */
import { ApiError } from "./http";
import { authHeaders, POCKETBASE_URL, toApiError } from "./pocketbase";

/** Collection names as PocketBase knows them, keyed by API path segment. */
const COLLECTIONS = {
  quotes: "quotes",
  invoices: "invoices",
  projects: "projects",
  "catalog-sources": "catalog_sources",
  "proposal-templates": "proposal_templates",
} as const;

export type Shareable = keyof typeof COLLECTIONS;

export const SHAREABLE_KINDS = Object.keys(COLLECTIONS) as Shareable[];

export const isShareable = (value: string): value is Shareable => value in COLLECTIONS;

/** What a share endpoint answers with. */
export type Shares = {
  /** The owner's email address — who shared it, when it is not yours. */
  owner: string;
  /** The people it is shared with. Only ever populated for the owner. */
  sharedWith: string[];
  /** Whether this caller may change the list. */
  canShare: boolean;
};

/**
 * One call to a hook route, with the caller's own credential. Telegram's
 * routes (src/server/telegram.ts) go through here too.
 */
export async function relay<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${POCKETBASE_URL}${path}`, {
      ...init,
      headers: { ...authHeaders(token), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw toApiError(error, "Could not reach PocketBase");
  }

  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;

  if (!response.ok) {
    // PocketBase's error shape is { message, status }; the API's is { error }.
    throw new ApiError(payload?.message || "The request failed.", response.status);
  }

  return payload as T;
}

const sharePath = (kind: Shareable, id: string, search = "") =>
  `/api/build/shares/${COLLECTIONS[kind]}/${encodeURIComponent(id)}${search}`;

export const listShares = (token: string, kind: Shareable, id: string) =>
  relay<Shares>(token, sharePath(kind, id));

export const addShare = (token: string, kind: Shareable, id: string, email: string) =>
  relay<Shares>(token, sharePath(kind, id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

export const removeShare = (token: string, kind: Shareable, id: string, email: string) =>
  relay<Shares>(token, sharePath(kind, id, `?email=${encodeURIComponent(email)}`), { method: "DELETE" });

/* ------------------------------- directory ------------------------------- */

export type DirectoryUser = { id: string; email: string; name: string };

/**
 * The accounts on this instance, for the pickers that name a person.
 *
 * Every signed-in account can read this — see docker/pb_hooks/lib/directory.js
 * for what that does and does not expose. A caller that cannot reach it treats
 * the answer as empty and falls back to typing an address, so an instance that
 * drops the hook keeps working.
 */
export const listDirectory = (token: string, search = "") =>
  relay<{ users: DirectoryUser[]; truncated: boolean }>(
    token,
    `/api/build/directory${search ? `?search=${encodeURIComponent(search)}` : ""}`,
  );

export function readEmail(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!email.includes("@")) throw new ApiError("A valid email address is required.");
  return email;
}
