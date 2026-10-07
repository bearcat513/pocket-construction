import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LogIn,
  Mail,
  MapPin,
  Menu,
  Phone,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { inlineSpans } from "@/lib/markdown";
import {
  CONTACT_HONEYPOT,
  pageImage,
  pageImages,
  pageText,
  pageTexts,
  paragraphs,
  phoneHref,
  siteImageSrcSet,
  type SiteImage,
  type SitePage,
} from "@/lib/site";
import { cn } from "@/lib/utils";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap";

/** The brand's faces, linked once and only when the site is shown. */
function useSiteFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS_HREF}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.append(link);
  }, []);
}

/**
 * The public website — what a visitor who has not signed in sees.
 *
 * Every word and picture comes from `GET /api/site`: the texts and images are
 * their own collections, and the website config decides which goes in which
 * slot (src/lib/site.ts). A slot with nothing in it hides its part of the
 * page rather than showing a hole, so an editor can take a section down by
 * emptying it.
 *
 * One page with anchors rather than the original site's four routes: the app
 * owns the URL bar once somebody signs in, and a landing page reads top to
 * bottom anyway.
 */
export function Website({ signInLabel, onSignIn }: { signInLabel: string; onSignIn: () => void }) {
  useSiteFonts();
  const [page, setPage] = useState<SitePage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api
      .sitePage()
      .then(setPage)
      .catch(() => setFailed(true));
  }, []);

  const brand = page ? pageText(page, "brand.name") : undefined;

  useEffect(() => {
    if (!brand) return;
    document.title = [brand.title, brand.body].filter(Boolean).join(" | ");
  }, [brand]);

  if (!page) {
    return (
      <div className="site grid min-h-screen place-items-center px-4 text-center">
        {failed ? (
          <div className="space-y-4">
            <p className="text-lg text-muted-foreground">This page could not be loaded just now.</p>
            <SignInLink label={signInLabel} onClick={onSignIn} />
          </div>
        ) : (
          <span className="sr-only">Loading…</span>
        )}
      </div>
    );
  }

  return (
    <div className="site flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader page={page} signInLabel={signInLabel} onSignIn={onSignIn} />
      <main id="main" className="flex-1">
        <Hero page={page} />
        <About page={page} />
        <Services page={page} />
        <Projects page={page} />
        <Contact page={page} />
      </main>
      <SiteFooter page={page} signInLabel={signInLabel} onSignIn={onSignIn} />
    </div>
  );
}

/* --------------------------------- pieces -------------------------------- */

/** A body of text: paragraphs on blank lines, `**bold**` honoured, nothing else. */
function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {paragraphs(text).map((paragraph, index) => (
        <p key={index} className={className}>
          {inlineSpans(paragraph).map((span, at) =>
            span.kind === "strong" ? <strong key={at}>{span.text}</strong> : <span key={at}>{span.text}</span>,
          )}
        </p>
      ))}
    </>
  );
}

/** The sections a page actually has, for the nav — an emptied one drops out. */
function sectionsOf(page: SitePage) {
  return [
    { id: "about", label: "About", shown: Boolean(pageText(page, "about.text")) },
    { id: "services", label: "Services", shown: pageTexts(page, "services.list").length > 0 },
    { id: "projects", label: "Projects", shown: pageImages(page, "projects.gallery").length > 0 },
    { id: "contact", label: "Contact", shown: true },
  ].filter(section => section.shown);
}

function contactDetails(page: SitePage) {
  const phone = pageText(page, "contact.phone")?.body.trim() ?? "";
  return {
    phone,
    phoneHref: phoneHref(phone),
    email: pageText(page, "contact.email")?.body.trim() ?? "",
    location: pageText(page, "contact.location")?.body.trim() ?? "",
  };
}

function SignInLink({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
        className,
      )}
    >
      <LogIn className="size-4" aria-hidden /> {label}
    </button>
  );
}

const solidButton =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90";

/* --------------------------------- header -------------------------------- */

function SiteHeader({ page, signInLabel, onSignIn }: { page: SitePage; signInLabel: string; onSignIn: () => void }) {
  const [open, setOpen] = useState(false);
  const brand = pageText(page, "brand.name");
  const logo = pageImage(page, "brand.logo");
  const { phone, phoneHref: tel } = contactDetails(page);
  const sections = sectionsOf(page);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#main" className="flex items-center gap-3" aria-label={`${brand?.title ?? "Home"} — top of the page`}>
          <span className="leading-tight">
            {logo && <img src={logo.url} alt="" className="mb-1 h-4 w-auto" />}
            <span className="block font-[family-name:var(--font-display)] text-lg font-bold tracking-wide uppercase sm:text-xl">
              {brand?.title}
            </span>
            {brand?.body && (
              <span className="hidden text-xs tracking-[0.14em] text-muted-foreground uppercase sm:block">{brand.body}</span>
            )}
          </span>
        </a>

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {sections.map(section => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="rounded-md px-3 py-2 text-base font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <SignInLink label={signInLabel} onClick={onSignIn} className="hidden text-sm lg:inline-flex" />
          {tel && (
            <a href={tel} className={cn(solidButton, "h-11 text-base")} aria-label={`Call ${phone}`}>
              <Phone className="size-4" aria-hidden />
              <span className="hidden min-[400px]:inline">Call Now</span>
            </a>
          )}
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-accent md:hidden"
            aria-expanded={open}
            aria-controls="site-mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(value => !value)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="site-mobile-nav" aria-label="Main" className="border-t md:hidden">
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {sections.map(section => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 text-lg font-semibold hover:bg-accent"
                >
                  {section.label}
                </a>
              </li>
            ))}
            <li>
              <SignInLink label={signInLabel} onClick={onSignIn} className="px-3 py-3 text-lg" />
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

/* ---------------------------------- hero --------------------------------- */

function Hero({ page }: { page: SitePage }) {
  const hero = pageText(page, "hero.text");
  const image = pageImage(page, "hero.image");
  const { phone, phoneHref: tel, location } = contactDetails(page);
  if (!hero && !image) return null;

  return (
    <section className={cn("relative isolate overflow-hidden", !image && "bg-primary")}>
      {image && (
        <img
          src={image.url}
          srcSet={siteImageSrcSet(image.url)}
          sizes="100vw"
          alt={image.alt}
          className="absolute inset-0 -z-10 size-full object-cover"
        />
      )}
      {/* A scrim keeps the headline legible over whatever photo is chosen. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/80 via-black/60 to-black/25" />
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-36">
        {location && <p className="text-sm font-bold tracking-[0.2em] text-white/85 uppercase">{location}</p>}
        {hero?.title && <h1 className="mt-4 max-w-2xl text-5xl font-bold text-white sm:text-6xl">{hero.title}</h1>}
        {hero?.body && <Prose text={hero.body} className="mt-4 max-w-xl text-xl text-white/90 sm:text-2xl" />}
        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href="#contact"
            className="inline-flex h-12 items-center gap-2 rounded-md bg-white px-6 text-base font-semibold text-primary hover:bg-white/90"
          >
            Request an estimate <ArrowRight className="size-4" aria-hidden />
          </a>
          {tel && (
            <a
              href={tel}
              className="inline-flex h-12 items-center gap-2 rounded-md border border-white/70 px-6 text-base font-semibold text-white hover:bg-white/10"
            >
              <Phone className="size-4" aria-hidden /> {phone}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- about --------------------------------- */

function About({ page }: { page: SitePage }) {
  const about = pageText(page, "about.text");
  const timeline = pageTexts(page, "about.timeline");
  const note = pageText(page, "about.note");
  const image = pageImage(page, "about.image");
  if (!about) return null;

  return (
    <section id="about" aria-labelledby="about-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 md:py-24">
      <div className={cn("grid items-start gap-12", image && "lg:grid-cols-2")}>
        <div>
          <h2 id="about-heading" className="text-3xl font-bold sm:text-4xl">
            {about.title || "About Us"}
          </h2>
          {about.body && <Prose text={about.body} className="mt-6 max-w-prose text-xl leading-relaxed" />}

          {timeline.length > 0 && (
            <ol className="mt-10 space-y-8 border-l-2 border-brand-light/50 pl-6">
              {timeline.map(entry => (
                <li key={entry.id} className="relative">
                  <span className="absolute top-1.5 -left-[33px] size-4 rounded-full border-4 border-background bg-brand" />
                  {entry.title && <p className="text-sm font-bold tracking-wider text-brand uppercase">{entry.title}</p>}
                  <Prose text={entry.body} className="mt-1 max-w-prose text-lg" />
                </li>
              ))}
            </ol>
          )}

          {note?.body && (
            <div className="mt-10 max-w-prose rounded-lg bg-secondary p-5 text-lg">
              <Prose text={note.body} />
            </div>
          )}
        </div>

        {image && (
          <img
            src={image.url}
            srcSet={siteImageSrcSet(image.url)}
            sizes="(min-width: 1024px) 36rem, 100vw"
            alt={image.alt}
            loading="lazy"
            className="aspect-[4/3] w-full rounded-xl object-cover shadow-lg lg:sticky lg:top-28"
          />
        )}
      </div>
    </section>
  );
}

/* -------------------------------- services ------------------------------- */

function Services({ page }: { page: SitePage }) {
  const intro = pageText(page, "services.text");
  const services = pageTexts(page, "services.list");
  const images = pageImages(page, "services.images");
  if (!services.length) return null;

  return (
    <section id="services" aria-labelledby="services-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <h2 id="services-heading" className="text-3xl font-bold sm:text-4xl">
          {intro?.title || "Our Services"}
        </h2>
        {intro?.body && <Prose text={intro.body} className="mt-4 max-w-prose text-xl text-muted-foreground" />}

        <div className={cn("mt-10 grid gap-10", images.length > 0 && "lg:grid-cols-[1.3fr_1fr]")}>
          <ol className="space-y-6">
            {services.map((service, index) => (
              <li key={service.id} className="rounded-xl border bg-card p-6 sm:p-8">
                <p className="text-sm font-bold tracking-wider text-brand uppercase">{String(index + 1).padStart(2, "0")}</p>
                <h3 className="mt-1 text-2xl font-bold sm:text-3xl">{service.title}</h3>
                {service.body && <Prose text={service.body} className="mt-3 max-w-prose text-lg" />}
                {service.items.length > 0 && (
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {service.items.map(example => (
                      <li
                        key={example}
                        className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 font-semibold text-secondary-foreground"
                      >
                        <Check className="size-4 text-brand" aria-hidden />
                        {example}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>

          {images.length > 0 && (
            <div className="hidden gap-6 lg:grid lg:content-start">
              {images.map(image => (
                <img
                  key={image.id}
                  src={image.url}
                  srcSet={siteImageSrcSet(image.url)}
                  sizes="28rem"
                  alt={image.alt}
                  loading="lazy"
                  className="aspect-[3/2] w-full rounded-xl object-cover shadow-md"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------- projects ------------------------------- */

function Projects({ page }: { page: SitePage }) {
  const intro = pageText(page, "projects.text");
  const gallery = pageImages(page, "projects.gallery");
  const [active, setActive] = useState<number | null>(null);
  if (!gallery.length) return null;

  return (
    <section id="projects" aria-labelledby="projects-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <h2 id="projects-heading" className="text-3xl font-bold sm:text-4xl">
          {intro?.title || "Projects"}
        </h2>
        {intro?.body && <Prose text={intro.body} className="mt-4 max-w-prose text-xl text-muted-foreground" />}

        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {gallery.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActive(index)}
                className="group block w-full overflow-hidden rounded-xl border bg-card shadow-sm"
              >
                <img
                  src={image.url}
                  srcSet={siteImageSrcSet(image.url)}
                  sizes="(min-width: 640px) 36rem, 100vw"
                  alt={image.alt}
                  loading="lazy"
                  className="aspect-square w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.02]"
                />
                <span className="sr-only">View larger</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Lightbox images={gallery} active={active} onChange={setActive} />
    </section>
  );
}

/** A photo, large, over the page. Arrow keys step through; Escape closes. */
function Lightbox({
  images,
  active,
  onChange,
}: {
  images: SiteImage[];
  active: number | null;
  onChange: (index: number | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (active !== null && !dialog.open) dialog.showModal();
    if (active === null && dialog.open) dialog.close();
  }, [active]);

  const step = (delta: number) => active !== null && onChange((active + delta + images.length) % images.length);
  const image = active === null ? null : images[active];

  const control = "inline-flex size-12 items-center justify-center rounded-md bg-secondary text-secondary-foreground shadow hover:bg-accent";

  return (
    <dialog
      ref={ref}
      onClose={() => onChange(null)}
      onClick={event => event.target === event.currentTarget && onChange(null)}
      onKeyDown={event => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
      className="m-auto max-h-[95vh] max-w-[95vw] bg-transparent p-0 backdrop:bg-black/85"
    >
      {image && (
        <div className="relative">
          <img src={image.url} alt={image.alt} className="max-h-[90vh] w-auto rounded-lg" />
          <div className="absolute inset-x-0 top-0 flex justify-end p-2">
            <button type="button" className={control} aria-label="Close" onClick={() => onChange(null)}>
              <X className="size-5" />
            </button>
          </div>
          {images.length > 1 && (
            <>
              <div className="absolute inset-y-0 left-0 flex items-center p-2">
                <button type="button" className={control} aria-label="Previous photo" onClick={() => step(-1)}>
                  <ChevronLeft className="size-5" />
                </button>
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center p-2">
                <button type="button" className={control} aria-label="Next photo" onClick={() => step(1)}>
                  <ChevronRight className="size-5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}

/* --------------------------------- contact ------------------------------- */

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

const fieldClass =
  "h-12 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40";

function Contact({ page }: { page: SitePage }) {
  const intro = pageText(page, "contact.text");
  const areas = pageText(page, "contact.areas");
  const thanks = pageText(page, "contact.thanks");
  const { phone, phoneHref: tel, email, location } = contactDetails(page);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setStatus({ kind: "sending" });
    try {
      const fields = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]));
      await api.submitContact(fields);
      form.reset();
      setStatus({ kind: "sent" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Something went wrong. Please try again or give us a call.",
      });
    }
  }

  return (
    <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-20 bg-secondary">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 id="contact-heading" className="text-3xl font-bold sm:text-4xl">
            {intro?.title || "Contact Us"}
          </h2>
          {intro?.body && <Prose text={intro.body} className="mt-4 max-w-prose text-lg text-muted-foreground" />}
          <ul className="mt-8 space-y-5 text-lg">
            {location && (
              <ContactLine icon={<MapPin className="size-6 shrink-0 text-brand" aria-hidden />}>{location}</ContactLine>
            )}
            {email && (
              <ContactLine icon={<Mail className="size-6 shrink-0 text-brand" aria-hidden />}>
                <a href={`mailto:${email}`} className="font-semibold underline underline-offset-4 hover:text-brand">
                  {email}
                </a>
              </ContactLine>
            )}
            {phone && (
              <ContactLine icon={<Phone className="size-6 shrink-0 text-brand" aria-hidden />}>
                {tel ? (
                  <a href={tel} className="font-semibold underline underline-offset-4 hover:text-brand">
                    {phone}
                  </a>
                ) : (
                  phone
                )}
              </ContactLine>
            )}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
          {status.kind === "sent" ? (
            <div role="status" className="flex flex-col items-center gap-4 py-12 text-center">
              <CheckCircle2 className="size-12 text-brand" aria-hidden />
              <p className="font-[family-name:var(--font-display)] text-2xl font-bold">
                {thanks?.title || "Thanks for getting in touch!"}
              </p>
              {thanks?.body && <Prose text={thanks.body} className="text-muted-foreground" />}
              <button
                type="button"
                className="mt-2 rounded-md border bg-background px-4 py-2 font-semibold hover:bg-accent"
                onClick={() => setStatus({ kind: "idle" })}
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-5 sm:grid-cols-2">
              <TextField id="firstName" label="First name" required autoComplete="given-name" />
              <TextField id="lastName" label="Last name" required autoComplete="family-name" />
              <TextField id="email" label="Email" type="email" required autoComplete="email" />
              <TextField id="phone" label="Phone" type="tel" autoComplete="tel" />

              {areas && areas.items.length > 0 && (
                <div className="grid gap-2 sm:col-span-2">
                  <label htmlFor="area" className="text-base font-semibold">
                    {areas.title || "Area of house"}
                  </label>
                  <select id="area" name="area" defaultValue="" className={fieldClass}>
                    <option value="">Select an option</option>
                    {areas.items.map(area => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-2 sm:col-span-2">
                <label htmlFor="description" className="text-base font-semibold">
                  Description of services <span className="font-normal text-muted-foreground">(required)</span>
                </label>
                <textarea
                  id="description"
                  name="description"
                  required
                  rows={5}
                  maxLength={5000}
                  className={cn(fieldClass, "h-auto py-2")}
                />
              </div>

              {/* People never see this, so never fill it in. See CONTACT_HONEYPOT. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor={CONTACT_HONEYPOT}>Leave this empty</label>
                <input id={CONTACT_HONEYPOT} name={CONTACT_HONEYPOT} tabIndex={-1} autoComplete="off" />
              </div>

              {status.kind === "error" && (
                <p role="alert" className="font-semibold text-destructive sm:col-span-2">
                  {status.message}
                </p>
              )}

              <button
                type="submit"
                className={cn(solidButton, "h-12 text-base disabled:opacity-60 sm:col-span-2")}
                disabled={status.kind === "sending"}
              >
                {status.kind === "sending" ? "Sending…" : "Submit"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function ContactLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4">
      {icon}
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

function TextField({ id, label, required, ...props }: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-base font-semibold">
        {label} {required && <span className="font-normal text-muted-foreground">(required)</span>}
      </label>
      <input id={id} name={id} required={required} className={fieldClass} {...props} />
    </div>
  );
}

/* --------------------------------- footer -------------------------------- */

function SiteFooter({ page, signInLabel, onSignIn }: { page: SitePage; signInLabel: string; onSignIn: () => void }) {
  const brand = pageText(page, "brand.name");
  const { location } = contactDetails(page);
  const sections = sectionsOf(page);

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-[family-name:var(--font-display)] text-xl font-bold">{brand?.title}</p>
          <p className="text-primary-foreground/80">{[brand?.body, location].filter(Boolean).join(" · ")}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {sections.map(section => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="font-semibold underline-offset-4 hover:underline">
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-primary-foreground/15">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm text-primary-foreground/75 sm:px-6">
          <p>
            © {new Date().getFullYear()} {brand?.title}
          </p>
          <button type="button" onClick={onSignIn} className="inline-flex items-center gap-1.5 hover:text-primary-foreground hover:underline">
            <LogIn className="size-3.5" aria-hidden /> {signInLabel}
          </button>
        </div>
      </div>
    </footer>
  );
}
