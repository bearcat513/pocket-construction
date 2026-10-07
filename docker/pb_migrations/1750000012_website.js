/// <reference path="../pb_data/types.d.ts" />

/**
 * The public website: what a visitor who has not signed in sees.
 *
 * Four collections, because the content and the layout are different things:
 *
 * - `site_texts` — a block of words: a title, a body, and an optional list
 *   (one entry per line). A service, a timeline entry, a heading and its
 *   intro are all one of these.
 * - `site_images` — a picture and the sentence that describes it.
 * - `site_config` — *where* things go. One row puts one text or one image in
 *   one slot (`hero.image`, `services.list`, …) at a position, so swapping the
 *   hero photo or reordering the services is an edit to this table and never
 *   to the content itself. The slots are a closed list, `SITE_SLOTS` in
 *   src/lib/site.ts; a row naming one the page does not have is ignored.
 * - `contact_requests` — what the contact form sends.
 *
 * ## Who may change it
 *
 * The site is the instance's, not one account's, so none of these is in
 * `OWNED` and none has an `owner`. Reading the content is public — it *is*
 * the public page. Writing it takes `siteEditor` on the account, a flag added
 * to `users` here: the first account to register gets it (rules/site.js and
 * setup/adopt.js), the oldest existing account gets it below, and anyone else
 * is given it from the PocketBase dashboard. No account can set it on itself.
 *
 * Anyone may *create* a contact request — that is the form — but may not set
 * its `status`, and only an editor may read one back. A visitor's name, email
 * and phone number are not public content.
 *
 * ## The seed
 *
 * The content of the original Klein Remodeling site, so a fresh volume comes
 * up with a page rather than a blank. Images are read from `website/` beside
 * this file; one that cannot be read is skipped with a log line rather than
 * failing the migration — a missing photo is an empty slot, not a broken
 * database.
 */
migrate(
  app => {
    /* ------------------------------ editors ------------------------------ */

    const users = app.findCollectionByNameOrId("users");
    users.fields.add(new Field({ type: "bool", name: "siteEditor", required: false }));
    app.save(users);

    // An instance with accounts already has an operator: the first of them,
    // the same account setup/adopt.js hands the pre-accounts records to.
    app
      .db()
      .newQuery("UPDATE users SET siteEditor = 1 WHERE id = (SELECT id FROM users ORDER BY created ASC LIMIT 1)")
      .execute();

    const EDITOR = "@request.auth.siteEditor = true";

    /** App-supplied ids (`stx_…`, `sim_…`), matching every other collection. */
    const idField = () => ({
      type: "text",
      name: "id",
      system: true,
      primaryKey: true,
      required: true,
      min: 3,
      max: 40,
      pattern: "^[a-z0-9_]+$",
      autogeneratePattern: "[a-z0-9]{15}",
    });

    const stamps = () => [
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];

    /* ------------------------------ content ------------------------------ */

    const texts = new Collection({
      name: "site_texts",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: EDITOR,
      updateRule: EDITOR,
      deleteRule: EDITOR,
      fields: [
        idField(),
        // What the editor calls it. Never shown on the page.
        { type: "text", name: "name", required: true, max: 120 },
        { type: "text", name: "title", required: false, max: 300 },
        { type: "text", name: "body", required: false, max: 10000 },
        // One entry per line. Text rather than JSON so a backfill or a hook
        // never meets the JSVM's byte-array JSON (see CLAUDE.md).
        { type: "text", name: "items", required: false, max: 5000 },
        ...stamps(),
      ],
    });
    app.save(texts);

    const images = new Collection({
      name: "site_images",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: EDITOR,
      updateRule: EDITOR,
      deleteRule: EDITOR,
      fields: [
        idField(),
        { type: "text", name: "name", required: true, max: 120 },
        { type: "text", name: "alt", required: false, max: 500 },
        {
          type: "file",
          name: "file",
          required: true,
          maxSelect: 1,
          maxSize: 10 * 1024 * 1024,
          // No SVG: it is served from this site's own origin, and an SVG is a
          // document that can carry script.
          mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
          // The widths the page asks for in a srcset. PocketBase only makes
          // thumbnails it is told about; SITE_IMAGE_WIDTHS in src/lib/site.ts.
          thumbs: ["480x0", "960x0", "1920x0"],
          protected: false,
        },
        ...stamps(),
      ],
    });
    app.save(images);

    const config = new Collection({
      name: "site_config",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: EDITOR,
      updateRule: EDITOR,
      deleteRule: EDITOR,
      fields: [
        idField(),
        { type: "text", name: "slot", required: true, max: 60, pattern: "^[a-z]+\\.[a-z]+$" },
        // Exactly one of these is set, by which kind of slot it is. Deleting
        // the content takes its placements with it, so a slot never points
        // at nothing.
        { type: "relation", name: "text", required: false, maxSelect: 1, collectionId: texts.id, cascadeDelete: true },
        { type: "relation", name: "image", required: false, maxSelect: 1, collectionId: images.id, cascadeDelete: true },
        { type: "number", name: "position", required: false, onlyInt: true, min: 0 },
        ...stamps(),
      ],
      indexes: ["CREATE INDEX `idx_site_config_slot` ON `site_config` (`slot`, `position`)"],
    });
    app.save(config);

    const requests = new Collection({
      name: "contact_requests",
      type: "base",
      listRule: EDITOR,
      viewRule: EDITOR,
      // The form. A visitor files one; they cannot pre-mark it handled.
      createRule: "@request.body.status:isset = false",
      updateRule: EDITOR,
      deleteRule: EDITOR,
      fields: [
        idField(),
        { type: "text", name: "firstName", required: true, max: 100 },
        { type: "text", name: "lastName", required: true, max: 100 },
        { type: "email", name: "email", required: true },
        { type: "text", name: "phone", required: false, max: 40 },
        { type: "text", name: "area", required: false, max: 100 },
        { type: "text", name: "description", required: true, max: 5000 },
        // Empty means new.
        { type: "select", name: "status", required: false, maxSelect: 1, values: ["replied", "archived"] },
        ...stamps(),
      ],
      indexes: ["CREATE INDEX `idx_contact_requests_created` ON `contact_requests` (`created`)"],
    });
    app.save(requests);

    /* -------------------------------- seed -------------------------------- */

    const TEXTS = [
      { id: "stx_brand", name: "Business name", title: "Klein Remodeling", body: "Home Renovation & Carpentry" },
      { id: "stx_phone", name: "Phone", body: "513-616-9757" },
      { id: "stx_email", name: "Email", body: "info@klein-remodeling.com" },
      { id: "stx_location", name: "Location", body: "Cincinnati, Ohio" },
      {
        id: "stx_hero",
        name: "Hero",
        title: "Klein Remodeling",
        body: "Home renovation and carpentry, backed by four decades of experience.",
      },
      {
        id: "stx_about",
        name: "About us",
        title: "About Us",
        body: "Klein Remodeling LLC is the culmination of four decades of service in the remodeling and home building industry.",
      },
      {
        id: "stx_hist_1984",
        name: "History: 1984",
        title: "1984",
        body: "Started as Klein Interiors after graduating from The Ohio State University School of Architecture.",
      },
      {
        id: "stx_hist_1986",
        name: "History: 1986",
        title: "1986",
        body: "Partnered with Jim Tanner, a childhood friend, to form Tanner-Klein Remodeling.",
      },
      {
        id: "stx_hist_homes",
        name: "History: custom homes",
        title: "Custom homes",
        body: "As the business grew, we ventured into custom home building as partners in Heartwood Builders LLC, building custom homes from Maineville to Indian Hill. We later stepped away from new homes to focus on our roots in remodeling.",
      },
      {
        id: "stx_hist_2022",
        name: "History: 2022",
        title: "2022",
        body: "Tanner-Klein Remodeling was dissolved as Jim cut back his work schedule. Klein Remodeling now focuses on interior remodeling projects.",
      },
      {
        id: "stx_about_note",
        name: "About: partnership note",
        body: "Jim and I still work on projects together as **Jim the Carpenter LLC** and **Klein Remodeling LLC**.",
      },
      {
        id: "stx_services",
        name: "Services intro",
        title: "Our Services",
        body: "Interior remodeling, finish carpentry, and handyman work — from full kitchen and bath remodels to your “Honey Do List.”",
      },
      {
        id: "stx_svc_remodel",
        name: "Service: complete remodeling",
        title: "Complete Remodeling",
        body: "At Klein Remodeling LLC we offer a full range of interior remodeling, from kitchen and bathroom remodels to minor upgrades.",
        items: "Kitchen remodels\nBathroom remodels\nMinor upgrades",
      },
      {
        id: "stx_svc_interior",
        name: "Service: home interior",
        title: "Home Interior",
        body: "If your home is in need of a facelift, give us a call for a woodwork upgrade.",
        items: "New doors\nCrown moldings\nStaircase railings\nMud room benches",
      },
      {
        id: "stx_svc_handyman",
        name: "Service: handyman",
        title: "Handyman Services",
        body: "With 40 years of experience in home remodeling, we have repaired it all. When your needs are minor but you don’t have the time or know-how to tackle them yourself — go play golf. We can take care of your “Honey Do List.” Enjoy your day.",
        items: "Repairs\nSmall fixes\nYour “Honey Do List”",
      },
      {
        id: "stx_projects",
        name: "Projects intro",
        title: "Projects",
        body: "A look at some of our recent work. Select a photo to view it larger.",
      },
      {
        id: "stx_contact",
        name: "Contact intro",
        title: "Contact Us",
        body: "Tell us about your project and we’ll get back to you. Prefer to talk? Give us a call.",
      },
      {
        id: "stx_areas",
        name: "Contact: areas of the house",
        title: "Area of house",
        items: "Kitchen\nBathroom\nBasement\nLiving / Family Room\nBedroom\nMud Room / Entry\nWhole House\nOther",
      },
      { id: "stx_thanks", name: "Contact: thank-you", title: "Thanks for submitting!", body: "We’ll be in touch soon." },
    ];

    for (const entry of TEXTS) {
      const record = new Record(texts);
      record.set("id", entry.id);
      record.set("name", entry.name);
      record.set("title", entry.title || "");
      record.set("body", entry.body || "");
      record.set("items", entry.items || "");
      app.save(record);
    }

    const IMAGES = [
      { id: "sim_logo", name: "Roof mark", file: "logo-roof.png", alt: "" },
      { id: "sim_hero", name: "Hero: finished home", file: "hero-home.jpg", alt: "" },
      { id: "sim_about", name: "Open kitchen", file: "about.jpg", alt: "A finished open kitchen with walnut cabinetry and two islands" },
      { id: "sim_svc_1", name: "Installing a hinge", file: "services-1.jpg", alt: "Carpenter installing a cabinet door hinge" },
      { id: "sim_svc_2", name: "Measuring trim", file: "services-2.jpg", alt: "Carpenter measuring trim at a workbench" },
      {
        id: "sim_project_1",
        name: "Project: fireplace and mud room",
        file: "project-1.jpg",
        alt: "Fireplace remodel with stacked stone and a timber mantel, plus a mud room bench from drawing to finish",
      },
      { id: "sim_project_2", name: "Project collage 2", file: "project-2.jpg", alt: "Remodeling project photo collage" },
      { id: "sim_project_3", name: "Project collage 3", file: "project-3.jpg", alt: "Remodeling project photo collage" },
      { id: "sim_project_4", name: "Project collage 4", file: "project-4.jpg", alt: "Remodeling project photo collage" },
    ];

    // PocketBase resolves pb_migrations beside pb_data, next to the binary.
    const seedDir = `${$filepath.dir(app.dataDir())}/pb_migrations/website`;
    const seeded = {};

    for (const entry of IMAGES) {
      try {
        const record = new Record(images);
        record.set("id", entry.id);
        record.set("name", entry.name);
        record.set("alt", entry.alt);
        record.set("file", $filesystem.fileFromPath(`${seedDir}/${entry.file}`));
        app.save(record);
        seeded[entry.id] = true;
      } catch (err) {
        console.log(`[website] could not seed ${entry.file}:`, String(err));
      }
    }

    /** Slot → what goes in it, in order. Mirrors SITE_SLOTS in src/lib/site.ts. */
    const LAYOUT = [
      ["brand.name", "text", ["stx_brand"]],
      ["brand.logo", "image", ["sim_logo"]],
      ["contact.phone", "text", ["stx_phone"]],
      ["contact.email", "text", ["stx_email"]],
      ["contact.location", "text", ["stx_location"]],
      ["hero.text", "text", ["stx_hero"]],
      ["hero.image", "image", ["sim_hero"]],
      ["about.text", "text", ["stx_about"]],
      ["about.image", "image", ["sim_about"]],
      ["about.timeline", "text", ["stx_hist_1984", "stx_hist_1986", "stx_hist_homes", "stx_hist_2022"]],
      ["about.note", "text", ["stx_about_note"]],
      ["services.text", "text", ["stx_services"]],
      ["services.list", "text", ["stx_svc_remodel", "stx_svc_interior", "stx_svc_handyman"]],
      ["services.images", "image", ["sim_svc_1", "sim_svc_2"]],
      ["projects.text", "text", ["stx_projects"]],
      ["projects.gallery", "image", ["sim_project_1", "sim_project_2", "sim_project_3", "sim_project_4"]],
      ["contact.text", "text", ["stx_contact"]],
      ["contact.areas", "text", ["stx_areas"]],
      ["contact.thanks", "text", ["stx_thanks"]],
    ];

    let n = 0;
    for (const [slot, kind, ids] of LAYOUT) {
      let position = 0;
      for (const id of ids) {
        if (kind === "image" && !seeded[id]) continue;
        const record = new Record(config);
        record.set("id", `scf_seed${String(n++).padStart(3, "0")}`);
        record.set("slot", slot);
        record.set(kind, id);
        record.set("position", position++);
        app.save(record);
      }
    }
  },
  app => {
    for (const name of ["contact_requests", "site_config", "site_images", "site_texts"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // already gone
      }
    }
    const users = app.findCollectionByNameOrId("users");
    if (users.fields.getByName("siteEditor")) users.fields.removeByName("siteEditor");
    app.save(users);
  },
);
