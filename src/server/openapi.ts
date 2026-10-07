/**
 * The API, written out as an OpenAPI document.
 *
 * Postman, Bruno, Insomnia and the code generators all read this, so it is
 * served whole from `GET /api/openapi.json` and the file a browser saves is
 * the same bytes those tools fetch.
 *
 * It is also the only list of endpoints: `GET /api` prints its index rather
 * than keeping a second copy, and `/docs` renders the same document, so a
 * route renamed here cannot go on being advertised under its old name in
 * either of the other two.
 *
 * Version 3.0.3 rather than 3.1: every tool that matters reads 3.0 today, and
 * nothing described here needs what 3.1 added.
 *
 * Where a bound is enforced elsewhere — a template body, a contact list, the
 * approver cap — it is imported rather than retyped, so the document cannot
 * promise a limit the server does not keep.
 */
import { MAX_PDF_TEMPLATE_BODY_LENGTH, MAX_TEMPLATE_BODY_LENGTH, MAX_TEMPLATE_NAME_LENGTH } from "../lib/document";
import { FUNCTION_NAMES } from "../lib/formula";
import { DEFAULT_PREFERENCES, PREFERENCE_LIMITS, ACCENTS, FONTS, THEMES } from "../lib/preferences";
import { SYNC_ACTIONS } from "../lib/catalogSync";
import { CATALOG_CSV_COLUMNS } from "../lib/catalogCsv";
import { CATALOG_TEMPLATES } from "../lib/catalogTemplates";
import { AGING_BUCKETS } from "../lib/receivable";
import { QUOTE_PAGE_MAX, QUOTE_SORTS } from "../lib/quoteSearch";
import {
  ACCOUNT_STATUSES,
  APPROVAL_METRICS,
  CONTRACT_TYPES,
  COST_TYPES,
  CSI_DIVISIONS,
  MATCH_KEYS,
  BILLING_PERIODS,
  CHARGE_TYPES,
  COMPARATORS,
  CONTACT_ROLES,
  CREDIT_REASONS,
  CURRENCIES,
  INVOICE_STATES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PRICING_RULE_TARGETS,
  PRODUCT_RULE_KINDS,
  PROJECT_STATUSES,
  PROPOSAL_FORMATS,
  QUOTE_STATUSES,
  SOURCE_FORMATS,
  SYNC_FIELDS,
  TEMPLATE_KINDS,
  TIER_KINDS,
  UNITS_OF_MEASURE,
} from "../lib/types";
import { MAX_APPROVERS, MAX_CONTACTS, MAX_INVOICE_LINES, MAX_LEDGER_ENTRIES, MAX_TAGS } from "../lib/validate";
import { MAX_EXPIRY_DAYS, MAX_KEY_NAME_LENGTH, MAX_KEYS } from "./apiKeys";
import { API_KEY_HEADER, API_KEY_PREFIX, SESSION_COOKIE } from "./session";
import { MAX_MIN_ROWS } from "../lib/telegram";
import {
  CONTACT_HONEYPOT,
  CONTACT_REQUEST_STATUSES,
  MAX_CONTACT_MESSAGE,
  MAX_SITE_IMAGE_BYTES,
  MAX_SLOT_ENTRIES,
  SITE_IMAGE_TYPES,
  SITE_IMAGE_WIDTHS,
  SITE_SLOTS,
} from "../lib/site";

type Json = Record<string, unknown>;

export type OpenApiDocument = {
  openapi: string;
  info: Json;
  servers: Json[];
  tags: Json[];
  security: Json[];
  paths: Record<string, Json>;
  components: Json;
};

/** Matches package.json; the document's own version, not the spec's. */
const API_VERSION = "0.0.1";

/** What a browser saves it as, and what the tools show in their import list. */
export const OPENAPI_FILE_NAME = "sitelines.openapi.json";

/** Where the document lives, for the UI's download link and the index below. */
export const OPENAPI_PATH = "/api/openapi.json";

/** Used when nothing better is known — a spec has to name some server. */
const FALLBACK_SERVER_URL = "http://localhost:3000";

/* ------------------------------- small pieces ------------------------------ */

const ref = (schema: string) => ({ $ref: `#/components/schemas/${schema}` });
const responseRef = (response: string) => ({ $ref: `#/components/responses/${response}` });
const array = (schema: Json) => ({ type: "array", items: schema });

const jsonResponse = (description: string, schema: Json) => ({
  description,
  content: { "application/json": { schema } },
});

const jsonBody = (description: string, schema: Json) => ({
  required: true,
  description,
  content: { "application/json": { schema } },
});

/** A file download: the tools show it as text rather than trying to parse it. */
const fileResponse = (description: string, mediaType: string) => ({
  description,
  headers: {
    "Content-Disposition": {
      description: "`attachment`, with the filename the download is saved as.",
      schema: { type: "string" },
    },
  },
  content: { [mediaType]: { schema: { type: "string" } } },
});

const idParam = (what: string, name = "id") => ({
  name,
  in: "path",
  required: true,
  description: `The ${what}'s id.`,
  schema: { type: "string" },
});

const queryParam = (name: string, description: string, schema: Json) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

const formatParam = (what: string) =>
  queryParam("format", `Download ${what} as a spreadsheet or a file instead of the JSON body.`, {
    type: "string",
    enum: ["csv", "json"],
  });

/** The two ways `?format=` can answer: JSON in the body, or a file. */
const exportResponse = (description: string, schema: Json) => ({
  description,
  content: {
    "application/json": { schema },
    "text/csv": { schema: { type: "string" } },
  },
});

/** A rendered document: JSON with `&inline`, the file itself without it. */
const documentResponse = (what: string) => ({
  description:
    `The rendered ${what}. A file download by default — \`&inline\` answers with ` +
    "`RenderedDocument` instead, which is what the preview dialog reads. A `pdf` template " +
    "always answers with the PDF itself.",
  content: {
    "application/json": { schema: ref("RenderedDocument") },
    "text/html": { schema: { type: "string" } },
    "text/markdown": { schema: { type: "string" } },
    "text/plain": { schema: { type: "string" } },
    "application/pdf": { schema: { type: "string", format: "binary" } },
  },
});

/* -------------------------------- operations ------------------------------- */

type Operation = {
  method: "get" | "post" | "put" | "delete";
  /** OpenAPI-style, with `{id}` where the route table writes `:id`. */
  path: string;
  tag: string;
  operationId: string;
  /** One line. This is also what `GET /api` prints beside the route. */
  summary: string;
  description?: string;
  /** True where no credential is needed at all. */
  anonymous?: boolean;
  parameters?: Json[];
  requestBody?: Json;
  /** Merged over the defaults for this operation's kind. */
  responses: Record<string, Json>;
};

/** The two auth responses that also hand back a cookie. */
function sessionResponse(description: string) {
  return {
    description,
    headers: {
      "Set-Cookie": {
        description: `The session, as an httpOnly \`${SESSION_COOKIE}\` cookie.`,
        schema: { type: "string" },
      },
    },
    content: { "application/json": { schema: ref("SessionEnvelope") } },
  };
}

/**
 * The seven record types that can be shared, each with the same three routes.
 *
 * Written once for the same reason `shareRoutes` in the route table is: two
 * record types that share one shape must not be able to drift apart, and
 * twenty-one hand-written operations are twenty-one chances for them to.
 */
function shareOperations(kind: string, what: string, noun: string): Operation[] {
  const path = `/api/${kind}/{id}/shares`;
  const suffix = noun[0]!.toUpperCase() + noun.slice(1);

  return [
    {
      method: "get",
      path,
      tag: "Sharing",
      operationId: `list${suffix}Shares`,
      summary: `Who ${what} is shared with`,
      parameters: [idParam(noun)],
      responses: { "200": jsonResponse("The owner and everyone it is shared with.", ref("Shares")) },
    },
    {
      method: "post",
      path,
      tag: "Sharing",
      operationId: `add${suffix}Share`,
      summary: `{ email } → share ${what} read-only (owner only)`,
      description:
        "The address has to belong to an account on this instance. Sharing is read-only: the " +
        "recipient can list, read and export it, and quote from it, but not rename, edit, delete " +
        "or re-share it.",
      parameters: [idParam(noun)],
      requestBody: jsonBody("Who to share it with.", ref("ShareInput")),
      responses: {
        "200": jsonResponse("The share list, as it now stands.", ref("Shares")),
        "404": responseRef("NotFound"),
      },
    },
    {
      method: "delete",
      path,
      tag: "Sharing",
      operationId: `remove${suffix}Share`,
      summary: `?email= → stop sharing ${what}`,
      description: "The owner may remove anyone; anyone else may remove only themselves.",
      parameters: [
        idParam(noun),
        {
          name: "email",
          in: "query",
          required: true,
          description: "The account to stop sharing with.",
          schema: { type: "string", format: "email" },
        },
      ],
      responses: {
        "200": jsonResponse("The share list, as it now stands.", ref("Shares")),
        "404": responseRef("NotFound"),
      },
    },
  ];
}

/**
 * Every endpoint, in the order `GET /api` lists them.
 *
 * The summaries are that index: they are written to read as a line in it,
 * which is also what a tool's sidebar shows beside the request.
 */
export const OPERATIONS: Operation[] = [
  /* ------------------------------ discovery ----------------------------- */
  {
    method: "get",
    path: "/api",
    tag: "Discovery",
    operationId: "getApiIndex",
    summary: "This index, the auth options, and the rules this app prices by",
    description:
      "The endpoint list here is generated from the same operations as this document, so the two " +
      "cannot disagree. Beside it are the pricing pipeline, the approval ladder, the receivables " +
      "conventions and the document vocabularies — the things worth reading before the first call.",
    anonymous: true,
    responses: { "200": jsonResponse("The index.", { type: "object", additionalProperties: true }) },
  },
  {
    method: "get",
    path: "/api/health",
    tag: "Discovery",
    operationId: "getHealth",
    summary: "Liveness check for this server",
    description:
      "This server being up and PocketBase being up are separate facts; the second is `GET /api/meta`.",
    anonymous: true,
    responses: { "200": jsonResponse("The server is up.", ref("Health")) },
  },
  {
    method: "get",
    path: OPENAPI_PATH,
    tag: "Discovery",
    operationId: "getOpenApiDocument",
    summary: "This API as an OpenAPI 3.0 document, for Postman, Bruno and friends",
    description:
      "Import it by URL to keep it current, or save the file. The `servers` entry names the host " +
      "it was fetched from, so an imported collection points back at this server.",
    anonymous: true,
    responses: { "200": jsonResponse("The document.", { type: "object", additionalProperties: true }) },
  },
  {
    method: "get",
    path: "/api/meta",
    tag: "Discovery",
    operationId: "getMeta",
    summary: "PocketBase URL, reachability and this account's record counts",
    responses: { "200": jsonResponse("Where the data lives, and how much of it there is.", ref("Meta")) },
  },
  {
    method: "get",
    path: "/api/reference",
    tag: "Discovery",
    operationId: "getReference",
    summary: "Every enum, pricing variable and document token this app knows",
    description:
      "What the UI builds its pickers from. Reading it is how a script learns the currencies, " +
      "statuses, metrics, formula variables and `{{token}}` names without hard-coding a list that " +
      "would go stale.",
    responses: { "200": jsonResponse("The vocabularies.", { type: "object", additionalProperties: true }) },
  },
  {
    method: "get",
    path: "/api/directory",
    tag: "Discovery",
    operationId: "getDirectory",
    summary: "The accounts on this instance (?search=) — id, email and name only",
    description:
      "What the approver and share pickers offer. PocketBase answers it, since reading the user " +
      "list needs authority no user token carries.",
    parameters: [queryParam("search", "Narrow the list by name or email.", { type: "string" })],
    responses: { "200": jsonResponse("The directory.", ref("Directory")) },
  },

  /* -------------------------------- auth -------------------------------- */
  {
    method: "post",
    path: "/api/auth/register",
    tag: "Auth",
    operationId: "register",
    summary: "{ email, password, name? } → create an account and sign in",
    description: "Sign-up is open. The session cookie comes back on the same response.",
    anonymous: true,
    requestBody: jsonBody("The account to create.", ref("RegisterInput")),
    responses: { "201": sessionResponse("The account, now signed in.") },
  },
  {
    method: "post",
    path: "/api/auth/login",
    tag: "Auth",
    operationId: "login",
    summary: "{ email, password } → start a session",
    anonymous: true,
    requestBody: jsonBody("The credentials.", ref("LoginInput")),
    responses: {
      "200": sessionResponse("The signed-in account."),
      "401": jsonResponse("That email and password do not match an account.", ref("Error")),
    },
  },
  {
    method: "post",
    path: "/api/auth/logout",
    tag: "Auth",
    operationId: "logout",
    summary: "End the session",
    description: "Clears the cookie. An API key is unaffected — revoke one with `DELETE /api/keys/{id}`.",
    anonymous: true,
    responses: { "200": jsonResponse("The cookie has been cleared.", ref("Ok")) },
  },
  {
    method: "get",
    path: "/api/auth/me",
    tag: "Auth",
    operationId: "getMe",
    summary: "The signed-in account, with its preferences",
    responses: { "200": jsonResponse("Who this credential belongs to.", ref("SessionEnvelope")) },
  },
  {
    method: "post",
    path: "/api/auth/password",
    tag: "Auth",
    operationId: "changePassword",
    summary: "{ currentPassword, newPassword } → change the password",
    description:
      "PocketBase invalidates every existing token on a password change, so a fresh session comes " +
      "back on the response and anything else signed in as you is signed out. API keys survive it.",
    requestBody: jsonBody("The old password and the new one.", ref("PasswordInput")),
    responses: { "200": sessionResponse("The account, on a renewed session.") },
  },

  /* ------------------------------ api keys ------------------------------ */
  {
    method: "get",
    path: "/api/keys",
    tag: "API keys",
    operationId: "listApiKeys",
    summary: "The API keys on this account",
    description: "Needs a session, not a key. The secret itself is never returned — only its hash is stored.",
    responses: {
      "200": jsonResponse("Your keys, newest first.", array(ref("ApiKey"))),
      "403": jsonResponse("An API key cannot manage API keys.", ref("Error")),
    },
  },
  {
    method: "post",
    path: "/api/keys",
    tag: "API keys",
    operationId: "createApiKey",
    summary: "{ name?, expiresInDays? } → issue a key, returned once",
    description:
      `The response is the only time the key exists: only its SHA-256 is stored, so it cannot be ` +
      `shown again. Send it as \`${API_KEY_HEADER}\` on any endpoint under \`/api\`.\n\n` +
      "Issuing needs a real session. A leaked key must not be able to mint its replacement, " +
      "because revocation is how you recover from the leak.",
    requestBody: jsonBody("What the key is for, and how long it should last.", ref("ApiKeyInput")),
    responses: {
      "201": jsonResponse("The key, this once.", ref("IssuedApiKey")),
      "403": jsonResponse("An API key cannot issue API keys.", ref("Error")),
    },
  },
  {
    method: "delete",
    path: "/api/keys/{id}",
    tag: "API keys",
    operationId: "deleteApiKey",
    summary: "Revoke a key — it stops working on its next request",
    parameters: [idParam("key")],
    responses: {
      "200": jsonResponse("Revoked.", ref("Ok")),
      "403": jsonResponse("An API key cannot revoke API keys.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },

  /* ------------------------------ telegram ------------------------------ */
  {
    method: "get",
    path: "/api/telegram",
    tag: "Telegram",
    operationId: "getTelegram",
    summary: "Where this account's notifications go, and which bot sends them",
    description: "The bot token is never in it — it is held by PocketBase in a field no user token can read.",
    responses: { "200": jsonResponse("The settings and the link.", ref("TelegramStatus")) },
  },
  {
    method: "put",
    path: "/api/telegram",
    tag: "Telegram",
    operationId: "saveTelegramSettings",
    summary: "Choose what counts as news",
    description: "`chatId` and `chatLabel` are ignored: a chat is linked by pairing, never by a body.",
    requestBody: jsonBody("The settings.", ref("TelegramSettings")),
    responses: { "200": jsonResponse("As saved.", ref("TelegramStatus")) },
  },
  {
    method: "put",
    path: "/api/telegram/bot",
    tag: "Telegram",
    operationId: "setTelegramBot",
    summary: "{ token } → use your own bot; an empty token goes back to the server's",
    description:
      "Checked with Telegram before it is kept. Changing bots unlinks the chat, since a chat has to " +
      "start a bot before that bot may post to it. Needs a session: an API key cannot set a credential.",
    requestBody: jsonBody("The token from BotFather, or an empty string.", ref("TelegramBotInput")),
    responses: {
      "200": jsonResponse("The status, with the new bot.", ref("TelegramStatus")),
      "403": jsonResponse("Called with an API key.", ref("Error")),
    },
  },
  {
    method: "post",
    path: "/api/telegram/pair",
    tag: "Telegram",
    operationId: "startTelegramPairing",
    summary: "Mint a short code to send to the bot",
    description: "Nobody knows their own chat id; they know how to send a message. The code lapses after ten minutes.",
    responses: { "200": jsonResponse("The status, with `pairing` set.", ref("TelegramStatus")) },
  },
  {
    method: "post",
    path: "/api/telegram/pair/check",
    tag: "Telegram",
    operationId: "checkTelegramPairing",
    summary: "Whether the code has reached the bot — and if so, link that chat",
    responses: { "200": jsonResponse("Whether it paired, and the status either way.", ref("TelegramPairCheck")) },
  },
  {
    method: "delete",
    path: "/api/telegram/chat",
    tag: "Telegram",
    operationId: "unlinkTelegram",
    summary: "Stop sending to the linked chat",
    responses: { "200": jsonResponse("The status, unlinked.", ref("TelegramStatus")) },
  },
  {
    method: "post",
    path: "/api/telegram/test",
    tag: "Telegram",
    operationId: "sendTelegramTest",
    summary: "Send a test message to the linked chat",
    responses: { "200": jsonResponse("Delivered.", ref("TelegramStatus")) },
  },

  /* ---------------------------- preferences ----------------------------- */
  {
    method: "get",
    path: "/api/preferences",
    tag: "Preferences",
    operationId: "getPreferences",
    summary: "This account's preferences",
    description: "They live on the account rather than in the browser, so they follow you to another machine.",
    responses: { "200": jsonResponse("The preference set.", ref("Preferences")) },
  },
  {
    method: "put",
    path: "/api/preferences",
    tag: "Preferences",
    operationId: "savePreferences",
    summary: "Replace this account's preferences",
    description:
      "A replace rather than a merge: the body is a whole preference set, and anything missing " +
      "from it falls back to that preference's default. Values out of range are clamped, not refused.",
    requestBody: jsonBody("The whole preference set.", ref("Preferences")),
    responses: { "200": jsonResponse("The preferences as stored, normalized.", ref("Preferences")) },
  },

  /* ------------------------------ customers ----------------------------- */
  {
    method: "get",
    path: "/api/accounts",
    tag: "Customers",
    operationId: "listAccounts",
    summary: "List customers",
    responses: { "200": jsonResponse("Your customers.", array(ref("Account"))) },
  },
  {
    method: "post",
    path: "/api/accounts",
    tag: "Customers",
    operationId: "createAccount",
    summary: "Create a customer",
    description:
      "A body written before contacts existed — `contactName`/`contactEmail`/`contactPhone` — is " +
      "repaired into a one-contact account rather than refused, and a list with no primary or " +
      "several gets exactly one.",
    requestBody: jsonBody("The customer.", ref("AccountInput")),
    responses: { "201": jsonResponse("The customer, as stored.", ref("Account")) },
  },
  {
    method: "get",
    path: "/api/accounts/{id}",
    tag: "Customers",
    operationId: "getAccount",
    summary: "Read one customer",
    parameters: [idParam("customer")],
    responses: { "200": jsonResponse("The customer.", ref("Account")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/accounts/{id}",
    tag: "Customers",
    operationId: "updateAccount",
    summary: "Replace one customer",
    parameters: [idParam("customer")],
    requestBody: jsonBody("The customer, whole.", ref("AccountInput")),
    responses: { "200": jsonResponse("The customer, as stored.", ref("Account")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/accounts/{id}",
    tag: "Customers",
    operationId: "deleteAccount",
    summary: "Delete one customer",
    description: "Quotes already written for them keep their own snapshot of who they were.",
    parameters: [idParam("customer")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/accounts/{id}/quotes",
    tag: "Customers",
    operationId: "listAccountQuotes",
    summary: "Every quote written for one customer, newest first",
    description: "Its own endpoint because `GET /api/quotes` is capped at a page.",
    parameters: [idParam("customer")],
    responses: { "200": jsonResponse("That customer's quotes.", array(ref("QuoteSummary"))) },
  },
  {
    method: "get",
    path: "/api/accounts/{id}/invoices",
    tag: "Customers",
    operationId: "listAccountInvoices",
    summary: "One customer's invoices",
    parameters: [idParam("customer")],
    responses: { "200": jsonResponse("That customer's invoices, with their ledgers.", array(ref("InvoiceSummary"))) },
  },

  /* ------------------------------ projects ------------------------------ */
  {
    method: "get",
    path: "/api/projects",
    tag: "Projects",
    operationId: "listProjects",
    summary: "List projects you own or that are shared with you",
    responses: { "200": jsonResponse("Your jobs.", array(ref("Project"))) },
  },
  {
    method: "post",
    path: "/api/projects",
    tag: "Projects",
    operationId: "createProject",
    summary: "Create a project",
    description:
      'Leave `number` empty and one is minted — "PRJ-2026-0007" — sequential per account. ' +
      "`contractValue` is the one stored number: an awarded contract sum is negotiated, not derived.",
    requestBody: jsonBody("The project.", ref("ProjectInput")),
    responses: { "201": jsonResponse("The project, as stored.", ref("Project")) },
  },
  {
    method: "get",
    path: "/api/projects/{id}",
    tag: "Projects",
    operationId: "getProject",
    summary: "Read one project",
    parameters: [idParam("project")],
    responses: { "200": jsonResponse("The project.", ref("Project")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/projects/{id}",
    tag: "Projects",
    operationId: "updateProject",
    summary: "Replace one project",
    description:
      "The number is kept whatever the body says: once minted it is on drawings, permits and other " +
      "people's purchase orders.",
    parameters: [idParam("project")],
    requestBody: jsonBody("The project, whole.", ref("ProjectInput")),
    responses: { "200": jsonResponse("The project, as stored.", ref("Project")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/projects/{id}",
    tag: "Projects",
    operationId: "deleteProject",
    summary: "Delete one project",
    description: "Its estimates and invoices are kept; they simply stop naming a job.",
    parameters: [idParam("project")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/projects/{id}/summary",
    tag: "Projects",
    operationId: "getProjectSummary",
    summary: "One job's estimates, invoices and the roll-up of both",
    description:
      "One call rather than three because the three are always read together. `stats` is " +
      "computed on every read by the same pure function the browser runs — nothing in it is " +
      "stored — and it never adds two currencies: a document in another one is counted in " +
      "`otherCurrencyCount` and left out of every sum.",
    parameters: [idParam("project")],
    responses: { "200": jsonResponse("The job's whole position.", ref("ProjectSummary")), "404": responseRef("NotFound") },
  },

  /* ------------------------------ catalogue ----------------------------- */
  {
    method: "get",
    path: "/api/products",
    tag: "Catalogue",
    operationId: "listProducts",
    summary: "List products you own or that are shared with you",
    responses: { "200": jsonResponse("The catalogue.", array(ref("Product"))) },
  },
  {
    method: "post",
    path: "/api/products",
    tag: "Catalogue",
    operationId: "createProduct",
    summary: "Create a product",
    requestBody: jsonBody("The product.", ref("ProductInput")),
    responses: { "201": jsonResponse("The product, as stored.", ref("Product")) },
  },
  {
    method: "get",
    path: "/api/products/export",
    tag: "Catalogue",
    operationId: "exportProducts",
    summary: "Download the catalogue as CSV (?format=csv) or *.cpq.json",
    parameters: [formatParam("the catalogue")],
    responses: { "200": exportResponse("The catalogue.", array(ref("Product"))) },
  },
  {
    method: "get",
    path: "/api/products/{id}",
    tag: "Catalogue",
    operationId: "getProduct",
    summary: "Read one product",
    parameters: [idParam("product")],
    responses: { "200": jsonResponse("The product.", ref("Product")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/products/{id}",
    tag: "Catalogue",
    operationId: "updateProduct",
    summary: "Replace one product (owner only)",
    parameters: [idParam("product")],
    requestBody: jsonBody("The product, whole.", ref("ProductInput")),
    responses: { "200": jsonResponse("The product, as stored.", ref("Product")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/products/{id}",
    tag: "Catalogue",
    operationId: "deleteProduct",
    summary: "Delete one product (owner only)",
    parameters: [idParam("product")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/products/{id}/configure",
    tag: "Catalogue",
    operationId: "configureProduct",
    summary: "{ selectedOptions, quantity, termMonths } → validate a configuration",
    description:
      "Runs the product's option groups and configuration rules without pricing or storing " +
      "anything: what the selection resolves to, which groups and options it is actually offered, " +
      "what it costs per unit as a factor and a delta, and every rule it breaks or trips a " +
      "recommendation on.",
    parameters: [idParam("product")],
    requestBody: jsonBody("The selection to check.", ref("ConfigureInput")),
    responses: { "200": jsonResponse("The verdict.", ref("ConfigureResult")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/price-books",
    tag: "Catalogue",
    operationId: "listPriceBooks",
    summary: "List price books",
    responses: { "200": jsonResponse("The price books.", array(ref("PriceBook"))) },
  },
  {
    method: "post",
    path: "/api/price-books",
    tag: "Catalogue",
    operationId: "createPriceBook",
    summary: "Create a price book",
    requestBody: jsonBody("The price book.", ref("PriceBookInput")),
    responses: { "201": jsonResponse("The price book, as stored.", ref("PriceBook")) },
  },
  {
    method: "get",
    path: "/api/price-books/{id}",
    tag: "Catalogue",
    operationId: "getPriceBook",
    summary: "Read one price book",
    parameters: [idParam("price book")],
    responses: { "200": jsonResponse("The price book.", ref("PriceBook")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/price-books/{id}",
    tag: "Catalogue",
    operationId: "updatePriceBook",
    summary: "Replace one price book (owner only)",
    parameters: [idParam("price book")],
    requestBody: jsonBody("The price book, whole.", ref("PriceBookInput")),
    responses: { "200": jsonResponse("The price book, as stored.", ref("PriceBook")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/price-books/{id}",
    tag: "Catalogue",
    operationId: "deletePriceBook",
    summary: "Delete one price book (owner only)",
    parameters: [idParam("price book")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/catalog/export",
    tag: "Catalogue",
    operationId: "exportCatalog",
    summary: "Download products, price books and rules as *.catalog.json",
    responses: { "200": fileResponse("The catalogue file.", "application/json") },
  },
  {
    method: "post",
    path: "/api/catalog/import",
    tag: "Catalogue",
    operationId: "importCatalog",
    summary: "Create everything in a *.catalog.json body, or a spreadsheet sent as text/csv",
    description:
      "Additive: anything already here under the same SKU or name is left exactly as it is, and " +
      "the report says what was created and what was skipped. A `text/csv` body is one item per row, " +
      "in the columns of `GET /api/catalog/templates/catalog-template.csv`; a cell that cannot be read " +
      "(a price that is not a number, a unit not on the list) refuses the whole file and names the row. " +
      `Columns: ${CATALOG_CSV_COLUMNS.map(spec => (spec.required ? `\`${spec.column}\` (required)` : `\`${spec.column}\``)).join(", ")}.`,
    requestBody: {
      required: true,
      description: "A catalogue file, as `GET /api/catalog/export` produced it, or a catalogue spreadsheet.",
      content: {
        "application/json": { schema: { type: "object", additionalProperties: true } },
        "text/csv": { schema: { type: "string" } },
      },
    },
    responses: { "200": jsonResponse("What came in.", ref("CatalogImportReport")) },
  },
  {
    method: "get",
    path: "/api/catalog/templates",
    tag: "Catalogue",
    operationId: "listCatalogTemplates",
    summary: "List the files a catalogue can be started from",
    anonymous: true,
    responses: { "200": jsonResponse("Each template, with where to download it.", array(ref("CatalogTemplate"))) },
  },
  {
    method: "get",
    path: "/api/catalog/templates/{file}",
    tag: "Catalogue",
    operationId: "getCatalogTemplate",
    summary: "Download one catalogue template",
    description: `One of ${CATALOG_TEMPLATES.map(template => `\`${template.file}\``).join(", ")}.`,
    anonymous: true,
    parameters: [
      {
        name: "file",
        in: "path",
        required: true,
        description: "The template's file name, as the list gives it.",
        schema: { type: "string", enum: CATALOG_TEMPLATES.map(template => template.file) },
      },
    ],
    responses: {
      "200": {
        ...fileResponse("The template.", "text/csv"),
        content: { "text/csv": { schema: { type: "string" } }, "application/json": { schema: { type: "object" } } },
      },
      "404": responseRef("NotFound"),
    },
  },

  /* ---------------------------- supplier feeds -------------------------- */
  {
    method: "get",
    path: "/api/catalog-sources",
    tag: "Supplier feeds",
    operationId: "listCatalogSources",
    summary: "List supplier feeds",
    responses: { "200": jsonResponse("Your feeds, each with its last run.", array(ref("CatalogSource"))) },
  },
  {
    method: "post",
    path: "/api/catalog-sources",
    tag: "Supplier feeds",
    operationId: "createCatalogSource",
    summary: "Create a supplier feed",
    description:
      "A feed needs a key column — the code its rows are matched on — or nothing can be matched. " +
      "An empty `url` is a feed run by upload, which is how most emailed price lists arrive.",
    requestBody: jsonBody("The feed.", ref("CatalogSourceInput")),
    responses: { "201": jsonResponse("The feed, as stored.", ref("CatalogSource")) },
  },
  {
    method: "get",
    path: "/api/catalog-sources/{id}",
    tag: "Supplier feeds",
    operationId: "getCatalogSource",
    summary: "Read one supplier feed",
    parameters: [idParam("feed")],
    responses: { "200": jsonResponse("The feed.", ref("CatalogSource")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/catalog-sources/{id}",
    tag: "Supplier feeds",
    operationId: "updateCatalogSource",
    summary: "Replace one supplier feed",
    parameters: [idParam("feed")],
    requestBody: jsonBody("The feed, whole.", ref("CatalogSourceInput")),
    responses: { "200": jsonResponse("The feed, as stored.", ref("CatalogSource")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/catalog-sources/{id}",
    tag: "Supplier feeds",
    operationId: "deleteCatalogSource",
    summary: "Delete one supplier feed",
    description: "The items it wrote stay in the catalogue; their provenance still names it.",
    parameters: [idParam("feed")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/catalog-sources/{id}/inspect",
    tag: "Supplier feeds",
    operationId: "inspectCatalogSource",
    summary: "{ body? } → the columns a feed actually has, and a few sample rows",
    description:
      "Posts an uploaded payload, or fetches the feed's URL when none is posted, so a mapping can " +
      "be written against the real columns rather than a guess. Writes nothing.",
    parameters: [idParam("feed")],
    requestBody: { ...jsonBody("An uploaded payload, or nothing.", ref("FeedUpload")), required: false },
    responses: {
      "200": jsonResponse("The columns.", ref("FeedInspection")),
      "404": responseRef("NotFound"),
      "422": jsonResponse("The payload could not be read as the feed's format.", ref("Error")),
      "502": jsonResponse("The feed's URL could not be fetched.", ref("Error")),
    },
  },
  {
    method: "post",
    path: "/api/catalog-sources/{id}/preview",
    tag: "Supplier feeds",
    operationId: "previewCatalogSync",
    summary: "{ body? } → the plan a sync would carry out. Writes nothing",
    description:
      "The same function the sync runs, stopped one step earlier, so what you review is exactly " +
      "what would be written. A price or cost move past the feed's `maxPriceChangePercent` " +
      "appears as `flagged`, with both numbers.",
    parameters: [idParam("feed")],
    requestBody: { ...jsonBody("An uploaded payload, or nothing.", ref("FeedUpload")), required: false },
    responses: { "200": jsonResponse("The plan.", ref("SyncResult")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/catalog-sources/{id}/sync",
    tag: "Supplier feeds",
    operationId: "runCatalogSync",
    summary: "{ body?, accept? } → apply a sync",
    description:
      "A feed writes **only the fields its policy names**, and never deletes anything — a dropped " +
      "item can be deactivated, and only if the policy asks. Flagged rows are skipped unless " +
      "their keys are named in `accept`: a price move past the ceiling is never written on the " +
      "strength of the policy alone. One bad row is reported in `failures` and skipped; it never " +
      "abandons the rest.",
    parameters: [idParam("feed")],
    requestBody: { ...jsonBody("An uploaded payload, and the flagged keys to let through.", ref("SyncInput")), required: false },
    responses: {
      "200": jsonResponse("What was planned and what was written.", ref("SyncResult")),
      "404": responseRef("NotFound"),
      "409": jsonResponse("The feed is switched off.", ref("Error")),
    },
  },

  /* -------------------------------- rules ------------------------------- */
  {
    method: "get",
    path: "/api/pricing-rules",
    tag: "Rules",
    operationId: "listPricingRules",
    summary: "List pricing rules",
    responses: { "200": jsonResponse("The rules, in priority order.", array(ref("PricingRule"))) },
  },
  {
    method: "post",
    path: "/api/pricing-rules",
    tag: "Rules",
    operationId: "createPricingRule",
    summary: "Create a pricing rule",
    requestBody: jsonBody("The rule.", ref("PricingRuleInput")),
    responses: { "201": jsonResponse("The rule, as stored.", ref("PricingRule")) },
  },
  {
    method: "get",
    path: "/api/pricing-rules/{id}",
    tag: "Rules",
    operationId: "getPricingRule",
    summary: "Read one pricing rule",
    parameters: [idParam("rule")],
    responses: { "200": jsonResponse("The rule.", ref("PricingRule")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/pricing-rules/{id}",
    tag: "Rules",
    operationId: "updatePricingRule",
    summary: "Replace one pricing rule",
    parameters: [idParam("rule")],
    requestBody: jsonBody("The rule, whole.", ref("PricingRuleInput")),
    responses: { "200": jsonResponse("The rule, as stored.", ref("PricingRule")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/pricing-rules/{id}",
    tag: "Rules",
    operationId: "deletePricingRule",
    summary: "Delete one pricing rule",
    parameters: [idParam("rule")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/approval-rules",
    tag: "Rules",
    operationId: "listApprovalRules",
    summary: "List approval rules",
    responses: { "200": jsonResponse("The ladder.", array(ref("ApprovalRule"))) },
  },
  {
    method: "post",
    path: "/api/approval-rules",
    tag: "Rules",
    operationId: "createApprovalRule",
    summary: "Create an approval rule",
    description:
      "A rule asks everyone on it at once, and carries its own approve and reject quorums — " +
      "`approvalsRequired` of them must say yes, `rejectionsRequired` must say no. Both are " +
      "clamped to the number of approvers rather than refused.",
    requestBody: jsonBody("The rule.", ref("ApprovalRuleInput")),
    responses: { "201": jsonResponse("The rule, as stored.", ref("ApprovalRule")) },
  },
  {
    method: "get",
    path: "/api/approval-rules/{id}",
    tag: "Rules",
    operationId: "getApprovalRule",
    summary: "Read one approval rule",
    parameters: [idParam("rule")],
    responses: { "200": jsonResponse("The rule.", ref("ApprovalRule")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/approval-rules/{id}",
    tag: "Rules",
    operationId: "updateApprovalRule",
    summary: "Replace one approval rule",
    parameters: [idParam("rule")],
    requestBody: jsonBody("The rule, whole.", ref("ApprovalRuleInput")),
    responses: { "200": jsonResponse("The rule, as stored.", ref("ApprovalRule")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/approval-rules/{id}",
    tag: "Rules",
    operationId: "deleteApprovalRule",
    summary: "Delete one approval rule",
    parameters: [idParam("rule")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/formula/validate",
    tag: "Rules",
    operationId: "validateFormula",
    summary: "{ expression, scope } → check a pricing or approval formula",
    description:
      "The expression language in `src/lib/formula.ts`: arithmetic, comparisons and logic, parsed " +
      "to a tree and evaluated by hand — never `eval`. Checks that it parses and that every name " +
      "in it is a variable that scope actually has.",
    requestBody: jsonBody("The formula and the scope it will run in.", ref("FormulaInput")),
    responses: { "200": jsonResponse("Whether it parses, and what it may name.", ref("FormulaCheck")) },
  },

  /* -------------------------------- quotes ------------------------------ */
  {
    method: "get",
    path: "/api/quotes",
    tag: "Quotes",
    operationId: "listQuotes",
    summary: "List quotes (?limit=)",
    description: "Summaries: the header and the totals, without the lines.",
    parameters: [
      queryParam("limit", "How many to return. `0` returns all of them.", { type: "integer", minimum: 0 }),
    ],
    responses: { "200": jsonResponse("The quotes, newest first.", array(ref("QuoteSummary"))) },
  },
  {
    method: "post",
    path: "/api/quotes",
    tag: "Quotes",
    operationId: "createQuote",
    summary: "Create a quote — the server prices it",
    description:
      "Totals in the body are ignored and overwritten. The server runs the same pricing engine " +
      "the browser does (`src/lib/pricing.ts`), so what is stored is what the engine says, not " +
      "what the caller claimed.",
    requestBody: jsonBody("The quote header and its lines.", ref("QuoteInput")),
    responses: { "201": jsonResponse("The quote, priced and stored.", ref("SavedQuote")) },
  },
  {
    method: "get",
    path: "/api/quotes/search",
    tag: "Quotes",
    operationId: "searchQuotes",
    summary: "Search quotes, a page at a time",
    description:
      "What the estimates screen reads. `q` matches the name, the number and the customer's name; " +
      "`status` narrows to one status, with `expired` meaning a sent quote whose date has passed, " +
      "the same way a single quote reports it. `counts` answers for the search alone, per status, " +
      "so a filter can say what it would show before it is picked.",
    parameters: [
      queryParam("q", "Text to find in the name, the number or the customer's name.", { type: "string" }),
      queryParam("status", "One status, or `all`.", { type: "string", enum: ["all", ...QUOTE_STATUSES] }),
      queryParam("sort", "The column to sort on.", { type: "string", enum: [...QUOTE_SORTS] }),
      queryParam("dir", "`asc` or `desc`. Newest first by default.", { type: "string", enum: ["asc", "desc"] }),
      queryParam("page", "Which page, from 1.", { type: "integer", minimum: 1 }),
      queryParam("perPage", `How many per page, at most ${QUOTE_PAGE_MAX}.`, {
        type: "integer",
        minimum: 1,
        maximum: QUOTE_PAGE_MAX,
      }),
    ],
    responses: { "200": jsonResponse("One page of matches, with the totals.", ref("QuotePage")) },
  },
  {
    method: "get",
    path: "/api/quotes/awaiting",
    tag: "Quotes",
    operationId: "listQuotesAwaitingMe",
    summary: "Quotes waiting on your approval",
    description:
      "An approver sees the quotes a rule named them on, and nothing else of that account's. " +
      "Answer one with `POST /api/quotes/{id}/decision`.",
    responses: { "200": jsonResponse("Quotes you are being asked about.", array(ref("QuoteSummary"))) },
  },
  {
    method: "post",
    path: "/api/quotes/preview",
    tag: "Quotes",
    operationId: "previewQuote",
    summary: "Price a quote without storing it",
    description:
      "The same pipeline as a save, with nothing written: the priced lines, the totals, the " +
      "issues and warnings, and the approvals it would need.",
    requestBody: jsonBody("The quote to price.", ref("QuoteInput")),
    responses: { "200": jsonResponse("What it would come to.", ref("QuotePreview")) },
  },
  {
    method: "get",
    path: "/api/quotes/{id}",
    tag: "Quotes",
    operationId: "getQuote",
    summary: "Read one quote, with its lines and totals",
    parameters: [idParam("quote")],
    responses: { "200": jsonResponse("The quote.", ref("Quote")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/quotes/{id}",
    tag: "Quotes",
    operationId: "updateQuote",
    summary: "Replace a draft quote — the server reprices it",
    description:
      "Editable in `draft` and `rejected` only; anything else is revised rather than edited. An " +
      "edit voids any approval decisions the quote had — they are recomputed from scratch on the " +
      "next submit.",
    parameters: [idParam("quote")],
    requestBody: jsonBody("The quote, whole.", ref("QuoteInput")),
    responses: { "200": jsonResponse("The quote, repriced.", ref("SavedQuote")), "404": responseRef("NotFound") },
  },
  {
    method: "delete",
    path: "/api/quotes/{id}",
    tag: "Quotes",
    operationId: "deleteQuote",
    summary: "Delete one quote",
    parameters: [idParam("quote")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/quotes/{id}/submit",
    tag: "Quotes",
    operationId: "submitQuote",
    summary: "Reprice, run the approval rules, and submit",
    description:
      "Levels are cumulative: a quote needs every level at or below the highest one it trips. A " +
      "quote that trips nothing is approved outright, and the response says so.",
    parameters: [idParam("quote")],
    responses: { "200": jsonResponse("Where the quote now stands.", ref("SubmitResult")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/quotes/{id}/decision",
    tag: "Quotes",
    operationId: "decideQuote",
    summary: "{ decision: approved|rejected, comment? } → answer as an approver",
    description:
      "One person's answer on every request they are named on. A request's own status is derived " +
      "from the answers it holds against its two quorums — it is never assigned.",
    parameters: [idParam("quote")],
    requestBody: jsonBody("Your answer.", ref("DecisionInput")),
    responses: { "200": jsonResponse("The quote, as it now stands.", ref("Quote")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/quotes/{id}/status",
    tag: "Quotes",
    operationId: "setQuoteStatus",
    summary: "{ status } → sent, accepted, declined, or back to draft",
    description: "Only the transitions the quote's current status allows; the rest are refused by name.",
    parameters: [idParam("quote")],
    requestBody: jsonBody("The status to move to.", ref("StatusInput")),
    responses: { "200": jsonResponse("The quote.", ref("Quote")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/quotes/{id}/revise",
    tag: "Quotes",
    operationId: "reviseQuote",
    summary: "Create the next revision, leaving this one as it was",
    description: "The new quote's number appends `-r<version>`, and it names the one it supersedes.",
    parameters: [idParam("quote")],
    responses: { "201": jsonResponse("The new revision.", ref("SavedQuote")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/quotes/{id}/export",
    tag: "Quotes",
    operationId: "exportQuote",
    summary: "Download a quote (?format=csv|json)",
    parameters: [idParam("quote"), formatParam("the quote")],
    responses: { "200": exportResponse("The quote.", ref("Quote")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/quotes/{id}/document",
    tag: "Quotes",
    operationId: "renderQuoteDocument",
    summary: "Render a quote through a template (?templateId=, &inline). A PDF template answers with the PDF",
    description:
      "The template's `kind` has to be `quote`. An invoice template is refused rather than " +
      "rendered: every token would resolve to a blank, and a document full of holes is worse " +
      "than an error.",
    parameters: [
      idParam("quote"),
      queryParam("templateId", "Which template. Left out, the first quote template is used.", { type: "string" }),
      queryParam("inline", "Answer with `RenderedDocument` JSON instead of a file download.", { type: "boolean" }),
    ],
    responses: {
      "200": documentResponse("quote"),
      "404": responseRef("NotFound"),
      "422": jsonResponse("That template renders invoices, not quotes.", ref("Error")),
    },
  },
  {
    method: "post",
    path: "/api/quotes/{id}/invoice",
    tag: "Quotes",
    operationId: "invoiceQuote",
    summary: "Raise an invoice for a sent or accepted quote",
    description:
      "Bills the whole contract value, with the quote discount, any adjustment and shipping as " +
      "lines of their own. Where rounding lands the invoice a penny off the quote, it warns " +
      "rather than hiding it. Billing a subscription period by period is a billing schedule, " +
      "which this deliberately does not do.",
    parameters: [idParam("quote")],
    responses: {
      "201": jsonResponse("The draft invoice.", ref("SavedInvoice")),
      "404": responseRef("NotFound"),
    },
  },

  /* ----------------------------- receivables ---------------------------- */
  {
    method: "get",
    path: "/api/invoices",
    tag: "Receivables",
    operationId: "listInvoices",
    summary: "List invoices",
    description:
      "Every listing reads the ledger in two queries for the whole page, so each summary's " +
      "balance is the one the payments behind it imply.",
    responses: { "200": jsonResponse("The invoices, with their ledgers.", array(ref("InvoiceSummary"))) },
  },
  {
    method: "post",
    path: "/api/invoices",
    tag: "Receivables",
    operationId: "createInvoice",
    summary: "Create a draft invoice for a customer",
    description:
      "Always a draft: issuing is a separate, deliberate act, because it is what makes an invoice " +
      "a receivable and fixes its lines. Totals in the body are ignored — the server totals it.",
    requestBody: jsonBody("The invoice header and its lines.", ref("InvoiceInput")),
    responses: { "201": jsonResponse("The draft.", ref("SavedInvoice")) },
  },
  {
    method: "get",
    path: "/api/invoices/export",
    tag: "Receivables",
    operationId: "exportInvoices",
    summary: "Download every invoice with its aging (?format=csv|json)",
    parameters: [formatParam("the receivables ledger")],
    responses: { "200": exportResponse("The invoices.", array(ref("InvoiceSummary"))) },
  },
  {
    method: "get",
    path: "/api/invoices/{id}",
    tag: "Receivables",
    operationId: "getInvoice",
    summary: "Read one invoice, with its lines and ledger",
    description:
      "`totals.balance` and the derived status are recomputed on every read from the `payments` " +
      "and `credits` collections and today's date — never read off the record.",
    parameters: [idParam("invoice")],
    responses: { "200": jsonResponse("The invoice.", ref("Invoice")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/invoices/{id}",
    tag: "Receivables",
    operationId: "updateInvoice",
    summary: "Replace a draft invoice — the server re-totals it",
    description: "Drafts only. An issued invoice's lines are fixed: change what is owed with a credit, not an edit.",
    parameters: [idParam("invoice")],
    requestBody: jsonBody("The invoice, whole.", ref("InvoiceInput")),
    responses: {
      "200": jsonResponse("The invoice, re-totalled.", ref("SavedInvoice")),
      "404": responseRef("NotFound"),
      "422": jsonResponse("This invoice has been issued, so its lines are fixed.", ref("Error")),
    },
  },
  {
    method: "delete",
    path: "/api/invoices/{id}",
    tag: "Receivables",
    operationId: "deleteInvoice",
    summary: "Discard a draft. An issued invoice is voided, never deleted",
    description: "Invoice numbers have to be gapless, so nothing that was ever issued leaves the run.",
    parameters: [idParam("invoice")],
    responses: {
      "200": jsonResponse("Discarded.", ref("Ok")),
      "404": responseRef("NotFound"),
      "422": jsonResponse("This invoice has been issued — void it instead.", ref("Error")),
    },
  },
  {
    method: "post",
    path: "/api/invoices/{id}/issue",
    tag: "Receivables",
    operationId: "issueInvoice",
    summary: "{ issueDate? } → date it, set its due date, make it a receivable",
    description:
      "The due date is the issue date plus the terms snapshotted onto the invoice — moving the " +
      "customer to Net 60 tomorrow must not move a date their accounts payable already diarised.",
    parameters: [idParam("invoice")],
    requestBody: jsonBody("When it was issued. Left out, today.", ref("IssueInput")),
    responses: { "200": jsonResponse("The issued invoice.", ref("Invoice")), "404": responseRef("NotFound") },
  },
  {
    method: "post",
    path: "/api/invoices/{id}/void",
    tag: "Receivables",
    operationId: "voidInvoice",
    summary: "Cancel one. Refused once a payment is recorded",
    description: "Money that has arrived against an invoice is a fact; credit it rather than voiding it.",
    parameters: [idParam("invoice")],
    responses: {
      "200": jsonResponse("The voided invoice.", ref("Invoice")),
      "404": responseRef("NotFound"),
      "422": jsonResponse("A payment has been recorded against it.", ref("Error")),
    },
  },
  {
    method: "get",
    path: "/api/invoices/{id}/payments",
    tag: "Receivables",
    operationId: "listInvoicePayments",
    summary: "One invoice's payments",
    parameters: [idParam("invoice")],
    responses: { "200": jsonResponse("The payments against it.", array(ref("InvoicePayment"))) },
  },
  {
    method: "post",
    path: "/api/invoices/{id}/payments",
    tag: "Receivables",
    operationId: "recordPayment",
    summary: "{ amount, receivedOn?, method?, reference? } → record cash received",
    description:
      "An insert into a collection of its own, not a rewrite of the invoice — two people banking " +
      "cash at the same moment cannot lose a payment. Only an issued invoice has a ledger.",
    parameters: [idParam("invoice")],
    requestBody: jsonBody("The payment.", ref("PaymentInput")),
    responses: {
      "201": jsonResponse("The invoice, with the payment on it.", ref("SavedInvoice")),
      "404": responseRef("NotFound"),
      "422": jsonResponse("Nothing can be paid against a draft.", ref("Error")),
    },
  },
  {
    method: "delete",
    path: "/api/invoices/{id}/payments/{paymentId}",
    tag: "Receivables",
    operationId: "removePayment",
    summary: "Remove a payment entered in error",
    parameters: [idParam("invoice"), idParam("payment", "paymentId")],
    responses: { "200": jsonResponse("The invoice, without it.", ref("Invoice")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/invoices/{id}/credits",
    tag: "Receivables",
    operationId: "listInvoiceCredits",
    summary: "One invoice's credits",
    parameters: [idParam("invoice")],
    responses: { "200": jsonResponse("The credits against it.", array(ref("InvoiceCredit"))) },
  },
  {
    method: "post",
    path: "/api/invoices/{id}/credits",
    tag: "Receivables",
    operationId: "recordCredit",
    summary: "{ amount, reason?, issuedOn? } → credit or write off",
    description:
      "Crediting more than is owed is refused: unlike an overpayment, which is the customer's " +
      "doing and leaves a negative balance owed back to them, an over-credit is always a typo on " +
      "your own side.",
    parameters: [idParam("invoice")],
    requestBody: jsonBody("The credit.", ref("CreditInput")),
    responses: {
      "201": jsonResponse("The invoice, with the credit on it.", ref("SavedInvoice")),
      "404": responseRef("NotFound"),
      "422": jsonResponse("That credit is larger than what is left owing.", ref("Error")),
    },
  },
  {
    method: "delete",
    path: "/api/invoices/{id}/credits/{creditId}",
    tag: "Receivables",
    operationId: "removeCredit",
    summary: "Remove a credit entered in error",
    parameters: [idParam("invoice"), idParam("credit", "creditId")],
    responses: { "200": jsonResponse("The invoice, without it.", ref("Invoice")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/invoices/{id}/export",
    tag: "Receivables",
    operationId: "exportInvoice",
    summary: "Download one invoice (?format=csv|json)",
    parameters: [idParam("invoice"), formatParam("the invoice")],
    responses: { "200": exportResponse("The invoice.", ref("Invoice")), "404": responseRef("NotFound") },
  },
  {
    method: "get",
    path: "/api/invoices/{id}/document",
    tag: "Receivables",
    operationId: "renderInvoiceDocument",
    summary: "Render an invoice through an invoice template (?templateId=, &inline)",
    description:
      "`{{invoice.status}}` and the balance are worked out as the document renders, so an invoice " +
      "printed the morning after it falls due says so. A quote template is refused.",
    parameters: [
      idParam("invoice"),
      queryParam("templateId", "Which template. Left out, the first invoice template is used.", { type: "string" }),
      queryParam("inline", "Answer with `RenderedDocument` JSON instead of a file download.", { type: "boolean" }),
    ],
    responses: {
      "200": documentResponse("invoice"),
      "404": responseRef("NotFound"),
      "422": jsonResponse("That template renders quotes, not invoices.", ref("Error")),
    },
  },
  {
    method: "get",
    path: "/api/receivables/aging",
    tag: "Receivables",
    operationId: "getAgingReport",
    summary: "The aging report (?currency=, ?asOf=, ?format=csv)",
    description:
      "Five buckets on the **balance**, not the total, and never adding two currencies: invoices " +
      "in another are counted and reported separately rather than summed.",
    parameters: [
      queryParam("currency", "Which currency to report in. Others are counted, never summed into it.", {
        type: "string",
        enum: [...CURRENCIES],
      }),
      queryParam("asOf", "The date to age against. Defaults to today.", { type: "string", format: "date" }),
      queryParam("format", "`csv` downloads the report as a spreadsheet.", { type: "string", enum: ["csv"] }),
    ],
    responses: { "200": exportResponse("The report.", ref("AgingReport")) },
  },
  {
    method: "get",
    path: "/api/payments",
    tag: "Receivables",
    operationId: "listPayments",
    summary: "Every payment received (?invoiceId=, ?format=csv) — the cash receipts list",
    description: "A question about payments rather than about invoices, answerable without opening every invoice.",
    parameters: [
      queryParam("invoiceId", "Narrow it to one invoice's ledger.", { type: "string" }),
      queryParam("format", "`csv` downloads it as a spreadsheet.", { type: "string", enum: ["csv"] }),
    ],
    responses: { "200": exportResponse("The payments, newest first.", array(ref("InvoicePayment"))) },
  },
  {
    method: "get",
    path: "/api/credits",
    tag: "Receivables",
    operationId: "listCredits",
    summary: "Every credit and write-off (?invoiceId=, ?format=csv)",
    parameters: [
      queryParam("invoiceId", "Narrow it to one invoice's ledger.", { type: "string" }),
      queryParam("format", "`csv` downloads it as a spreadsheet.", { type: "string", enum: ["csv"] }),
    ],
    responses: { "200": exportResponse("The credits, newest first.", array(ref("InvoiceCredit"))) },
  },

  /* ------------------------------ documents ----------------------------- */
  {
    method: "get",
    path: "/api/proposal-templates",
    tag: "Documents",
    operationId: "listProposalTemplates",
    summary: "List templates you own or that are shared with you — quote and invoice alike",
    description:
      "One collection with a `kind`, because a template is a template: same editor, same " +
      "letterhead, same block language, and only the meaning of a token differs.",
    responses: { "200": jsonResponse("The templates.", array(ref("ProposalTemplate"))) },
  },
  {
    method: "post",
    path: "/api/proposal-templates",
    tag: "Documents",
    operationId: "createProposalTemplate",
    summary: "Create a template ({ kind: quote | invoice })",
    requestBody: jsonBody("The template.", ref("ProposalTemplateInput")),
    responses: { "201": jsonResponse("The template, as stored.", ref("ProposalTemplate")) },
  },
  {
    method: "get",
    path: "/api/proposal-templates/{id}",
    tag: "Documents",
    operationId: "getProposalTemplate",
    summary: "Read one template",
    parameters: [idParam("template")],
    responses: { "200": jsonResponse("The template.", ref("ProposalTemplate")), "404": responseRef("NotFound") },
  },
  {
    method: "put",
    path: "/api/proposal-templates/{id}",
    tag: "Documents",
    operationId: "updateProposalTemplate",
    summary: "Replace one template (owner only)",
    parameters: [idParam("template")],
    requestBody: jsonBody("The template, whole.", ref("ProposalTemplateInput")),
    responses: {
      "200": jsonResponse("The template, as stored.", ref("ProposalTemplate")),
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "delete",
    path: "/api/proposal-templates/{id}",
    tag: "Documents",
    operationId: "deleteProposalTemplate",
    summary: "Delete one template (owner only)",
    parameters: [idParam("template")],
    responses: { "200": jsonResponse("Deleted.", ref("Ok")), "404": responseRef("NotFound") },
  },

  /* ------------------------------- sharing ------------------------------ */
  ...shareOperations("projects", "a project", "project"),
  ...shareOperations("catalog-sources", "a supplier feed", "catalogSource"),
  ...shareOperations("products", "a product", "product"),
  ...shareOperations("price-books", "a price book", "priceBook"),
  ...shareOperations("quotes", "a quote", "quote"),
  ...shareOperations("invoices", "an invoice", "invoice"),
  ...shareOperations("proposal-templates", "a template", "template"),

  /* ------------------------------ workspace ----------------------------- */
  {
    method: "get",
    path: "/api/export",
    tag: "Workspace",
    operationId: "exportWorkspace",
    summary: "Download the whole workspace — catalogue, customers, quotes, invoices, templates",
    description: "Quotes and invoices come out whole, with their lines and ledgers rather than as summaries.",
    responses: { "200": fileResponse("The workspace file.", "application/json") },
  },
  {
    method: "post",
    path: "/api/sample",
    tag: "Workspace",
    operationId: "installSample",
    summary: "Install the worked example: catalogue, policy, customers, a quote",
    description: "Additive — anything already here under the same SKU or name is left exactly as it is.",
    responses: { "201": jsonResponse("What was installed.", ref("SeedReport")) },
  },

  /* ------------------------------- website ------------------------------ */
  {
    method: "get",
    path: "/api/site",
    tag: "Website",
    operationId: "getSitePage",
    summary: "The public website, every slot filled and in order",
    description:
      "What a visitor who has not signed in is shown. Each slot names texts or images; a single-valued " +
      "slot holds at most one. Placements naming a slot the page does not draw, or content that is gone, " +
      "are left out rather than reported.",
    anonymous: true,
    responses: { "200": jsonResponse("The page.", ref("SitePage")) },
  },
  {
    method: "get",
    path: "/api/site/images/{id}/{file}",
    tag: "Website",
    operationId: "getSiteImage",
    summary: "One picture on the website (?thumb=960x0 for a smaller copy)",
    description:
      "Relayed from PocketBase, which a browser cannot reach. The filename changes whenever the picture " +
      "does, so it is cached for a year.",
    anonymous: true,
    parameters: [
      idParam("image"),
      { name: "file", in: "path", required: true, description: "The stored filename, from `SiteImage.url`.", schema: { type: "string" } },
      queryParam("thumb", "A narrower copy, at one of the widths kept.", {
        type: "string",
        enum: SITE_IMAGE_WIDTHS.map(width => `${width}x0`),
      }),
    ],
    responses: {
      "200": { description: "The image.", content: Object.fromEntries(SITE_IMAGE_TYPES.map(type => [type, { schema: { type: "string", format: "binary" } }])) },
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "post",
    path: "/api/site/contact",
    tag: "Website",
    operationId: "submitContactRequest",
    summary: "{ firstName, lastName, email, description, phone?, area? } → the contact form",
    description:
      "No credential: the visitor has no account. A few requests per sender in fifteen minutes, then 429. " +
      `A request with the hidden \`${CONTACT_HONEYPOT}\` field filled is answered the same way and not kept.`,
    anonymous: true,
    requestBody: jsonBody("What the visitor wrote.", ref("ContactRequestInput")),
    responses: {
      "201": jsonResponse("Received.", ref("Ok")),
      "429": jsonResponse("Too many from one sender, too quickly.", ref("Error")),
    },
  },
  {
    method: "get",
    path: "/api/site/content",
    tag: "Website",
    operationId: "getSiteContent",
    summary: "Every text, image and placement — what the website editor works with",
    responses: { "200": jsonResponse("All of it, placed or not.", ref("SiteContent")) },
  },
  {
    method: "post",
    path: "/api/site/texts",
    tag: "Website",
    operationId: "createSiteText",
    summary: "{ name, title?, body?, items? } → a new block of words (editors only)",
    requestBody: jsonBody("The text.", ref("SiteTextInput")),
    responses: { "201": jsonResponse("Created.", ref("SiteText")), "403": jsonResponse("Not a website editor.", ref("Error")) },
  },
  {
    method: "put",
    path: "/api/site/texts/{id}",
    tag: "Website",
    operationId: "updateSiteText",
    summary: "Replace a block of words, wherever it is placed",
    parameters: [idParam("text")],
    requestBody: jsonBody("The text.", ref("SiteTextInput")),
    responses: {
      "200": jsonResponse("Saved.", ref("SiteText")),
      "403": jsonResponse("Not a website editor.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "delete",
    path: "/api/site/texts/{id}",
    tag: "Website",
    operationId: "deleteSiteText",
    summary: "Delete a block of words, and take it out of every slot",
    parameters: [idParam("text")],
    responses: {
      "200": jsonResponse("Deleted.", ref("Ok")),
      "403": jsonResponse("Not a website editor.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "post",
    path: "/api/site/images",
    tag: "Website",
    operationId: "createSiteImage",
    summary: "multipart { file, name?, alt? } → upload a picture (editors only)",
    description: `JPEG, PNG, WebP, GIF or AVIF, up to ${MAX_SITE_IMAGE_BYTES / 1_048_576} MB. No SVG — it would be served from this origin, and an SVG can carry script.`,
    requestBody: { required: true, content: { "multipart/form-data": { schema: ref("SiteImageUpload") } } },
    responses: { "201": jsonResponse("Uploaded.", ref("SiteImage")), "403": jsonResponse("Not a website editor.", ref("Error")) },
  },
  {
    method: "put",
    path: "/api/site/images/{id}",
    tag: "Website",
    operationId: "updateSiteImage",
    summary: "New words for a picture, and optionally a new file in its place",
    description: "JSON `{ name, alt }` to change the words; multipart with a `file` to replace the picture too.",
    parameters: [idParam("image")],
    requestBody: {
      required: true,
      content: {
        "application/json": { schema: ref("SiteImageMeta") },
        "multipart/form-data": { schema: ref("SiteImageUpload") },
      },
    },
    responses: {
      "200": jsonResponse("Saved.", ref("SiteImage")),
      "403": jsonResponse("Not a website editor.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "delete",
    path: "/api/site/images/{id}",
    tag: "Website",
    operationId: "deleteSiteImage",
    summary: "Delete a picture, and take it out of every slot",
    parameters: [idParam("image")],
    responses: {
      "200": jsonResponse("Deleted.", ref("Ok")),
      "403": jsonResponse("Not a website editor.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "put",
    path: "/api/site/slots/{slot}",
    tag: "Website",
    operationId: "setSiteSlot",
    summary: "{ ids } → what one slot of the page holds, in order",
    description:
      "The website config: one call replaces a slot's contents. Text slots take text ids, image slots " +
      "image ids; an empty list clears it.",
    parameters: [
      {
        name: "slot",
        in: "path",
        required: true,
        description: "Which part of the page.",
        schema: { type: "string", enum: SITE_SLOTS.map(slot => slot.key) },
      },
    ],
    requestBody: jsonBody("The contents, in order.", ref("SiteSlotInput")),
    responses: {
      "200": jsonResponse("The slot's placements, as they now stand.", array(ref("SitePlacement"))),
      "403": jsonResponse("Not a website editor.", ref("Error")),
    },
  },
  {
    method: "get",
    path: "/api/site/requests",
    tag: "Website",
    operationId: "listContactRequests",
    summary: "What the contact form has received, newest first (editors only)",
    responses: {
      "200": jsonResponse("The requests.", array(ref("ContactRequest"))),
      "403": jsonResponse("Not a website editor.", ref("Error")),
    },
  },
  {
    method: "put",
    path: "/api/site/requests/{id}",
    tag: "Website",
    operationId: "setContactRequestStatus",
    summary: "{ status } → mark a request replied, archived, or new again",
    parameters: [idParam("request")],
    requestBody: jsonBody("The new status.", ref("ContactRequestStatusInput")),
    responses: {
      "200": jsonResponse("Saved.", ref("ContactRequest")),
      "403": jsonResponse("Not a website editor.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },
  {
    method: "delete",
    path: "/api/site/requests/{id}",
    tag: "Website",
    operationId: "deleteContactRequest",
    summary: "Delete a contact request",
    parameters: [idParam("request")],
    responses: {
      "200": jsonResponse("Deleted.", ref("Ok")),
      "403": jsonResponse("Not a website editor.", ref("Error")),
      "404": responseRef("NotFound"),
    },
  },
];

/* --------------------------------- schemas -------------------------------- */

const string_ = (description: string, extra: Json = {}) => ({ type: "string", description, ...extra });
const number_ = (description: string, extra: Json = {}) => ({ type: "number", description, ...extra });
const integer_ = (description: string, extra: Json = {}) => ({ type: "integer", description, ...extra });
const boolean_ = (description: string, extra: Json = {}) => ({ type: "boolean", description, ...extra });
const enum_ = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
const money = (description: string) => number_(description, { format: "double" });
const percent = (description: string) => number_(description, { minimum: 0, maximum: 100 });
const date_ = (description: string) => string_(description, { format: "date" });
const timestamp = (description: string) => string_(description, { format: "date-time" });
const id = (description: string) => string_(description);

const object = (description: string, properties: Record<string, Json>, required: string[] = []): Json => ({
  type: "object",
  description,
  properties,
  ...(required.length ? { required } : {}),
});

const currency = () => enum_(CURRENCIES, "ISO 4217 code. Nothing in this app ever adds two currencies.");

const ownership = {
  ownerId: id("The account that owns it."),
  sharedWith: array(id("An account it is shared with, read-only.")),
  createdAt: timestamp("When it was created."),
  updatedAt: timestamp("When it last changed."),
};

/**
 * The preference set, read off the defaults.
 *
 * Writing the properties out by hand would mean a preference could be added to
 * the account and never appear here; taking the keys from the default set
 * means the document gains it the day the preference does.
 */
function preferencesSchema(): Json {
  const bounded: Record<string, Json> = {
    theme: { enum: [...THEMES] },
    accent: { enum: ACCENTS.map(accent => accent.id) },
    font: { enum: FONTS.map(font => font.id) },
    defaultCurrency: { enum: [...CURRENCIES] },
    defaultTermMonths: { minimum: PREFERENCE_LIMITS.termMonths.min, maximum: PREFERENCE_LIMITS.termMonths.max },
    defaultTaxPercent: { minimum: PREFERENCE_LIMITS.taxPercent.min, maximum: PREFERENCE_LIMITS.taxPercent.max },
    quoteValidDays: { minimum: PREFERENCE_LIMITS.validDays.min, maximum: PREFERENCE_LIMITS.validDays.max },
    quoteListLimit: { minimum: PREFERENCE_LIMITS.quoteList.min, maximum: PREFERENCE_LIMITS.quoteList.max },
  };

  const properties: Record<string, Json> = {};
  for (const [key, value] of Object.entries(DEFAULT_PREFERENCES)) {
    properties[key] = {
      type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string",
      default: value,
      ...(bounded[key] ?? {}),
    };
  }

  return object(
    "Per-account defaults. Out-of-range values are clamped rather than refused, and a key that is " +
      "missing falls back to its default.",
    properties,
  );
}

function schemas(): Record<string, Json> {
  const address = object("A postal address. Every field is optional.", {
    line1: string_("Street address."),
    line2: string_("Suite, floor, unit."),
    city: string_("City."),
    state: string_("State, province or region."),
    postalCode: string_("Postal or ZIP code."),
    country: string_("Country."),
  });

  const customerSnapshot = object(
    "The customer as they were when the document was written. Snapshotted on purpose: the account " +
      "can be renamed, re-addressed or deleted, and an issued document still says who it went to.",
    {
      accountId: string_("The customer record it came from, or null.", { nullable: true }),
      name: string_("The customer's name."),
      contactName: string_("The primary contact, flattened — a document addresses one person."),
      contactTitle: string_("Their job title."),
      contactEmail: string_("Their email.", { format: "email" }),
      contactPhone: string_("Their phone."),
      billingAddress: ref("Address"),
      shippingAddress: ref("Address"),
      paymentTerms: string_('The terms as written — "Net 30".'),
    },
  );

  const quoteTotals = object("Every total on a quote. Computed by the server; never read from a request body.", {
    currency: currency(),
    lineCount: integer_("How many lines."),
    listTotal: money("Undiscounted value of every line."),
    lineDiscountAmount: money("Line-level discounts, tiers and rules, as money."),
    subtotal: money("After line discounts, before the quote-level discount."),
    quoteDiscountAmount: money("The whole-quote discount, as money."),
    quoteAdjustment: money(
      "What quote-scoped pricing rules added or took off. Kept apart from the discount because a " +
        "surcharge is not a negative discount.",
    ),
    netTotal: money("After every discount and adjustment, before tax."),
    taxAmount: money("Tax."),
    shipping: money("Shipping."),
    grandTotal: money("What the customer is being asked for."),
    effectiveDiscountPercent: percent("`listTotal` − `netTotal`, over `listTotal`. The number an approver reads."),
    costTotal: money("Cost of delivery. Never shown to a buyer."),
    margin: money("`netTotal` − `costTotal`."),
    marginPercent: number_("Margin over net total."),
    oneTimeTotal: money("One-time charges."),
    monthlyRecurringTotal: money("MRR."),
    annualRecurringTotal: money("ARR."),
    totalContractValue: money("One-time charges plus the full recurring value of the term."),
  });

  const quoteLineInput = object("One line as a caller writes it. Everything priced is derived from these.", {
    id: id("A stable id for the line. Generated when left out."),
    productId: id("The product this line sells."),
    quantity: number_("How many."),
    discountPercent: percent("A manual discount the rep applied."),
    unitPriceOverride: number_("A negotiated unit price. `null` means whatever the price book says.", {
      nullable: true,
    }),
    selectedOptions: array(string_("An option key, from any group on the product.")),
    termMonths: integer_("Subscription length for this line. `0` uses the quote's term."),
    description: string_("A note that replaces the catalogue description on the document."),
    parentId: string_("The bundle line this came from. Component lines are not editable.", { nullable: true }),
    sortOrder: integer_("Where it sits in the list."),
  });

  const invoiceLine = object("One billable line. Tax is per line, because one invoice often mixes rates.", {
    id: id("The line's id."),
    quoteLineId: string_("The quote line it was raised from, if any.", { nullable: true }),
    sku: string_("The product's SKU, snapshotted."),
    name: string_("What it is called on the invoice."),
    description: string_("The line's own description."),
    quantity: number_("How many."),
    unitPrice: money("Price per unit, as invoiced."),
    taxPercent: percent("This line's rate."),
    amount: money("`quantity × unitPrice`, rounded to the currency."),
    taxAmount: money("Tax on this line."),
    total: money("Line amount plus its tax."),
  });

  /**
   * A quote's own fields, shared by `Quote` and `QuoteSummary`.
   *
   * The summary is the quote minus its lines and its approval requests, so
   * spelling the header out twice would be two lists that could disagree
   * about what a quote is.
   */
  const quoteHeader: Record<string, Json> = {
    id: id("The quote's id."),
    number: string_('Sequential per account: "Q-2026-0007". A revision appends `-r<version>`.'),
    name: string_("What it is called."),
    status: enum_(QUOTE_STATUSES, "Where it stands. A sent quote past `validUntil` reads as `expired`."),
    version: integer_("1 for the original; a revision of a sent quote increments it."),
    supersedesId: string_("The quote this one revises.", { nullable: true }),
    projectId: id("The job it is for. Empty is ordinary: a bid is often written before there is a job."),
    projectName: string_("That job's number and name, snapshotted, so a list reads without a join."),
    customer: ref("CustomerSnapshot"),
    priceBookId: id("The book it was priced from."),
    currency: currency(),
    termMonths: integer_("Default term for recurring lines that name none."),
    discountPercent: percent("The whole-quote discount."),
    taxPercent: percent("The rate."),
    shipping: money("Shipping."),
    validUntil: date_("When the pricing stops being good."),
    notes: string_("Shown to the customer."),
    internalNotes: string_("Not shown to the customer."),
    totals: ref("QuoteTotals"),
    approverIds: array(id("Who the quote is waiting on, flattened for the access rules.")),
    sentAt: string_("When it went out."),
    decidedAt: string_("When it was accepted or declined."),
    ...ownership,
  };

  /** The same, for an invoice: its header, without lines or ledger rows. */
  const invoiceHeader: Record<string, Json> = {
    id: id("The invoice's id."),
    number: string_('Sequential per account: "INV-2026-0007". The run is gapless.'),
    quoteId: string_("The quote it was raised from.", { nullable: true }),
    quoteNumber: string_("That quote's number, snapshotted, so the link still reads after it is gone."),
    projectId: id("The job it bills against, inherited from the quote it was raised from."),
    projectName: string_("That job's number and name, snapshotted."),
    customer: ref("CustomerSnapshot"),
    currency: currency(),
    state: enum_(INVOICE_STATES, "The only part a person actually sets."),
    issueDate: date_("Empty until it is issued — a draft has no date on it."),
    dueDate: date_("The issue date plus the terms. What aging is measured from."),
    paymentTermDays: integer_("The terms it was raised under, snapshotted."),
    poNumber: string_("The customer's PO reference. Many will not pay without it."),
    notes: string_("Printed on the invoice."),
    internalNotes: string_("Never shown to the customer."),
    totals: ref("InvoiceTotals"),
    ...ownership,
  };

  return {
    /* ------------------------------ envelopes ----------------------------- */
    Error: object("Every failure in this API, whatever went wrong.", { error: string_("One sentence.") }, ["error"]),
    Ok: object("A bare acknowledgement.", { ok: { type: "boolean", enum: [true] } }, ["ok"]),

    /* ------------------------------- website ------------------------------ */
    SiteText: object("A block of words on the public website.", {
      id: id("The text's id."),
      name: string_("What the editor calls it. Never shown on the page."),
      title: string_("A heading, a label, a name — what the slot makes of it."),
      body: string_("Paragraphs, separated by a blank line. `**bold**` is honoured."),
      items: array(string_("One entry of a list: a service's examples, the form's choices.")),
      createdAt: timestamp("Created."),
      updatedAt: timestamp("Last changed."),
    }),
    SiteTextInput: object(
      "A block of words. A name is found from the title or body when one is not given.",
      {
        name: string_("What the editor calls it.", { maxLength: 120 }),
        title: string_("Heading or label.", { maxLength: 300 }),
        body: string_("Paragraphs.", { maxLength: 10000 }),
        items: array(string_("One entry.")),
      },
    ),
    SiteImage: object("A picture on the public website.", {
      id: id("The image's id."),
      name: string_("What the editor calls it."),
      alt: string_("What a screen reader says instead. Empty for a decorative picture."),
      url: string_("Where to load it — this server, which relays PocketBase."),
      createdAt: timestamp("Uploaded."),
      updatedAt: timestamp("Last changed."),
    }),
    SiteImageMeta: object("The words about a picture.", {
      name: string_("What the editor calls it.", { maxLength: 120 }),
      alt: string_("Alternative text.", { maxLength: 500 }),
    }),
    SiteImageUpload: object(
      "A picture, and the words about it.",
      {
        file: string_(`The image: ${SITE_IMAGE_TYPES.join(", ")}.`, { format: "binary" }),
        name: string_("What the editor calls it. Defaults to the filename.", { maxLength: 120 }),
        alt: string_("Alternative text.", { maxLength: 500 }),
      },
      ["file"],
    ),
    SitePlacement: object("One row of the website config: this text or image, in this slot, at this position.", {
      id: id("The placement's id."),
      slot: enum_(SITE_SLOTS.map(slot => slot.key), "Which part of the page."),
      textId: id("The text, for a text slot; empty otherwise."),
      imageId: id("The image, for an image slot; empty otherwise."),
      position: integer_("Order within the slot, from 0."),
    }),
    SiteSlotInput: object(
      "What one slot holds.",
      { ids: { ...array(string_("A text or image id.")), maxItems: MAX_SLOT_ENTRIES } },
      ["ids"],
    ),
    SiteContent: object("Everything behind the website, placed or not.", {
      texts: array(ref("SiteText")),
      images: array(ref("SiteImage")),
      placements: array(ref("SitePlacement")),
    }),
    SitePage: object("The public page: each slot, filled, in order.", {
      texts: { type: "object", description: "Slot → its texts.", additionalProperties: array(ref("SiteText")) },
      images: { type: "object", description: "Slot → its images.", additionalProperties: array(ref("SiteImage")) },
    }),
    ContactRequestInput: object(
      "The contact form.",
      {
        firstName: string_("First name.", { maxLength: 100 }),
        lastName: string_("Last name.", { maxLength: 100 }),
        email: string_("Where to reply.", { format: "email" }),
        phone: string_("Optional.", { maxLength: 40 }),
        area: string_("Which part of the house, from the form's choices.", { maxLength: 100 }),
        description: string_("What the job is.", { maxLength: MAX_CONTACT_MESSAGE }),
      },
      ["firstName", "lastName", "email", "description"],
    ),
    ContactRequestStatusInput: object(
      "A status change.",
      { status: enum_(CONTACT_REQUEST_STATUSES, "Where it stands.") },
      ["status"],
    ),
    ContactRequest: object("What the contact form received.", {
      id: id("The request's id."),
      firstName: string_("First name."),
      lastName: string_("Last name."),
      email: string_("Where to reply.", { format: "email" }),
      phone: string_("Phone, if given."),
      area: string_("Area of the house, if chosen."),
      description: string_("What they wrote."),
      status: enum_(CONTACT_REQUEST_STATUSES, "Where it stands."),
      createdAt: timestamp("When it arrived."),
      updatedAt: timestamp("Last changed."),
    }),

    Health: object("Liveness.", {
      status: string_("`ok` when this server is answering."),
      uptime: integer_("Seconds since the process started."),
      env: string_("`development` or `production`."),
    }),

    Meta: object("Where the data lives, and how much of it this account can see.", {
      url: string_("The PocketBase URL this server talks to."),
      reachable: boolean_("Whether it answered."),
      accounts: integer_("Customers.", { nullable: true }),
      products: integer_("Products.", { nullable: true }),
      priceBooks: integer_("Price books.", { nullable: true }),
      quotes: integer_("Quotes.", { nullable: true }),
      invoices: integer_("Invoices.", { nullable: true }),
      proposalTemplates: integer_("Templates.", { nullable: true }),
    }),

    Directory: object("The accounts on this instance — id, email and name, and nothing else.", {
      users: array(
        object("One account.", {
          id: id("Their account id."),
          email: string_("Their email.", { format: "email" }),
          name: string_("Their name, where they gave one."),
        }),
      ),
      truncated: boolean_("Whether the list was cut short — narrow it with `?search=`."),
    }),

    /* -------------------------------- auth -------------------------------- */
    RegisterInput: object(
      "A new account.",
      {
        email: string_("Their email.", { format: "email" }),
        password: string_("At least 8 characters.", { format: "password", minLength: 8 }),
        name: string_("Display name. Optional."),
      },
      ["email", "password"],
    ),
    LoginInput: object(
      "Credentials.",
      {
        email: string_("The account's email.", { format: "email" }),
        password: string_("Its password.", { format: "password" }),
      },
      ["email", "password"],
    ),
    PasswordInput: object(
      "A password change.",
      {
        currentPassword: string_("The password in use now.", { format: "password" }),
        newPassword: string_("At least 8 characters.", { format: "password", minLength: 8 }),
      },
      ["currentPassword", "newPassword"],
    ),
    SessionUser: object("The signed-in account.", {
      id: id("Account id."),
      email: string_("Email.", { format: "email" }),
      name: string_("Display name."),
      verified: boolean_("Whether the address has been verified."),
      createdAt: timestamp("When the account was created."),
      siteEditor: boolean_("May change the public website. Granted from the PocketBase dashboard, never by the account itself."),
      preferences: ref("Preferences"),
    }),
    SessionEnvelope: object("What the auth endpoints answer with.", { user: ref("SessionUser") }, ["user"]),

    /* ------------------------------ api keys ------------------------------ */
    ApiKey: object("An API key, as it can be described after it exists. Never the secret itself.", {
      id: id("The key's id — what `DELETE /api/keys/{id}` takes."),
      name: string_("What it was issued for."),
      createdAt: timestamp("When it was issued."),
      expiresAt: string_("When it expires. Empty when it never does."),
      lastUsedAt: string_("When it was last used — written at most every few minutes, so it is not a live counter."),
    }),
    IssuedApiKey: {
      allOf: [
        ref("ApiKey"),
        object("The secret, which appears in this one response and nowhere else again.", {
          key: string_(`The key. Begins \`${API_KEY_PREFIX}\`, and is never recoverable — store it now.`),
        }),
      ],
      description: "The issuing response, and the only shape that carries the key.",
    },
    ApiKeyInput: object("What to issue.", {
      name: string_("What the key is for. Shown in the list; not secret.", { maxLength: MAX_KEY_NAME_LENGTH }),
      expiresInDays: integer_("Days until it expires. `0`, or left out, never expires.", {
        minimum: 0,
        maximum: MAX_EXPIRY_DAYS,
      }),
    }),

    Preferences: preferencesSchema(),

    /* ------------------------------ telegram ------------------------------ */
    TelegramSettings: object("What counts as news: supplier-feed syncs, and optionally estimates answered and payments received.", {
      enabled: boolean_("Off sends nothing, and keeps the link."),
      chatId: string_("Read-only: set by pairing."),
      chatLabel: string_("Read-only: who or what the chat is."),
      events: object("Which outcomes are worth a message.", {
        finished: boolean_("A sync that ran to the end, with its counts and anything waiting for review."),
        failed: boolean_("A sync that could not run: the feed was unreachable or unreadable."),
        quoteDecided: boolean_("An estimate marked accepted or declined. Off by default."),
        paymentReceived: boolean_("A payment recorded against an invoice, with the balance left. Off by default."),
      }),
      minRows: integer_("A finished sync of fewer rows says nothing. Failures ignore it.", {
        minimum: 0,
        maximum: MAX_MIN_ROWS,
      }),
      apiKeyOnly: boolean_("Only for what was done with an API key — the integrations nobody is watching."),
    }),
    TelegramStatus: object("The settings and the link. Never the token.", {
      settings: ref("TelegramSettings"),
      bot: object("Which bot sends.", {
        source: enum_(["account", "operator", "none"], "Your own, the server's `TELEGRAM_BOT_TOKEN`, or none."),
        username: string_("Without the @. Empty until the bot has been asked."),
      }),
      pairing: {
        ...object("A pairing in progress.", { code: string_("Send this to the bot."), expiresAt: timestamp("When it lapses.") }),
        nullable: true,
      },
      lastError: string_("The last delivery failure, as one sentence. Cleared by the next success."),
      lastSentAt: string_("When a message was last delivered."),
    }),
    TelegramBotInput: object("A bot of your own.", { token: string_("From BotFather. Empty to clear.") }, ["token"]),
    TelegramPairCheck: object("Whether the code has arrived.", {
      paired: boolean_("True once the chat is linked."),
      status: ref("TelegramStatus"),
    }),

    /* ------------------------------ customers ----------------------------- */
    Address: address,
    AccountContact: object("One person at a customer.", {
      id: id("The contact's id."),
      name: string_("Their name."),
      title: string_("Job title."),
      email: string_("Email.", { format: "email" }),
      phone: string_("Phone."),
      role: enum_(CONTACT_ROLES, "What they are to you."),
      primary: boolean_("Exactly one contact is primary: who a quote is addressed to."),
    }),
    AccountInput: object(
      "A customer.",
      {
        name: string_("Their name."),
        industry: string_("Free text."),
        website: string_("Their site."),
        status: enum_(ACCOUNT_STATUSES, "Where they are in the lifecycle."),
        tags: array(string_("Lowercased, de-duplicated free segmentation.")),
        contacts: array(ref("AccountContact")),
        billingAddress: ref("Address"),
        shippingAddress: ref("Address"),
        shippingSameAsBilling: boolean_(
          "While true, the shipping address is kept equal to the billing one, so nothing downstream " +
            "has to check the flag before reading it.",
        ),
        currency: currency(),
        priceBookId: string_("The book their quotes start on. Empty uses the default book."),
        paymentTerms: string_('As written — "Net 30".'),
        paymentTermDays: integer_(
          "The same terms as a number, which is the form a due date can be computed from. Seeded " +
            "out of the text when left out.",
        ),
        creditLimit: money("Advisory only — nothing here blocks a quote on it."),
        defaultDiscountPercent: percent("A standing discount every quote for them starts with."),
        taxExempt: boolean_("Whether tax is applied."),
        taxPercent: percent("Their rate."),
        notes: string_("Internal notes."),
      },
      ["name"],
    ),
    Account: {
      allOf: [
        object("Stored fields.", { id: id("The customer's id."), ...ownership }),
        ref("AccountInput"),
      ],
      description: `A customer, with the people in it. At most ${MAX_CONTACTS} contacts and ${MAX_TAGS} tags.`,
    },

    /* ------------------------------ catalogue ----------------------------- */
    ProductOption: object("One choice inside an option group.", {
      key: string_("Unique across the whole product — a rule names an option by key alone."),
      name: string_("What it is called on screen and on the document."),
      description: string_("What it is, for the person choosing it."),
      priceDelta: money("Added to the unit price when chosen."),
      priceFactor: number_("Multiplies the unit price. Applied before the delta."),
      costDelta: money(
        "Added to the unit cost when chosen, so margin is the margin on what is actually being sold. " +
          "Internal: no document renders it.",
      ),
      visibleWhen: string_(
        "A formula deciding whether this option is offered at all. Blank is always. Same variables as a " +
          "`validate` rule.",
      ),
      default: boolean_("Chosen when nothing else is."),
    }),
    OptionGroup: object("A set of choices on a product.", {
      key: string_("The group's key, unique across the product."),
      name: string_("What the group is called."),
      description: string_("What the choice is about."),
      select: enum_(["one", "many"], "`one` is a radio group, `many` a checkbox list."),
      required: boolean_("Whether a choice has to be made."),
      minSelect: integer_("`many` only: the fewest that may be chosen."),
      maxSelect: integer_("`many` only: the most."),
      visibleWhen: string_(
        "A formula over `quantity`, `term`, `selectedCount` and `option.<key>` deciding whether the group is " +
          "asked at all. Blank is always. A hidden group is not required, its selections are dropped rather " +
          "than priced, and nothing inside it can trigger a configuration rule.",
      ),
      options: array(ref("ProductOption")),
    }),
    ProductRule: object("A configuration rule: what a selection must, must not, or ought to include.", {
      kind: enum_(PRODUCT_RULE_KINDS, "`validate` runs a formula; the rest name option keys."),
      when: array(string_("An option key that arms the rule. Every one of them has to be selected.")),
      then: array(string_("An option key the rule requires, excludes or recommends.")),
      expression: string_("`validate` only: a formula over the option keys."),
      message: string_("What the configurator says when it fires."),
    }),
    BundleComponent: object("A product this one pulls onto the quote with it.", {
      sku: string_("The component's SKU."),
      quantity: number_("How many per parent unit."),
      required: boolean_("Whether it has to stay on the quote."),
      discountPercent: percent("A discount the bundle grants on this component."),
    }),
    VolumeTier: object("A price break at a quantity. Bands are not cumulative — the one a quantity falls into sets the whole line's price.", {
      minQuantity: number_("The quantity this tier starts at, inclusive."),
      maxQuantity: number_("The quantity it ends at, inclusive. `null` is “and above”.", { nullable: true }),
      kind: enum_(TIER_KINDS, "Percent off, amount off, or an outright override."),
      value: number_("The percentage, amount or price."),
    }),
    ProductInput: object(
      "A product.",
      {
        sku: string_("The catalogue key — letters, digits, dot, dash, underscore. Upper-cased."),
        name: string_("What it is called."),
        description: string_("Catalogue copy."),
        family: string_('Free grouping — "Framing", "Roofing". Pricing rules can target it.'),
        costType: enum_(
          COST_TYPES,
          "How a job cost report adds it up. A real column, because the materials list filters on it.",
        ),
        division: enum_(
          CSI_DIVISIONS.map(division => division.code),
          "CSI MasterFormat division, two digits. Empty is unclassified.",
        ),
        manufacturer: string_("Who makes it. A real column: the materials list filters on it."),
        chargeType: enum_(CHARGE_TYPES, "*When* it is billed. Equipment rented by the month is `recurring`."),
        billingPeriod: enum_(BILLING_PERIODS, "Recurring items only."),
        unitOfMeasure: enum_(
          UNITS_OF_MEASURE,
          "A closed list, not free text: a catalogue that cannot tell `SF` from `sq ft` will multiply a " +
            "price per square foot by a quantity in sheets.",
        ),
        listPrice: money("The catalogue price. A price book overrides it per customer."),
        cost: money("What one unit costs to deliver. Drives margin, and is never shown to a buyer."),
        currency: currency(),
        active: boolean_("Whether it can be quoted."),
        minQuantity: integer_("Smallest quantity a line may carry."),
        maxQuantity: integer_("Largest. `0` is unbounded."),
        quantityIncrement: integer_(
          "The pack size: a quantity has to be a multiple of it. `0` and `1` both mean any number.",
        ),
        wasteFactorPercent: percent(
          "How much more than the take-off measured has to be bought. Applied *before* the purchase " +
            "multiple is rounded to, so one adjustment is never compounded into the other.",
        ),
        purchaseMultiple: number_(
          "The lot it is sold in — an order quantity is rounded **up** to a multiple of it, because a " +
            "supplier will not break a pallet. `0` and `1` both mean any quantity.",
        ),
        material: ref("MaterialSpec"),
        availableFrom: date_("The first day it may be quoted. Blank is “already”."),
        availableTo: date_("The last day it may be quoted. Blank is “indefinitely”. Quoting outside the window warns rather than refuses."),
        floorDiscountPercent: percent("The most a rep may discount this line before approval is needed."),
        optionGroups: array(ref("OptionGroup")),
        rules: array(ref("ProductRule")),
        components: array(ref("BundleComponent")),
        volumeTiers: array(ref("VolumeTier")),
        attributes: {
          type: "object",
          description: "Arbitrary catalogue metadata, rendered on documents as a spec table.",
          additionalProperties: { type: "string" },
        },
      },
      ["sku", "name"],
    ),
    MaterialSpec: object(
      "What a catalogue item physically is. Every field is a thing somebody orders or submits against.",
      {
        division: string_("CSI MasterFormat division code, two digits. Empty is unclassified."),
        manufacturer: string_("Who makes it."),
        manufacturerPartNumber: string_("The manufacturer's own part number — what a submittal is checked against."),
        supplier: string_("Who you buy it from. Free text: a material has more than one source."),
        supplierSku: string_("The supplier's code for it, which is rarely your SKU."),
        nominalSize: string_('"2x4", "5/8 in", "R-21" — how the trade names the size.'),
        actualSize: string_('"1.5 in x 3.5 in x 96 in" — what a tape measure says.'),
        grade: string_('Species, alloy, mix, grade: "Douglas Fir #2", "4000 PSI", "Type X".'),
        finish: string_("Finish or colour, where it is an ordering distinction rather than a taste."),
        weightPerUnit: number_("Pounds per stocking unit. `0` is unrecorded. Freight and crane picks read it."),
        coverage: number_(
          "How much of `coverageUnit` one stocking unit covers — a bundle of shingles covering 33.3 SF. " +
            "`0` means it does not cover anything, which is most of them. This is the only thing that " +
            "turns square feet into bundles, and it is a property of the item, not of the units.",
        ),
        coverageUnit: enum_(UNITS_OF_MEASURE, "What `coverage` is measured in. Empty when there is none."),
        leadTimeDays: integer_('Working days from order to site. `0` is unrecorded, not "immediate".'),
        submittalRequired: boolean_("Whether it needs a submittal before it may be installed."),
      },
    ),
    Product: {
      allOf: [
        object("Stored fields.", {
          id: id("The product's id."),
          provenance: ref("CatalogProvenance"),
          ...ownership,
        }),
        ref("ProductInput"),
      ],
      description:
        "A catalogue item, with its specification, options, configuration rules, bundle components and " +
        "volume tiers.",
    },
    CatalogProvenance: object(
      "Which feed last wrote to this item. Absent on anything hand-priced.",
      {
        sourceId: id("The feed."),
        sourceName: string_("Its name when the write happened."),
        sourceKey: string_("The key the feed identified it by, which is rarely the local SKU."),
        syncedAt: timestamp("When."),
        fields: array(string_("The fields that feed set.")),
      },
    ),

    PriceBookEntry: object("One product's price in one book.", {
      sku: string_("The product's SKU, not its id: a book survives a catalogue re-import."),
      unitPrice: money("The price in this book."),
      minPrice: money("A hard floor — no discount, tier or rule may go below it. `null` for none."),
      active: boolean_("Whether the entry applies."),
    }),
    PriceBookInput: object(
      "A price book.",
      {
        name: string_("What it is called."),
        description: string_("What it is for."),
        currency: currency(),
        isDefault: boolean_("The book a new quote starts on when the customer names none."),
        active: boolean_("Whether it can be quoted from."),
        validFrom: date_("Empty means no bound."),
        validTo: date_("Empty means no bound. A quote outside the window is warned about."),
        entries: array(ref("PriceBookEntry")),
      },
      ["name"],
    ),
    PriceBook: {
      allOf: [object("Stored fields.", { id: id("The book's id."), ...ownership }), ref("PriceBookInput")],
      description: "A price book: one price, and optionally one floor, per SKU.",
    },

    CatalogTemplate: object("A file to start a catalogue from.", {
      file: string_("The file name it downloads as."),
      title: string_("What it is, in a few words."),
      description: string_("What it is for and how to use it."),
      contentType: string_("Its media type."),
      url: string_("Where to download it."),
    }),
    CatalogImportReport: object("What a catalogue import did.", {
      created: { type: "object", description: "How many of each kind were created.", additionalProperties: { type: "integer" } },
      skipped: array(string_("Something already here, named.")),
      warnings: array(string_("Something worth knowing that did not stop the import.")),
    }),

    /* ------------------------------ projects ------------------------------ */
    ProjectInput: object(
      "A job, as a caller writes it. Nothing about its money is here except the contract sum.",
      {
        number: string_('"PRJ-2026-0007". Leave empty to have one minted; ignored on a replace.'),
        name: string_("What the job is called."),
        accountId: id("The client. Empty for speculative work not yet attached to one."),
        accountName: string_("Their name, snapshotted so the list reads without a join."),
        status: enum_(PROJECT_STATUSES, "`complete` is handover, not final payment."),
        contractType: enum_(CONTRACT_TYPES, "How the job was bought — which decides what an estimate *is*."),
        projectType: string_('"Multifamily", "Tenant improvement". Free text.'),
        description: string_("Scope, in prose."),
        siteAddress: ref("Address"),
        startDate: date_("Empty means not set, not today."),
        targetCompletionDate: date_("May not fall before `startDate`."),
        actualCompletionDate: date_("When it was handed over."),
        projectManager: string_("By email, so the directory picker can name them.", { format: "email" }),
        superintendent: string_("By email.", { format: "email" }),
        permitNumber: string_("The building department's number. Printed on nearly everything."),
        clientReference: string_("The client's own job or contract reference."),
        currency: currency(),
        contractValue: money(
          "The awarded contract sum. Entered rather than derived: it is negotiated after the estimate " +
            "is accepted more often than not. `ProjectStats.acceptedEstimateValue` sits beside it.",
        ),
        tags: array(string_("Lowercased.")),
        notes: string_("Internal."),
      },
      ["name"],
    ),
    Project: {
      allOf: [object("Stored fields.", { id: id("The project's id."), ...ownership }), ref("ProjectInput")],
      description: "A job — the record every estimate and invoice hangs off.",
    },
    ProjectStats: object(
      "The job roll-up. Every figure is a function of the estimates and invoices, worked out on read, " +
        "and summed only in the project's own currency.",
      {
        currency: currency(),
        estimateCount: integer_("Every estimate on the job."),
        openEstimateCount: integer_("Estimates nobody has said yes or no to yet."),
        openEstimateValue: money("Their grand total."),
        acceptedEstimateCount: integer_("Estimates the client accepted."),
        acceptedEstimateValue: money("Their grand total — the number to read against `contractValue`."),
        invoiceCount: integer_("Every invoice on the job."),
        invoicedValue: money("Issued invoices' totals. Drafts are not owed and voids never were."),
        paidValue: money("What has come in."),
        outstandingValue: money("What is still owed. Negative when the client overpaid."),
        overdueValue: money("The part of that past its due date."),
        backlogValue: money("Accepted work not yet invoiced. Clamped at zero — the only clamp here."),
        otherCurrencyCount: integer_("Documents in another currency: counted, never added up."),
      },
    ),
    ProjectSummary: object("One job's whole position.", {
      project: ref("Project"),
      estimates: array(ref("QuoteSummary")),
      invoices: array(ref("InvoiceSummary")),
      stats: ref("ProjectStats"),
    }),

    /* --------------------------- supplier feeds ---------------------------- */
    SourceMapping: object(
      "Which feed column supplies which field. Every value is a header from the feed itself; empty " +
        "means the feed does not carry it. Nothing is guessed at sync time.",
      {
        key: string_("The column holding the code rows are matched on. Required."),
        matchOn: enum_(MATCH_KEYS, "What that key is compared against. Almost always `supplierSku`."),
        ...Object.fromEntries(
          [
            "sku",
            ...SYNC_FIELDS.filter(field => field !== "cost" && field !== "price" && field !== "active"),
            "cost",
            "price",
            "active",
          ].map(field => [field, string_(`The column for \`${field}\`.`)]),
        ),
      },
      ["key"],
    ),
    SyncPolicy: object("What a sync may do once it has read the feed.", {
      fields: array(
        enum_(
          SYNC_FIELDS,
          "The only fields this feed may write. `cost` and `price` are separate: a supplier quotes " +
            "your cost, and the sell price is not theirs to set unless you say so.",
        ),
      ),
      createMissing: boolean_("Whether unmatched rows are added to the catalogue."),
      deactivateMissing: boolean_(
        "Whether items the feed has dropped are switched off. Never deleted: they are on signed estimates.",
      ),
      maxPriceChangePercent: number_(
        "A cost or price move larger than this is flagged, not applied. `0` disables the guard.",
        { minimum: 0 },
      ),
      markupPercent: number_("Applied to a synced cost to set the price, when `price` is synced with no column.", {
        minimum: 0,
      }),
      defaultFamily: string_("What a created item is filed under when the feed does not say."),
      defaultCostType: enum_(COST_TYPES, "The cost type a created item gets."),
      currency: currency(),
    }),
    SyncRunSummary: object("What one run did, kept on the feed.", {
      ranAt: timestamp("When it finished."),
      byEmail: string_("Who ran it."),
      applied: boolean_("False for a preview."),
      rowsRead: integer_("Rows in the feed."),
      created: integer_("Items added."),
      updated: integer_("Items changed."),
      unchanged: integer_("Rows that matched and changed nothing."),
      flagged: integer_("Rows held for review."),
      deactivated: integer_("Items switched off."),
      skipped: integer_("Rows that could not be used."),
      error: string_("One sentence, when the run could not complete at all."),
    }),
    CatalogSourceInput: object(
      "A supplier feed: where it comes from, how its columns map, and what it may change.",
      {
        name: string_("What it is called."),
        description: string_("Notes for whoever reviews it."),
        format: enum_(SOURCE_FORMATS, "How the payload is shaped."),
        url: string_("http or https. Empty for a feed run by upload.", { format: "uri" }),
        recordPath: string_('JSON only: the dotted path to the array of records — "data.items". Empty is the root.'),
        mapping: ref("SourceMapping"),
        policy: ref("SyncPolicy"),
        active: boolean_("A switched-off feed can be previewed but not synced."),
      },
      ["name", "mapping"],
    ),
    CatalogSource: {
      allOf: [
        object("Stored fields.", {
          id: id("The feed's id."),
          lastRun: { ...ref("SyncRunSummary"), nullable: true },
          ...ownership,
        }),
        ref("CatalogSourceInput"),
      ],
      description: "A supplier feed, with what its last run did.",
    },
    FeedUpload: object("A payload posted in place of fetching the feed's URL.", {
      body: string_("The file's text — CSV or JSON, as the feed's `format` says."),
    }),
    SyncInput: object("What to sync from, and which flagged rows to let through.", {
      body: string_("The file's text. Omit it to fetch the feed's URL."),
      accept: array(string_("The feed key of a flagged row a person has decided to apply.")),
    }),
    FeedInspection: object("What a feed carries.", {
      columns: array(string_("A column name, as the feed spells it.")),
      rowCount: integer_("How many rows it has."),
      sample: array({ type: "object", additionalProperties: { type: "string" } }),
    }),
    FieldChange: object("One field a row would change.", {
      field: enum_(SYNC_FIELDS, "Which."),
      label: string_("Its name on screen."),
      from: string_("What it is now."),
      to: string_("What it would be."),
      changePercent: number_("Set on a cost or price move: how far, as a percentage."),
    }),
    SyncChange: object("What the plan would do with one row.", {
      action: enum_(SYNC_ACTIONS, "`flagged` waits for a person; `skip` says why in `notes`."),
      key: string_("The feed's own key for the row — what `accept` names."),
      productId: string_("The item it matched.", { nullable: true }),
      sku: string_("That item's SKU, or the one it would be created with."),
      name: string_("Its name."),
      changes: array(ref("FieldChange")),
      notes: array(string_("Why it was flagged or skipped, in a sentence a person can act on.")),
    }),
    SyncPlan: object("A reviewable plan, decided before anything is written.", {
      sourceId: id("The feed."),
      sourceName: string_("Its name."),
      rowsRead: integer_("Rows in the feed."),
      changes: array(ref("SyncChange")),
      counts: object(
        "How many rows landed in each action.",
        Object.fromEntries(SYNC_ACTIONS.map(action => [action, integer_(`Rows planned as \`${action}\`.`)])),
      ),
      warnings: array(string_("A problem with the feed as a whole rather than with one row.")),
    }),
    SyncResult: object("A plan, and what came of it.", {
      plan: ref("SyncPlan"),
      applied: boolean_("False for a preview — nothing was written."),
      failures: array(
        object("An item that could not be saved. Never fatal to the run.", {
          sku: string_("Which."),
          error: string_("Why."),
        }),
      ),
      summary: ref("SyncRunSummary"),
    }),

    /* -------------------------------- rules ------------------------------- */
    PricingRuleInput: object(
      "A pricing rule: what to change, when, and by how much.",
      {
        name: string_("What it is called."),
        description: string_("What it is for."),
        scope: enum_(["line", "quote"], "What it sees and what it can change."),
        condition: string_("A formula that must be non-zero for it to fire. Empty means always."),
        target: enum_(PRICING_RULE_TARGETS, "What it sets. A quote-scoped rule cannot set a unit price."),
        expression: string_("The formula producing the new value."),
        appliesToFamily: string_("Line scope only: limit it to one family. Empty is any."),
        appliesToSku: string_("Line scope only: limit it to one SKU. Empty is any."),
        priority: integer_("Lowest first. Each rule sees what the previous ones produced."),
        active: boolean_("Whether it runs."),
        message: string_("Shown on the line it changed, so a surprising price explains itself."),
      },
      ["name", "expression"],
    ),
    PricingRule: {
      allOf: [
        object("Stored fields.", {
          id: id("The rule's id."),
          ownerId: id("The account that owns it."),
          createdAt: timestamp("When it was created."),
          updatedAt: timestamp("When it last changed."),
        }),
        ref("PricingRuleInput"),
      ],
      description: "A pricing rule. The formula language is in `src/lib/formula.ts` — parsed, never `eval`ed.",
    },

    ApprovalRuleInput: object(
      "An approval rule: what trips it, and who is asked.",
      {
        name: string_("What it is called."),
        scope: enum_(["line", "quote"], "`quote` weighs the whole document; `line` fires on any single line."),
        metric: enum_(APPROVAL_METRICS, "What is measured. `custom` runs the condition formula instead."),
        comparator: enum_(COMPARATORS, "How the metric is compared to the threshold."),
        threshold: number_("The number it is compared against."),
        condition: string_("`custom` only: a formula that trips the rule when non-zero."),
        level: integer_("Ascending. A quote needs every level at or below the highest it trips.", {
          minimum: 1,
          maximum: 20,
        }),
        approvers: array(string_("An approver's email.", { format: "email" })),
        approvalsRequired: integer_("How many must approve. 1 is a rota; all of them is a board.", { minimum: 1 }),
        rejectionsRequired: integer_("How many must reject before it comes back. Usually smaller.", { minimum: 1 }),
        message: string_("What the submitter is told."),
        active: boolean_("Whether it runs."),
      },
      ["name", "approvers"],
    ),
    ApprovalRule: {
      allOf: [
        object("Stored fields.", {
          id: id("The rule's id."),
          ownerId: id("The account that owns it."),
          createdAt: timestamp("When it was created."),
          updatedAt: timestamp("When it last changed."),
        }),
        ref("ApprovalRuleInput"),
      ],
      description: `An approval rule. At most ${MAX_APPROVERS} approvers, since one who cannot be stamped onto the quote cannot see it.`,
    },

    ApprovalDecision: object("One person's answer on one request.", {
      approverEmail: string_("Who answered.", { format: "email" }),
      decision: enum_(["approved", "rejected"], "What they said."),
      decidedAt: timestamp("When."),
      comment: string_("What they said about it."),
    }),
    ApprovalRequest: object(
      "One approval a quote is waiting on, or has already had. Its `status` is derived from the " +
        "decisions it carries against its two quorums — never assigned.",
      {
        id: id("The request's id."),
        ruleId: id("The rule that raised it."),
        ruleName: string_("That rule's name, snapshotted."),
        level: integer_("Which rung of the ladder."),
        approverEmails: array(string_("Everyone it is addressed to.", { format: "email" })),
        approvalsRequired: integer_("How many yeses it needs."),
        rejectionsRequired: integer_("How many noes send it back."),
        reason: string_('Why it triggered, in numbers: "Discount 32.0% > 25%".'),
        status: enum_(["pending", "approved", "rejected"], "Derived from the decisions below."),
        lineId: string_("The line it fired on, for a line-scoped rule.", { nullable: true }),
        decisions: array(ref("ApprovalDecision")),
        requestedAt: timestamp("When it was raised."),
      },
    ),

    FormulaInput: object(
      "A formula to check.",
      {
        expression: string_("The formula."),
        scope: enum_(["line", "quote", "product"], "Which set of variables it will see."),
        optionKeys: array(string_("`product` scope: the option keys the formula may name.")),
      },
      ["expression"],
    ),
    FormulaCheck: {
      description:
        "Whether a formula parses, and what it may name. `available` is on both shapes, because " +
        `the list of variables is the useful part either way. The functions are ${FUNCTION_NAMES.join(", ")}.`,
      oneOf: [
        object("It parsed.", {
          valid: { type: "boolean", enum: [true] },
          references: array(string_("Every variable the formula actually names.")),
          available: array(string_("Every variable this scope offers.")),
        }),
        object("It did not.", {
          valid: { type: "boolean", enum: [false] },
          error: string_("What is wrong with it, in a sentence."),
          available: array(string_("Every variable this scope offers.")),
        }),
      ],
    },

    /* -------------------------------- quotes ------------------------------- */
    CustomerSnapshot: customerSnapshot,
    QuoteLineInput: quoteLineInput,
    QuoteTotals: quoteTotals,
    AppliedRule: object("What a rule did to one line or quote, kept so the UI can show its work.", {
      ruleId: id("The rule."),
      ruleName: string_("Its name."),
      target: string_("What it changed."),
      before: number_("The value before."),
      after: number_("The value after."),
      message: string_("What the rule says about itself."),
    }),
    PricedLine: {
      allOf: [
        ref("QuoteLineInput"),
        object("Everything the pricing engine worked out, plus the catalogue as it was.", {
          sku: string_("The product's SKU, snapshotted."),
          name: string_("Its name, snapshotted."),
          family: string_("Its family."),
          chargeType: enum_(CHARGE_TYPES, "How it bills."),
          billingPeriod: enum_(BILLING_PERIODS, "Recurring lines only."),
          unitOfMeasure: string_("What a unit is."),
          optionNames: array(string_("The chosen options, by label.")),
          listUnitPrice: money("Before anything was applied."),
          unitPrice: money("After options, tiers, overrides and rules."),
          lineTotal: money("What this line comes to."),
          unitCost: money("Cost per unit. Never shown to a buyer."),
          margin: money("This line's margin."),
          appliedRules: array(ref("AppliedRule")),
          issues: array(string_("Something that stops the quote.")),
          warnings: array(string_("Something worth knowing.")),
        }),
      ],
      description:
        "A line with its price worked out. Every intermediate number is kept, because the question " +
        "a CPQ is always asked is why it is that price.",
    },
    QuoteInput: object(
      "A quote, as a caller writes it. Totals are ignored: the server prices it.",
      {
        name: string_("What the quote is called."),
        accountId: string_("The customer. `null` for a quote addressed to nobody yet.", { nullable: true }),
        projectId: id("The job it is for. Empty for a bid with no job yet."),
        priceBookId: string_("Which book to price from. Empty uses the default."),
        currency: currency(),
        termMonths: integer_("Default subscription length for recurring lines that name none."),
        discountPercent: percent("A discount on the whole quote, applied after line discounts."),
        taxPercent: percent("The rate."),
        shipping: money("Shipping."),
        validUntil: date_("Past it, the quote reads as expired without being rewritten."),
        notes: string_("Shown to the customer."),
        internalNotes: string_("Not shown to the customer."),
        lines: array(ref("QuoteLineInput")),
      },
      ["name"],
    ),
    Quote: object("A quote, priced.", { ...quoteHeader, lines: array(ref("PricedLine")), approvals: array(ref("ApprovalRequest")) }),
    QuoteSummary: object(
      "A quote without its lines or its approval requests — what the list endpoints return. Every " +
        "other field is the quote's own.",
      { ...quoteHeader, lineCount: integer_("How many lines it has."), pendingApprovals: integer_("How many approvals it is still waiting on.") },
    ),
    QuotePage: object(
      "One page of a quote search.",
      {
        items: array(ref("QuoteSummary")),
        page: integer_("This page, from 1."),
        perPage: integer_("The page size."),
        total: integer_("How many match the search and the status, across every page."),
        counts: {
          type: "object",
          description: "How many match the search alone, per status. A status with none is left out.",
          additionalProperties: { type: "integer" },
        },
      },
      ["items", "page", "perPage", "total", "counts"],
    ),
    SavedQuote: object("A stored quote, with whatever the engine wants to say about it.", {
      quote: ref("Quote"),
      issues: array(string_("Something that stops it.")),
      warnings: array(string_("Something worth knowing.")),
    }),
    QuotePreview: object("What a quote would come to, with nothing stored.", {
      lines: array(ref("PricedLine")),
      totals: ref("QuoteTotals"),
      priceBookId: id("The book it was priced from."),
      issues: array(string_("Something that would stop it.")),
      warnings: array(string_("Something worth knowing.")),
      approvalsRequired: array(ref("ApprovalRequest")),
      autoApproved: boolean_("True where it trips no rule at all."),
    }),
    SubmitResult: object("Where a quote stands after being submitted.", {
      quote: ref("Quote"),
      issues: array(string_("Something that stopped it.")),
      warnings: array(string_("Something worth knowing.")),
      required: array(ref("ApprovalRequest")),
      unresolved: array(string_("An approver address that matches no account here, so nobody can answer it.")),
    }),
    DecisionInput: object(
      "An approver's answer.",
      {
        decision: enum_(["approved", "rejected"], "Yes or no."),
        comment: string_("Why. Shown to the submitter."),
      },
      ["decision"],
    ),
    StatusInput: object("A lifecycle move.", { status: enum_(QUOTE_STATUSES, "Where to move it.") }, ["status"]),

    ConfigureInput: object("A selection to check against a product's option groups and rules.", {
      selectedOptions: array(string_("An option key.")),
      quantity: number_("How many, for the quantity bounds and the tiers."),
      termMonths: integer_("The term, for anything that depends on it."),
    }),
    ConfigureResult: object("What the configurator makes of a selection.", {
      valid: boolean_("Whether it can be quoted."),
      selected: array(string_("The keys after defaults and rules were applied.")),
      optionNames: array(string_("Those options, by label.")),
      unitDelta: money("What the selection adds to the unit price."),
      unitFactor: number_("What it multiplies the unit price by."),
      unitCostDelta: money("What it adds to the unit cost. Internal — no document renders it."),
      visibleGroups: array(string_("The groups this configuration is offered, by key, in catalogue order.")),
      visibleOptions: array(string_("The options it is offered, by key. Everything else is hidden by a `visibleWhen`.")),
      errors: array(string_("A rule it breaks.")),
      warnings: array(string_("A recommendation it trips.")),
      defaults: array(string_("Options chosen for you because nothing else was.")),
    }),

    /* ----------------------------- receivables ----------------------------- */
    InvoiceLine: invoiceLine,
    InvoiceTotals: object(
      "An invoice's totals. `lineTotals` — currency through total — is a pure function of the " +
        "invoice's own lines and is stored with it. The settlement below it is a function of two " +
        "other collections, and is recomputed on every read.",
      {
        currency: currency(),
        lineCount: integer_("How many lines."),
        subtotal: money("Every line, before tax."),
        taxAmount: money("Tax."),
        total: money("What was demanded."),
        paidAmount: money("Cash received, summed from the `payments` collection at read time."),
        creditedAmount: money("Credited or written off, summed from `credits` at read time."),
        balance: money(
          "`total − paid − credited`, and **allowed to be negative**: an overpaid invoice owes " +
            "money back, and clamping it at zero loses a customer's money.",
        ),
      },
    ),
    PaymentInput: object(
      "Cash received.",
      {
        amount: money("Greater than zero. A negative payment is a refund — a different event."),
        receivedOn: date_("The day the money arrived, not the day it was keyed in. Defaults to today."),
        method: enum_(PAYMENT_METHODS, "Reporting only — none of it changes the arithmetic."),
        reference: string_("Bank reference, cheque number, processor id."),
        note: string_("Anything else."),
      },
      ["amount"],
    ),
    InvoicePayment: {
      allOf: [
        object("Stored fields.", {
          id: id("The payment's id."),
          invoiceId: id("The invoice it settles. A payment belongs to exactly one."),
          ownerId: id("Who recorded it."),
          createdAt: timestamp("When it was keyed in."),
          updatedAt: timestamp("When it last changed."),
        }),
        ref("PaymentInput"),
      ],
      description:
        `A payment: its own record, so two people banking cash at once cannot lose one. An invoice ` +
        `carries at most ${MAX_LEDGER_ENTRIES} ledger rows of each kind.`,
    },
    CreditInput: object(
      "An amount forgiven, corrected or written off. No cash moved.",
      {
        amount: money("Greater than zero, and never more than is left owing."),
        issuedOn: date_("When it was issued. Defaults to today."),
        reason: enum_(
          CREDIT_REASONS,
          "`write_off` is the admission that the money is not coming, which is deliberately not " +
            "the same thing as an `adjustment` correcting an invoice raised wrongly.",
        ),
        note: string_("Why."),
      },
      ["amount"],
    ),
    InvoiceCredit: {
      allOf: [
        object("Stored fields.", {
          id: id("The credit's id."),
          invoiceId: id("The invoice it reduces."),
          ownerId: id("Who recorded it."),
          createdAt: timestamp("When it was keyed in."),
          updatedAt: timestamp("When it last changed."),
        }),
        ref("CreditInput"),
      ],
      description: "A credit or write-off.",
    },
    InvoiceInput: object(
      `An invoice header and its lines — at most ${MAX_INVOICE_LINES}. Totals and balances in the ` +
        "body are ignored: the server totals it.",
      {
        accountId: string_("The customer.", { nullable: true }),
        quoteId: string_("The quote it was raised from, if any.", { nullable: true }),
        projectId: id("The job it bills against. Has to be one you can see."),
        currency: currency(),
        issueDate: date_("Only meaningful once it is issued."),
        paymentTermDays: integer_("Snapshotted from the customer; the due date is the issue date plus this."),
        poNumber: string_("The customer's purchase order reference. Many will not pay without it."),
        notes: string_("Printed on the invoice."),
        internalNotes: string_("The collections note. Never shown to the customer."),
        lines: array(ref("InvoiceLine")),
      },
      ["accountId"],
    ),
    Invoice: object(
      "An invoice. Note what is **not** here: no `status` and no stored balance. `state` is the " +
        "only part a person sets, and the conditions it derives into — " +
        `${INVOICE_STATUSES.join(", ")} — are worked out from the ledger and the date by whoever ` +
        "is holding it, because a stored 'overdue' is wrong the morning after it is written. " +
        "`totals.balance` is recomputed on every read for the same reason, and the CSV export and " +
        "`{{invoice.status}}` each derive it as they go.",
      {
        ...invoiceHeader,
        lines: array(ref("InvoiceLine")),
        payments: array(ref("InvoicePayment")),
        credits: array(ref("InvoiceCredit")),
      },
    ),
    InvoiceSummary: object(
      "An invoice without its lines or its ledger rows — what the list endpoints return. Its " +
        "`totals` are still whole, balance included: a list reads every payment and credit in two " +
        "queries for the whole page, because a list of invoices with no balances on it is not " +
        "worth returning.",
      {
        ...invoiceHeader,
        lineCount: integer_("How many lines."),
        paymentCount: integer_("How many payments have been recorded."),
        creditCount: integer_("How many credits."),
      },
    ),
    SavedInvoice: object("A stored invoice, with whatever the server wants to say about it.", {
      invoice: ref("Invoice"),
      warnings: array(string_("Something worth knowing — a total a penny off the quote's, say.")),
    }),
    IssueInput: object("When an invoice was issued.", {
      issueDate: date_("Defaults to today."),
    }),
    AgingReport: object(
      "Receivables by age. Buckets the **balance**, not the total — a 10,000 invoice with 9,000 " +
        "paid is 1,000 of exposure — and never adds two currencies.",
      {
        currency: currency(),
        asOf: date_("The date everything was aged against, so a stale report says it is stale."),
        buckets: {
          type: "object",
          description: `One entry per bucket: ${AGING_BUCKETS.join(", ")}.`,
          additionalProperties: object("What sits in that bucket.", {
            amount: money("Outstanding balance."),
            count: integer_("How many invoices."),
          }),
        },
        outstanding: money("Every balance still owed: the five buckets added up."),
        overdue: money("The part of it that is late — everything but `current`."),
        invoiceCount: integer_("Invoices with a balance, in this currency."),
        draftCount: integer_("Raised but not issued. Not a receivable yet, which is the point of saying so."),
        draftAmount: money("What those drafts come to."),
        paidAmount: money("Settled, in this currency — what collection actually achieved."),
        otherCurrencyCount: integer_("Invoices in some other currency: counted, never added up."),
        oldestDueDate: date_("The earliest due date still unpaid."),
        maxDaysOverdue: integer_("How far past it today is."),
      },
    ),

    /* ------------------------------ documents ------------------------------ */
    ProposalTemplateInput: object(
      "A template. One collection holds both kinds, because a template is a template — same " +
        "editor, same letterhead, same block language, and only the meaning of a token differs.",
      {
        name: string_("What it is called.", { maxLength: MAX_TEMPLATE_NAME_LENGTH }),
        kind: enum_(TEMPLATE_KINDS, "Which record it renders. A template written before invoices is a quote's."),
        format: enum_(PROPOSAL_FORMATS, "`pdf` bodies are a JSON document description; the rest are prose."),
        body: string_(
          `The template. Text formats may be ${MAX_TEMPLATE_BODY_LENGTH.toLocaleString()} characters; ` +
            `a \`pdf\` body may be ${MAX_PDF_TEMPLATE_BODY_LENGTH.toLocaleString()}, because the ` +
            "branding images are inside it as `data:` URLs.\n\n" +
            "A `pdf` body is JSON: `page` (paper, margins, face, colours), `style` (leading, the " +
            "heading scale and face, rule colour, and the line-item table's fill, zebra, grid, " +
            "padding and row lines), `header` (the letterhead), `watermark` (a token-resolving " +
            "stamp under every page), `blocks` (the flow) and `footer`. Everything but `blocks` is " +
            "optional and is filled in with defaults on the way in, so the stored body is always " +
            "the whole document — send `{\"blocks\": [...]}` and read back the rest.",
        ),
      },
      ["name"],
    ),
    ProposalTemplate: {
      allOf: [object("Stored fields.", { id: id("The template's id."), ...ownership }), ref("ProposalTemplateInput")],
      description: "A quote or invoice template.",
    },
    RenderedDocument: object("A template rendered, for the preview dialog. `&inline` asks for this.", {
      text: string_("The document."),
      format: enum_(["html", "markdown", "text"], "Which format it came out as."),
      templateId: id("The template used."),
      templateName: string_("Its name."),
      unknownTokens: array(string_("A `{{token}}` the vocabulary has no value for — rendered as a blank.")),
    }),

    /* ------------------------------- sharing ------------------------------- */
    Shares: object("Who can see one record.", {
      owner: id("The account that owns it."),
      sharedWith: array(string_("An account's email.", { format: "email" })),
      canShare: boolean_("Whether you may change this list — the owner may, nobody else."),
    }),
    ShareInput: object("Who to share with.", { email: string_("Their address.", { format: "email" }) }, ["email"]),

    /* ------------------------------ workspace ------------------------------ */
    SeedReport: object("What installing the sample did.", {
      created: {
        type: "object",
        description: "How many of each kind were created.",
        additionalProperties: { type: "integer" },
      },
      skipped: {
        type: "object",
        description: "How many were already there under the same SKU or name.",
        additionalProperties: { type: "integer" },
      },
      quoteId: string_("The sample quote, if one was created.", { nullable: true }),
      notes: array(string_("Anything worth saying about it.")),
    }),
  };
}

/* -------------------------------- assembly -------------------------------- */

const TAGS: Json[] = [
  { name: "Discovery", description: "What this server is, what it knows, and whether it and its database are up." },
  { name: "Auth", description: "Register, sign in, sign out, change a password." },
  { name: "API keys", description: "Long-lived credentials for scripts. Managing them needs a session." },
  {
    name: "Telegram",
    description: "A message when a supplier feed syncs, or cannot. The bot token stays in PocketBase.",
  },
  { name: "Preferences", description: "Per-account defaults, stored on the account rather than the browser." },
  { name: "Customers", description: "Accounts, the people in them, and their quote and invoice history." },
  {
    name: "Projects",
    description:
      "The jobs. A project is what gets built, gets billed and gets argued about — and none of its money is stored.",
  },
  { name: "Catalogue", description: "Products with their options and bundles, price books, and the catalogue file." },
  {
    name: "Supplier feeds",
    description: "Where a feed comes from, what it may change, and the plan a sync proposes before it writes.",
  },
  { name: "Rules", description: "Pricing rules, the approval ladder, and the formula language behind both." },
  { name: "Quotes", description: "Writing, pricing, approving and revising a quote — and billing it." },
  { name: "Receivables", description: "Invoices, the payments and credits against them, and the aging report." },
  { name: "Documents", description: "Templates, and rendering a quote or an invoice through one." },
  { name: "Sharing", description: "Letting another account read a record you own." },
  { name: "Workspace", description: "The whole account as one file, and the worked example." },
  {
    name: "Website",
    description:
      "The public page visitors see before signing in: its words, its pictures, which goes where, and the contact form.",
  },
];

const DESCRIPTION = [
  "Construction estimating, project billing and a building-material catalogue.",
  "Every action the UI can take is an endpoint here.",
  "",
  "### Authentication",
  "",
  "Three credentials reach the same account, and every endpoint takes any of them:",
  "",
  `- \`${API_KEY_HEADER}: ${API_KEY_PREFIX}…\` — an API key, which is what a script should use.`,
  "  Issue one under Settings → API keys, or with `POST /api/keys`.",
  "- `Authorization: <token>` — a PocketBase user token, sent raw, with no `Bearer` prefix.",
  `- The \`${SESSION_COOKIE}\` cookie, which \`POST /api/auth/login\` sets (\`curl -c jar -b jar\`).`,
  "",
  "`GET /api`, `GET /api/health`, `GET /api/openapi.json`, the three sign-in routes and the public",
  "website (`GET /api/site`, its images, and the contact form) need no credential; everything else does. Issuing and revoking API keys needs a real session, so a",
  "leaked key cannot mint its own replacement.",
  "",
  "### Errors",
  "",
  'Every failure answers with `{ "error": string }` and an honest status: 400 for a bad request,',
  "401 for a missing or spent credential, 403 where a key is reaching for something only a session",
  "may do, 404 for a record that does not exist — or that exists and is not yours, which this API",
  "declines to tell apart — and 422 where the request was understood and the record's own state",
  "refuses it (editing an issued invoice, voiding one that has been paid).",
  "",
  "### What the server decides, not you",
  "",
  "**The server prices every quote and totals every invoice it stores.** Totals in a request body",
  "are ignored and overwritten. The pricing engine is pure and shared with the browser, so the",
  "number you see live is the number that gets stored.",
  "",
  "**An invoice's condition is never stored.** Only `state` (draft / issued / void) is recorded;",
  "open, part paid, paid and overdue are derived from the ledger and today's date on every read.",
  "So is the balance — which may go negative, because an overpaid invoice owes money back.",
  "",
  "### Access",
  "",
  "PocketBase's own collection rules decide what a credential reaches; this server holds none of",
  "its own. A record shared with you is readable and quotable but not editable, and an approver",
  "sees the quote a rule named them on and nothing else of that account's.",
].join("\n");

/** `{id}` is what OpenAPI writes; `:id` is what the route table and `GET /api` write. */
const toRouteSyntax = (path: string) => path.replace(/\{(\w+)\}/g, ":$1");

/**
 * The endpoint list `GET /api` prints, derived from the operations above.
 *
 * Keeping it here rather than in the route table is what stops the two from
 * disagreeing: there is one list, and every reader is given it.
 */
export function endpointIndex(): Record<string, string> {
  const index: Record<string, string> = {};
  for (const operation of OPERATIONS) {
    index[`${operation.method.toUpperCase().padEnd(6)} ${toRouteSyntax(operation.path)}`] = operation.summary;
  }
  return index;
}

/**
 * The document itself.
 *
 * `serverUrl` should be the origin the request arrived on, so a collection
 * imported from a running server points back at that server rather than at
 * whatever host this file happened to name.
 */
export function buildOpenApiDocument({ serverUrl }: { serverUrl?: string } = {}): OpenApiDocument {
  const paths: Record<string, Json> = {};

  for (const operation of OPERATIONS) {
    const { method, path, tag, operationId, summary, description, anonymous, parameters, requestBody } = operation;

    // Every guarded route can answer 401, and every route that reads a body or
    // a query parameter can answer 400 — said once here rather than on ninety
    // operations that would each have to remember. The operation's own list is
    // spread twice on purpose: the first fixes the order, so its 200 is listed
    // before the failures, and the second lets it override a default it
    // disagrees with — sign-in's 401 is not "no credential", it is the wrong one.
    const responses: Record<string, Json> = {
      ...operation.responses,
      "400": responseRef("BadRequest"),
      ...(anonymous ? {} : { "401": responseRef("Unauthorized") }),
      ...operation.responses,
    };

    (paths[path] ??= {})[method] = {
      tags: [tag],
      operationId,
      summary,
      ...(description ? { description } : {}),
      ...(anonymous ? { security: [] } : {}),
      ...(parameters?.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses,
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "Sitelines API",
      version: API_VERSION,
      description: DESCRIPTION,
    },
    servers: [{ url: serverUrl ?? FALLBACK_SERVER_URL, description: "This server" }],
    tags: TAGS,
    // Any one of the three is enough; a tool shows them as alternatives.
    security: [{ apiKey: [] }, { userToken: [] }, { sessionCookie: [] }],
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: API_KEY_HEADER,
          description: `A key from \`POST /api/keys\`, which begins \`${API_KEY_PREFIX}\`. At most ${MAX_KEYS} per account.`,
        },
        userToken: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "A PocketBase user token, sent raw — no `Bearer` prefix.",
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE,
          description: "Set by `POST /api/auth/login`. httpOnly, so only a browser sends it.",
        },
      },
      responses: {
        BadRequest: jsonResponse("The request could not be read, or was refused by name.", ref("Error")),
        Unauthorized: jsonResponse("No credential, or one that is no longer good.", ref("Error")),
        NotFound: jsonResponse("No such record — or one that is not yours to reach.", ref("Error")),
      },
      schemas: schemas(),
    },
  };
}

