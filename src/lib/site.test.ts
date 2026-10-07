import { describe, expect, test } from "bun:test";
import {
  SITE_SLOTS,
  pageImage,
  pageImages,
  pageText,
  pageTexts,
  paragraphs,
  phoneHref,
  resolvePage,
  siteImageSrcSet,
  siteImageThumb,
  type SiteContent,
  type SiteImage,
  type SitePlacement,
  type SiteText,
} from "./site";
import { readContactRequest, readSiteText, readSlotEntries } from "./validate";

const text = (id: string, title = id): SiteText => ({
  id,
  name: id,
  title,
  body: "",
  items: [],
  createdAt: "",
  updatedAt: "",
});

const image = (id: string): SiteImage => ({
  id,
  name: id,
  alt: "",
  url: `/api/site/images/${id}/${id}.jpg`,
  createdAt: "",
  updatedAt: "",
});

let n = 0;
const place = (slot: string, ref: { textId?: string; imageId?: string }, position = 0): SitePlacement => ({
  id: `scf_${n++}`,
  slot,
  textId: ref.textId ?? "",
  imageId: ref.imageId ?? "",
  position,
});

const content = (placements: SitePlacement[]): SiteContent => ({
  texts: [text("a"), text("b"), text("c")],
  images: [image("x"), image("y")],
  placements,
});

describe("assembling the page", () => {
  test("fills a list slot in position order, whatever order the rows came in", () => {
    const page = resolvePage(
      content([
        place("services.list", { textId: "c" }, 2),
        place("services.list", { textId: "a" }, 0),
        place("services.list", { textId: "b" }, 1),
      ]),
    );
    expect(pageTexts(page, "services.list").map(entry => entry.id)).toEqual(["a", "b", "c"]);
  });

  test("a single slot shows one thing, even if a half-finished save left two rows", () => {
    const page = resolvePage(content([place("hero.image", { imageId: "y" }, 1), place("hero.image", { imageId: "x" }, 0)]));
    expect(pageImages(page, "hero.image").map(entry => entry.id)).toEqual(["x"]);
    expect(pageImage(page, "hero.image")?.id).toBe("x");
  });

  test("drops what the page could never draw, rather than failing on it", () => {
    const page = resolvePage(
      content([
        place("hero.sidebar", { textId: "a" }), // no such slot
        place("hero.image", { textId: "a" }), // a text in an image slot
        place("hero.text", { textId: "gone" }), // deleted content
        place("hero.text", { textId: "b" }, 1),
      ]),
    );
    expect(pageImage(page, "hero.image")).toBeUndefined();
    expect(pageText(page, "hero.text")?.id).toBe("b");
    expect(Object.keys(page.texts)).toEqual(["hero.text"]);
  });

  test("the same content may sit in two slots", () => {
    const page = resolvePage(content([place("hero.image", { imageId: "x" }), place("about.image", { imageId: "x" })]));
    expect(pageImage(page, "hero.image")?.id).toBe("x");
    expect(pageImage(page, "about.image")?.id).toBe("x");
  });

  test("an empty slot is simply absent", () => {
    expect(pageTexts(resolvePage(content([])), "about.timeline")).toEqual([]);
  });
});

describe("the seeded layout", () => {
  /**
   * The migration is plain JS run by PocketBase, so it cannot import the slot
   * list. This reads it as text and checks it names nothing the page lacks.
   */
  const migration = require("node:fs").readFileSync(
    new URL("../../docker/pb_migrations/1750000012_website.js", import.meta.url),
    "utf8",
  ) as string;
  const layout = migration.slice(migration.indexOf("const LAYOUT"), migration.indexOf("];", migration.indexOf("const LAYOUT")));
  const seeded = [...layout.matchAll(/\["([a-z]+\.[a-z]+)", "(text|image)"/g)].map(match => ({ key: match[1]!, kind: match[2] }));

  test("fills every slot the page has, with the right kind", () => {
    expect(seeded.map(entry => entry.key).sort()).toEqual(SITE_SLOTS.map(slot => slot.key).sort());
    for (const entry of seeded) {
      expect(SITE_SLOTS.find(slot => slot.key === entry.key)?.kind, entry.key).toBe(entry.kind as "text" | "image");
    }
  });
});

describe("small helpers", () => {
  test("a printed phone number becomes a dialable link", () => {
    expect(phoneHref("513-616-9757")).toBe("tel:+15136169757");
    expect(phoneHref("+44 20 7946 0958")).toBe("tel:+442079460958");
    expect(phoneHref("call us")).toBe("");
  });

  test("paragraphs split on a blank line and nowhere else", () => {
    expect(paragraphs("one\nstill one\n\n two \n\n\n")).toEqual(["one\nstill one", "two"]);
  });

  test("thumbnails are offered only at the widths PocketBase keeps", () => {
    expect(siteImageThumb(960)).toBe("960x0");
    expect(siteImageThumb(961)).toBe("");
    expect(siteImageSrcSet("/i.jpg")).toBe("/i.jpg?thumb=480x0 480w, /i.jpg?thumb=960x0 960w, /i.jpg?thumb=1920x0 1920w");
  });
});

describe("what the editor and the form may send", () => {
  test("a text block finds itself a name rather than demanding one", () => {
    const read = readSiteText({ title: "Kitchens", body: "We do them.", items: "Cabinets\n\n Islands \n" });
    expect(read).toEqual({ ok: true, value: { name: "Kitchens", title: "Kitchens", body: "We do them.", items: ["Cabinets", "Islands"] } });
    expect(readSiteText({}).ok).toBe(false);
  });

  test("a slot takes ids of the right count, for a slot that exists", () => {
    expect(readSlotEntries("hero.image", { ids: ["sim_a"] }).ok).toBe(true);
    expect(readSlotEntries("hero.image", { ids: ["sim_a", "sim_b"] })).toMatchObject({ ok: false });
    expect(readSlotEntries("services.list", { ids: ["a", "b", "a"] })).toMatchObject({ ok: true, value: { ids: ["a", "b"] } });
    expect(readSlotEntries("hero.nope", { ids: [] })).toMatchObject({ ok: false });
    expect(readSlotEntries("hero.text", { ids: ['x" || 1=1'] })).toMatchObject({ ok: false });
    expect(readSlotEntries("hero.text", {})).toMatchObject({ ok: false });
  });

  test("the contact form needs a name, an address and a message", () => {
    const good = { firstName: " Ada ", lastName: "L", email: "ADA@Example.com", description: "A kitchen." };
    expect(readContactRequest(good)).toMatchObject({
      ok: true,
      value: { firstName: "Ada", email: "ada@example.com", phone: "", spam: false },
    });
    expect(readContactRequest({ ...good, email: "nope" })).toEqual({ ok: false, error: "Please enter a valid email address." });
    expect(readContactRequest({ ...good, description: " " }).ok).toBe(false);
  });

  test("a filled honeypot is marked, not refused — the bot must not learn", () => {
    const read = readContactRequest({ firstName: "a", lastName: "b", email: "a@b.co", description: "x", website: "http://spam" });
    expect(read).toMatchObject({ ok: true, value: { spam: true } });
  });
});
