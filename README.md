# Sitelines

Construction estimating and project billing. Keep a catalogue of what a job is built out of —
materials with their waste factors and the lots they are sold in, labour, equipment, subcontracts and
assemblies — set your markup, overhead and tax once, and turn that into estimates that price
themselves and render into a document you can send. Bill the accepted ones and chase what is owed.

Two things make it a contractor's tool rather than a sales one:

**A take-off is not a purchase order.** Every line carries the quantity somebody measured *and* the
quantity that has to be bought — the measured one plus the material's waste allowance, rounded up to
whatever lot the supplier will actually sell. Drywall wastes 15% and concrete comes by the quarter
yard, and an estimate that ignores either comes up short. See [The take-off](#the-take-off).

**The catalogue can feed itself.** Point a supplier feed at a CSV or a JSON endpoint, map its columns
once, and say what it is allowed to change. Nothing is ever applied without a review, a feed only
writes the fields you gave it, and a price that moves further than you allowed waits for a person.
See [Supplier feeds](#supplier-feeds).

It is built for one company. Everyone who signs in has their own jobs, catalogue, clients and
estimates; an estimate, an invoice, a project, a feed or a template can be shared, read-only, with
anyone else who has an account — see [Accounts and sharing](#accounts-and-sharing).

The app and its database run together under Docker Compose:

```bash
cp .env.example .env     # ports, PocketBase version, dashboard credentials
bun run docker:up        # http://localhost:3000, PocketBase on :8091
```

Open it, create an account, and press **Install the sample** in Settings — it fills the workspace
with a worked example you can take apart: a townhome job under construction, a tenant improvement
still out to bid, a finished kitchen remodel waiting on its last payment, a catalogue of lumber,
concrete, rebar, roofing, insulation, drywall, paint, windows, doors, crews, rentals and three
subcontracts, and one supplier feed configured the careful way.

Starting from your own catalogue instead? **Catalogue → Templates** has a spreadsheet to fill in —
see [Bringing a catalogue in](#bringing-a-catalogue-in).

Usable as a UI or as a local REST API — see [API](#api).

It is dressed as the thing it produces: warm parchment with a laid-paper tooth, walnut ink, forest
green for anything live, and titles set in a serif — with a dark mode that is the same wood at
dusk. Motion is slight and always `motion-safe`: screens settle onto the page, the section you are
on is marked with a leaf's vein, and nothing moves for anyone who has asked it not to.

## What it does

### The catalogue

A **catalogue item** is a SKU, a unit, a price, a cost, and a shape. It might be a material, an
hour of labour, a month of equipment rental (an item in `MO`), a subcontract or an assembly. Leave
its list price at 0 and it sells at cost plus your markup:

| Part | What it is |
| --- | --- |
| Cost type | `material`, `labor`, `equipment`, `subcontract`, `other` — how a job's cost report adds it up |
| Unit of measure | `EA`, `LF`, `SF`, `CY`, `BF`, `BDL`, `SHT`, `HR`, `DAY`, `LS`… a closed list, so nothing multiplies square feet by sheets |
| Waste factor | How much more than the take-off you actually have to buy. Drywall 15%, shingles 12%, studs 8% |
| Purchase multiple | The lot it is sold in. Concrete by the quarter yard; a yard will not break a pallet |
| Specification | CSI division, manufacturer and part number, supplier and their SKU, nominal and actual size, grade, finish, weight, coverage, lead time, whether it needs a submittal |
| Option groups | Choices on the line. Mix additions on a concrete pour, glazing on a window, overtime on a crew |
| Configuration rules | `requires`, `excludes`, `recommend`, and `validate` — an arbitrary formula over the line |
| Volume tiers | Price breaks on quantity: `294+: 6% off` — the banded unit of studs a yard will put on a truck |
| Assembly components | Other SKUs pulled onto the estimate as their own lines: a framed wall by the linear foot |

A **nominal size is not an actual size** and the catalogue records both. A 2×4 is 1½ × 3½, every
framer knows it, and a catalogue with only one of the two numbers is useless for whichever question
you did not anticipate.

Options are priced factor-first, then delta — so `100 × 1.4 + 15` is 155, not `(100 + 15) × 1.4`. A
percentage uplift never silently scales a flat add-on.

### The take-off

Every line on an estimate has two quantities, and confusing them is the classic way to come up
short:

| | What it is |
| --- | --- |
| **Take-off** | The finished work, as measured. 2,400 SF of roof, 312 LF of top plate |
| **Order** | What lands on site: the take-off plus waste, rounded up to the sales lot |

A take-off of 640 sheets of 5/8″ Type X at 15% waste orders 736. Twelve and a bit cubic yards of
4000 PSI at 5% orders 13, because the plant batches quarter yards. Windows waste nothing and order
exactly what was measured.

The waste factor lives on the material, because sheet goods waste more than sticks — and is
overridable on the line, because a cut-up hip roof and a plain gable take the same shingle and waste
quite different amounts of it.

**The order quantity is worked out on every pricing pass and never stored.** A stored one has the
waste factor applied to it again the next time the estimate is saved, and grows by 10% every time
somebody opens it, quietly. The estimate shows both numbers on the line, which is the pair a
superintendent checking a delivery actually wants.

Volume tiers are matched on the *order* quantity: you buy 302 studs, so you get the banded-unit
price, even though the take-off said 280.

Rules reference options by **key**, not by id, so a catalogue survives being exported and imported
somewhere else. `requires` and `excludes` block; `recommend` only warns. A `validate` rule is a
formula:

```
quantity >= 25                          Enterprise starts at 25 users
option.hsm == 0 || option.enterprise    keys are Enterprise-only
```

The configurator runs in the browser as options are clicked *and* on the server when the quote is
saved — the same function, so the editor can never say a configuration is fine that the server will
then refuse.

### Price

The server prices every quote it stores. Totals in a request body are ignored. A line's price is
built in a fixed order, and every step is kept on the line, because the question an estimator is always
asked is "why is it that price":

| # | Step |
| --- | --- |
| 1 | The item's list price — or, when it has none, its cost plus the estimate's markup |
| 2 | The configured options — the factor, then the delta |
| 3 | The volume tier the quantity falls into |
| 4 | A negotiated unit price override, which replaces 1–3 outright |
| 5 | The estimator's discount |

Then the estimate: the lines' subtotal, less the estimate discount, **plus overhead** on what is
left, plus shipping, plus tax. Expanding a line in the editor shows that walk.

**Markup, overhead and tax are three numbers in Settings**, not a rule engine. A new estimate copies
them and keeps its own from then on — editable on the estimate itself — so changing them never
reprices one that has already gone out. Markup only prices an item with no list price of its own,
which is what lets a supplier feed's cost update flow through to the price without anybody
retyping it; an item somebody priced by hand sells at that price.

**Money is rounded at every step, to the cent**, and every total is the sum of numbers that were
already rounded. A quote is checked with a calculator by people about to spend money, and a total a
cent away from its own visible lines costs more to explain than it could ever save.

**"% off list" is measured against the configured item** — options included, tiers and discounts
not, and overhead is a charge rather than a negative discount. Any other baseline makes the number
meaningless the moment an option adds value.

### The formula language

An item's `validate` rules are written in a small expression language. Expressions are tokenized,
parsed into an AST and walked by hand — there is no `eval`, no `Function`, and nothing reachable
but the variables passed in.

| | |
| --- | --- |
| Arithmetic | `+ - * / % ^`, parentheses. `^` is right-associative |
| Comparison | `< <= > >= == !=` — they produce `1` and `0`, so a condition *is* an expression |
| Logic | `&& \|\| !`, short-circuiting |
| Functions | `round clamp floor ceil abs sqrt pow min max if` |
| Variables | `quantity`, `selectedCount`, and `option.<key>` as 1 or 0 for each of the item's options |

`if(condition, a, b)` evaluates only the branch it takes, so the other one may divide by zero. A
rule is checked against the variables it can see as it is typed — a typo is caught by the person
writing it rather than by the quote it let through.

### Quote

A quote has a customer, its own markup, overhead and tax, lines, and a life:

```
draft ──send──▶ sent ──▶ accepted
  ▲               │      declined
  └── reopen ─────┘
```

- **Only a draft is editable.** A sent quote exists in someone else's inbox with a number on it;
  changing it underneath its reader is how an estimate stops being trustworthy — `New revision` is
  the way forward.
- **A quote with a problem cannot be sent.** A line whose item is gone, or a configuration the
  catalogue refuses, has to be fixed first.
- **A revision is a new record**, numbered `EST-2026-0007-r2`, pointing at what it supersedes. The
  document that was sent stays exactly as it was sent, which is what makes "which version did they
  sign" a question with an answer.
- **A sent quote past its `validUntil` reads as expired** without being rewritten — expiry is a fact
  about the calendar, not a status that only becomes true when a job sweeps it.
- **A quote snapshots what it was priced from.** Each line carries the product's name, SKU and list
  price as they were; the quote carries the customer's address and terms. A quote sent last quarter
  still renders correctly after the catalogue moves on, and one shared with a colleague who cannot
  read your customers still renders at all.

### Quote documents

A quote renders into a document through a **proposal template**, and a workspace can hold as many
as it likes — a full proposal, a one-page summary, a partner version. Four formats:

| Format | The body is | Good for |
| --- | --- | --- |
| `pdf` | A document description (blocks) | The file a customer receives |
| `html` | Text with tokens | A styled page, an email, a letterhead |
| `markdown` | Text with tokens | Something to paste into a doc or a wiki |
| `text` | Text with tokens | A plain-text quote in the body of an email |

**The three text formats** are text with `{{token}}` placeholders:

```markdown
# {{quote.name}}

**Quote {{quote.number}}** · valid until {{quote.validUntil}}
Prepared for {{customer.name}} ({{customer.contactName}})

{{#lines}}- {{line.quantity}} × {{line.name}} {{line.options}} — {{line.total}}
{{/lines}}

**Total {{totals.grandTotal}}** ({{totals.discountPercent}} off list)
```

`{{#lines}}…{{/lines}}` repeats per line; `{{lines.table}}` drops in a ready-made table in the
template's own format. The editor lists every token as a clickable chip and warns about any it does
not recognise, because an unresolved token renders as a blank in a document going to a customer.
Nothing is executed: rendering is string substitution, and values are escaped for the target format
— a product called `AC/DC <5kW>` renders as those characters rather than as broken markup.

### PDF

**A PDF template is a document described as data** rather than prose, because a PDF has no layout
of its own: something has to say where on the page each thing goes, how wide the columns are, and
what happens when the items run past the bottom. The alternative — writing HTML and rendering it —
means shipping a browser to do it.

So a template is page setup plus an ordered list of blocks, edited as a list rather than as JSON:

| Block | What it draws |
| --- | --- |
| Heading / Text | A title or a wrapped paragraph, with size, alignment and colour |
| Image | A picture in the flow — a logo, a cover band, a diagram — at a width you give, with an optional caption |
| Columns | Side-by-side panels — prepared for / prepared by / valid until |
| Field list | Label and value pairs |
| Line items | The quote's lines as a table: pick the columns, their widths and their alignment |
| Totals | A right-aligned totals panel, each row naming the number it shows |
| Signatures | Ruled areas for names and dates |
| Divider / Spacer / Page break | The usual layout furniture |

Plus a **letterhead**: a logo and a block of text drawn into the top margin, on every page or only
the first. It sits beside the page setup rather than in the block list because it is not part of
the flow — it is drawn after the layout is finished, like the footer, and a proposal whose second
page is unbranded looks like a fax.

Every piece of text in a block runs through the **same token vocabulary as the other formats**, so
`{{customer.name}}` means the same thing in a PDF as in an HTML template.

**The preview is the output.** The renderer is pure and runs in both places, so the template editor
draws the real PDF in an iframe on every change — by the same code the server runs for the file a
customer receives. A preview that could disagree with the download would be worse than none, so it
cannot: there is one implementation. Design a template before you have written a single quote and
it renders against a built-in specimen, itself priced by the real pricing engine so its totals add
up.

**What a PDF template deliberately cannot do.** It cannot print **cost or margin** — the totals it
may name is a closed, customer-facing list, and internal numbers are simply not on it, so the one
artefact designed to leave the company has no way to carry them.

The writer is about a thousand lines with no dependencies, using only the PDF standard 14 fonts, so
a quote is a few kilobytes and opens anywhere without an embedded font. That is the same trade this
codebase makes for the formula language and for CSV: at the size we use the format, owning it costs
less than depending on it. Text is encoded as WinAnsi — the em dashes, curly quotes, `·`, `×` and
the €/£/¥ symbols the rest of the app emits all survive, and anything that cannot be encoded
degrades to something readable (`≥` becomes `>=`) rather than vanishing.

Download a PDF from the **PDF** button on any saved quote, from **Preview** beside any template, or
over the API:

```bash
curl -sb jar "localhost:3000/api/quotes/qte_1a2b3c4d/document?templateId=tpl_1a2b3c4d" -o quote.pdf
```

### Branding

A logo lives **in the template**, as a base64 `data:` URL beside the blocks that use it, so it
travels with an export, a share and an import rather than turning into a broken reference. Drop a
file on the image picker and it is ready to print; the browser flattens transparency onto the paper
colour, scales anything oversized down and re-encodes losslessly, so what gets stored is bytes a
PDF reader can take as they are.

That strictness is the point: the writer embeds an image **without decoding it**. A JPEG's own data
is PDF's `DCTDecode` stream, and a PNG's `IDAT` is `FlateDecode` with the predictor PDF already
knows — so a logo goes into the file byte for byte, at full quality, and the same picture on eight
pages is one object. What that rules out is transparency inside the stream (PDF has no such thing),
interlaced PNGs, CMYK and progressive JPEGs; the editor converts all of those on the way in, and
the API answers a sentence saying which one it hit. An image that cannot be drawn is left out and
reported rather than failing the render — a proposal missing its logo can still be read.

### Move it around

| What | Where |
| --- | --- |
| `*.catalog.json` | The catalogue. Meant to live in a repo next to the code that depends on it |
| Quote CSV / JSON | One row per line, money as bare numbers — a CSV with `$1,234.56` in a cell sums to zero |
| Catalogue CSV | The catalogue as a spreadsheet. The leading columns import back; options, tiers and assemblies are flattened to something readable |
| Workspace JSON | Everything: catalogue, customers, templates, settings **and quotes** |

Catalogue files identify records by SKU and name, never by internal id — ids are stripped on export
and minted fresh on import, so the same catalogue exported from two instances produces the same
bytes and stays diffable. Nothing is stored until the whole document validates; an import that
would half-apply leaves a catalogue nobody can reason about. Anything already present by SKU or
name is skipped rather than overwritten, so an import is never the thing that silently changed a
live price.

### Bringing a catalogue in

**Catalogue → Templates** lists four files, also at `GET /api/catalog/templates`:

| File | For |
| --- | --- |
| `catalog-template.csv` | A spreadsheet with every column the importer reads and four example rows. Replace them with yours |
| `catalog-template-blank.csv` | The same headings, nothing under them |
| `catalog-template.catalog.json` | What a spreadsheet cannot hold: option groups, configuration rules, volume tiers, an assembly |
| `supplier-feed-example.csv` | Not for Import: the price list the sample's supplier feed is mapped to. Drop it on that feed to see a sync plan |

**Import** takes either a spreadsheet or a catalogue file, and both go through the same validator.
Only `sku`, `name`, `unitOfMeasure` and `listPrice` are required. Headings are matched loosely
(`List Price`, `list_price`, `UOM`, `Waste %`), and a sheet saved from Excel with a byte-order
mark, semicolons or a European decimal comma reads fine. The spreadsheet reader is stricter about
cells than about headings, because a lenient one causes expensive mistakes:

- A price that cannot be read (`call us`, an empty cell) **refuses the file and names the row**.
  It never becomes 0, because a 0 there is a free item.
- A unit not on the list (`sq ft`) is refused, never quietly read as `EA`.
- A column nothing recognises is reported in a warning, never dropped in silence.

Nothing is written until every row is good, and a SKU already in the catalogue is left exactly as
it is. The CSV export writes the same leading columns, so a catalogue exported from one workspace
imports into another.

A spreadsheet is for loading your *own* catalogue. Keeping costs current from a supplier's list is
a [supplier feed](#supplier-feeds), which reviews every change before applying it.

### The worked example

An empty workspace is not explorable: you cannot see what a volume tier does without an item that has
one, or what a waste factor does without a sheet good. **Install the
sample** in Settings adds 27 catalogue items across every cost type: sheet goods and sticks with
their waste factors, ready-mix and a pump sold in fractional lots, batts, wrap and paint bought by
the bundle, roll or gallon but measured by the square foot, configurable windows and doors, labour
rates with overtime, monthly rentals and general conditions, three subcontracts, and two assemblies
that pull their materials onto the estimate. It also adds three clients with a job each (one being
built, one out to bid, one finished), four invoices spread across the aging, seven proposal
templates, and an estimate priced from all of it under your markup and overhead. The templates are the documentation for the document format:
between them they use every block, the letterhead, the whole customer-facing totals list and both
kinds of image, and **Start from an example** on the Templates screen opens any of them as a draft
to take apart.

It is additive and idempotent by SKU and name — running it twice does not produce two catalogues,
and it never overwrites something you have edited. Everything goes in through the same validators
and the same pricing engine as anything else: if it would not import as a file, it does not install
either.

### Your own defaults

The gear beside your name opens *Settings*, where preferences decide what the app starts you with —
your markup, overhead and tax, how long a quote is valid, locale, how many quotes the list holds,
and whether deleting asks first. They belong to the account rather than the browser, so they follow
you to another machine, and they save themselves as you change them.

**Show cost and margin** is off by default and worth the switch: margin is the number nobody wants
over their shoulder in front of a customer, and a rep sharing their screen on a call should be able
to put it away in one click.

### Projects

A **project** is the job: where it is, who is running it, what the contract says, and what has
happened to the money. A client is a relationship; a project is the thing that gets built, gets
billed and gets argued about. Two buildings for one developer share an account and share nothing
else — different site, different permit, different superintendent, different money.

Estimates and invoices each attach to one, and a project screen shows its whole position:

| | Where it comes from |
| --- | --- |
| Contract | Entered. An awarded contract sum is negotiated after the estimate is accepted more often than not |
| Accepted estimates | What the estimates actually say, reported *beside* the contract so a disagreement is visible rather than resolved by guessing |
| Out for decision | Estimates still being decided |
| Invoiced, paid, outstanding | From the issued invoices and their ledger |
| Backlog | Accepted and not yet billed |

**None of those are stored.** All of them are recomputed from the estimates and invoices on every
read, for the same reason an invoice has no stored balance: a cached roll-up disagrees with the
documents underneath it the first time somebody voids one, and it disagrees in front of a client.

Nothing sums two currencies. An estimate written in something other than the job's currency is
counted and reported, never added in.

Attaching an estimate to a job is optional and stays optional. A bid is very often written before
there is a job record — that is what a bid *is* — and forcing one into existence first would make
the fast path the awkward one.

### Supplier feeds

A building-material catalogue goes stale faster than anything else here. Lumber moves weekly, a
manufacturer discontinues a colour, a supplier renumbers half their line — and an estimate priced
off last quarter's catalogue is wrong in a way nobody notices until the invoices come in.

A **source** is a supplier's price list: a CSV or JSON endpoint, or a file you drop on the page
(plenty of suppliers email a spreadsheet and have no endpoint at all). You map its columns once,
against the feed's own headings — read the feed and the pickers fill with what it actually says —
and then say what a sync is allowed to do.

That last part is the whole design:

| Rule | Why |
| --- | --- |
| **A plan is proposed before it is applied** | The preview and the sync run the same function; the preview stops one step earlier. Otherwise the first time you see what a feed does is after it has done it |
| **A feed owns only the fields you gave it** | Your waste factors, option groups, assemblies, discount ceilings, margins and — unless you say otherwise — your sell price are not a supplier's to set. Most trade feeds quote your *cost*, and a contractor who lets a supplier set what they charge their client has made a mistake this app should not make easy |
| **A big price move is flagged, not applied** | A feed with a misplaced decimal point is not hypothetical. Anything past your threshold appears in the review with both numbers and waits for you to accept it |
| **Nothing is ever deleted** | An item the feed has stopped carrying can be deactivated, and only if you asked. It stays on every estimate that already quotes it |

Rows are matched on a key you choose — usually the supplier's own SKU, because they know their
codes and know nothing about yours. An empty cell never blanks a field that has a value: a supplier
leaving a cell empty means "I have nothing to say", not "delete what you know". An unreadable price
(`call for pricing`) leaves the price alone rather than becoming zero.

Every synced item records where its numbers came from — which feed, what that feed calls it, when,
and which fields it set — so "why is this $4.12" has an answer.

Writes go through the same validation and the same access control as an item you typed. A sync
cannot write anything you could not, which is what stops "the feed did it" from ever explaining a
record that should not exist.

### Getting around

The left-hand navigation **collapses to its icons**, which is worth a click on a laptop when the
quote editor wants the width. It collapses from the button at the foot of the nav, and — like
every other preference here — the choice belongs to the account rather than the browser, so it
follows you to another machine. Nothing in this app writes to browser storage.

**Every form is a panel that slides in from the right**, full height, about a third of the window.
A centred modal fights the work it is used for: it covers the list you were reading, it cannot be
as tall as the screen, and a long form inside one scrolls in a box floating over another
scrollable box. A panel leaves the record you came from visible beside it and gets the whole
column height for free. Editors size themselves against the panel rather than against the window
behind it, so a dense form reflows to the space it actually has.

The exception is anything meant to be **read** rather than filled in — a rendered proposal, a PDF
preview. Those stay wide modals, because a document squeezed into a third of the screen is a
document nobody can check.

**A field that names another record is a searchable dropdown**, never a text box — an assembly's
component, the family on an item, a project's client and the people running it, and the columns a
supplier feed maps. Each one searches by SKU and by name, and shows what it is offering (`bundle`,
`inactive`).

The reason is that a typo in one of these does not fail loudly. A bundle component whose SKU matches
no product is skipped when the bundle is expanded — the quote simply comes out missing a line, with
nothing to say why. Where a reference can legitimately dangle (an assembly may name a SKU this
workspace has not created yet, which is exactly what the importer warns about rather than refusing)
the dropdown still accepts a typed value, and the form says the SKU is not in the catalogue instead
of silently accepting it.

A person's address and a feed's column names stay typable as well as offered: an address may be
named before it registers, and a mapping is often written before anybody has fetched the feed.

## Running it

Two containers, defined in `docker-compose.yml`: `app` (this Bun server, UI and API) and
`pocketbase` (the database). `docker-compose.override.yml` publishes their host ports, and Compose
loads it automatically for a local `docker compose up` — a deploy target that names a compose file
with `-f` gets the base file, which publishes nothing.

```bash
cp .env.example .env     # required: PB_VERSION and the superuser credentials
bun run docker:up        # build + start both, in the background
bun run docker:logs      # follow both
bun run docker:down      # stop; the pb_data volume (your data) survives
```

| URL | What |
| --- | --- |
| `http://localhost:3000` | The app |
| `http://localhost:8091/_/` | PocketBase dashboard, as `PB_ADMIN_EMAIL` |

PocketBase creates its superuser on first boot from `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`
(`docker/pb_hooks/setup/superuser.js`), and never touches it again — rotating the password in the
dashboard survives a redeploy. `bun run docker:init` resets it back to the `.env` values.

**Working on the app itself** is faster outside the container, with only the database in Docker:

```bash
docker compose up -d pocketbase
bun install
bun dev                 # hot reload, http://localhost:3000
PORT=4000 bun dev       # or anywhere else
```

Bun loads `.env` too, so `bun dev` finds the same PocketBase through `PB_PORT`. `POCKETBASE_URL`
overrides the location outright — Compose sets it to `http://pocketbase:8080` for the containerised
app.

### Tests

```bash
bun test
```

The library tests — pricing, the formula language, configuration, proposals, the file
formats — are pure and run in milliseconds. `src/server/api.test.ts` is end-to-end against a real
Bun server talking to a real PocketBase in a throwaway container built from `docker/`, so the route
table, the storage layer, the collection rules and the hooks are all exercised for real. Without
Docker those tests skip and everything else still runs.

## Accounts and sharing

Sign-up is open: an email address and a password of at least eight characters make an account.
Everything you then create is yours, and nobody else's list, count or export can reach it. Your
catalogue and clients are never shared — an estimate carries its customer's details itself.

**Sharing** is read-only and covers the documents worth passing around — estimates, invoices,
projects, supplier feeds and templates:

| A recipient can | A recipient cannot |
| --- | --- |
| Open it, and see it under their own list | Rename, edit or delete it |
| Export it | Share it on to anyone else |
| | See who else it is shared with |

A recipient can drop a share from their own list, and the owner can revoke it at any time.

**The account directory.** Picking someone to share with means choosing a person,
so `GET /api/directory` lists the accounts on the instance — **id, email and display name, and
nothing else**. No verified flag, no dates, no preferences, and nothing any of them owns.

Be aware of what that means: with sign-up open, anyone who registers can see every account's
address. The collection rules are untouched — a user token still cannot read the `users` collection
— so this endpoint is the only way through, and it is one file
(`docker/pb_hooks/lib/directory.js`). Drop it from `pb_hooks/main.pb.js`, or close sign-up, if that
is the wrong trade for your instance: every picker treats an empty directory as "type the address
yourself", which is how they behaved before.

Beyond the directory, addresses are still only resolved, never enumerated: sharing looks up the
address you give it and says whether an account exists for it.

**Upgrading from the dummy-data generator this grew out of?** Its three collections are dropped by
`docker/pb_migrations/1750000003_cpq.js` — a generated dataset has no domain meaning to migrate into.
Take a `GET /api/export` from the old app first if the contents still matter. Records made before
accounts existed have no owner and are invisible until the first account registers, which inherits
them. Likewise `1750000014_simplify.js` drops price books, pricing rules and approval rules, and
moves any quote that was in review back to draft.

## Storage

Everything lives in PocketBase, in collections created by `docker/pb_migrations/`. The core ones:

| Collection | Holds |
| --- | --- |
| `products` | The catalogue: price, cost, and the option groups, rules, tiers and components as JSON |
| `accounts` | Customers, with their terms and tax position |
| `quotes` | Lines and totals, stored as priced, with the markup, overhead and tax they were priced under |
| `proposal_templates` | Document bodies — text with `{{token}}` placeholders, or a PDF document description with its branding inside it |

Each collection has real columns for what the *database* has to do something with — find by SKU,
sort by name, filter by status — and one JSON field for the nested domain object
the app reads whole. Spreading option groups across thirty PocketBase fields would buy no query
anything performs and cost a migration every time the domain grew a feature.

Ids stay the readable `prd_…` / `qte_…` strings the API and the UI use; the migration
widens PocketBase's fixed-length id field to allow them. Preferences get no collection: they are one
`preferences` JSON field on the account's own `users` record, read with the session on every page
load, and they die with the account. Every read and write goes through one normalizer
(`src/lib/preferences.ts`), so a stored blob missing a key still reads back as a complete set.

**Who may do what is decided by PocketBase, not by this server.** Every collection carries API rules
— `owner = @request.auth.id` for a catalogue item, `|| sharedWith.id ?= @request.auth.id` on top for
a quote — and the Bun server holds no credentials of its own:
it passes your token through and PocketBase evaluates those rules against *you*. A mistake in a
route here cannot hand one account another's records, because the route has no authority to hand
them over with. The browser never holds a PocketBase token either; it lives in an httpOnly cookie.

Hooks back that up (`docker/pb_hooks/`): `owner` is stamped from the authenticated account on
create and restored on update, so it cannot be set from a request body, and the sharing endpoints
run inside PocketBase, where resolving an address does not require the ability to read the user
list.

The data is in the `pb_data` Docker volume. `docker compose down` keeps it; `docker compose down -v`
deletes it. A stored quote is capped at 4 MB of line items.

## API

Everything the UI can do is a REST call on the same `Bun.serve` router — no separate API server, no
extra process. `GET /api` returns the endpoint index, so the app documents itself:

```bash
curl -s localhost:3000/api | jq
```

Everything except `/api`, `/api/health` and `/api/auth/*` needs a session. Sign in once with a
cookie jar and every later call is authenticated:

```bash
curl -sc jar -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"your-password"}'
curl -sb jar localhost:3000/api/quotes | jq
```

An `Authorization: <token>` header works too, for a script holding a PocketBase user token.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api` | Endpoint index |
| `GET` | `/api/health` | Liveness check — what the container healthcheck polls |
| `GET` | `/api/meta` | PocketBase URL, reachability and your record counts |
| `GET` | `/api/reference` | Every enum and proposal token this app knows |
| `POST` | `/api/auth/register` `login` `logout` | `{ email, password }` → a session |
| `GET` | `/api/auth/me` | The signed-in account, with its preferences |
| `POST` | `/api/auth/password` | `{ currentPassword, newPassword }` |
| `GET` `PUT` | `/api/preferences` | Read / replace this account's settings, markup, overhead and tax included |
| `POST` | `/api/formula/validate` | `{ expression, optionKeys? }` → check an item's rule before saving it |
| `GET` `POST` | `/api/accounts` | List / create customers |
| `GET` `PUT` `DELETE` | `/api/accounts/:id` | One customer |
| `GET` `POST` | `/api/products` | List / create products |
| `GET` `PUT` `DELETE` | `/api/products/:id` | One product |
| `POST` | `/api/products/:id/configure` | `{ selectedOptions, quantity }` → validate a configuration |
| `GET` | `/api/products/export` | The catalogue as `*.cpq.json`, or `?format=csv` |
| `GET` | `/api/catalog/export` | The catalogue as one `*.catalog.json` |
| `POST` | `/api/catalog/import` | Create everything in a `*.catalog.json` body, or a `text/csv` spreadsheet |
| `GET` | `/api/catalog/templates` | The files a catalogue can be started from (no credential) |
| `GET` | `/api/catalog/templates/:file` | Download one |
| `GET` `POST` | `/api/quotes` | List (`?limit=`) / create — the server prices it |
| `POST` | `/api/quotes/preview` | Price a quote without storing it |
| `GET` `PUT` `DELETE` | `/api/quotes/:id` | Read / replace a draft / delete |
| `POST` | `/api/quotes/:id/status` | `{ status }` → sent, accepted, declined, back to draft |
| `POST` | `/api/quotes/:id/revise` | The next revision, leaving this one as it was |
| `GET` | `/api/quotes/:id/export` | Download a quote (`?format=csv\|json`) |
| `GET` | `/api/quotes/:id/document` | Render through a template (`?templateId=`). A PDF template answers with the PDF; `&inline` dispositions it for an iframe |
| `GET` `POST` | `/api/proposal-templates` | List / create templates |
| `GET` `PUT` `DELETE` | `/api/proposal-templates/:id` | One template |
| `GET` `POST` `DELETE` | `/api/{quotes\|invoices\|projects\|catalog-sources\|proposal-templates}/:id/shares` | List / add (`{ email }`) / remove (`?email=`) a recipient |
| `GET` | `/api/export` | The whole workspace as one JSON file |
| `POST` | `/api/sample` | Install the worked example |

Posting a quote sends the header plus `lines`, and gets back the priced quote with every
intermediate number on each line:

```bash
curl -sb jar -X POST localhost:3000/api/quotes -H 'content-type: application/json' -d '{
  "name": "Cedar Row framing", "accountId": "acc_1a2b3c4d",
  "lines": [{ "productId": "prd_1a2b3c4d", "quantity": 2240, "discountPercent": 5 }]
}' | jq '.quote.totals'
```
