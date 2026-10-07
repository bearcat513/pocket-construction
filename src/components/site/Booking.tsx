import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarCheck, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock, Phone } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import {
  BOOKING_HEIGHT_MESSAGE,
  BOOKING_HONEYPOT,
  MAX_BOOKING_NOTES,
  appointmentIcs,
  formatBookingDate,
  formatBookingTime,
  zoneName,
  type BookingAvailability,
  type BookingConfirmation,
  type BookingSlot,
} from "@/lib/booking";
import { phoneHref } from "@/lib/site";
import { cn } from "@/lib/utils";
import { fieldClass, solidButton, useSiteFonts } from "./parts";

type Step = { kind: "pick" } | { kind: "details"; slot: BookingSlot } | { kind: "done"; confirmation: BookingConfirmation };

/**
 * The public booking calendar: pick a day, pick a time, say who you are.
 *
 * Everything it offers comes from `GET /api/site/booking`, which runs the
 * same `availableDays` the server checks a booking against, so a time shown
 * here is a time the server will take — unless somebody else takes it first,
 * in which case the server says so, the calendar reloads, and the visitor is
 * put back on the times that are still free.
 *
 * Times are shown on the business's clock, and the zone is named whenever the
 * visitor's own is different: a visit happens where the job is.
 */
export function BookingWidget({
  availability: initial,
  phone,
  onChange,
  heading = false,
}: {
  /** Already loaded by the page; the widget loads it itself when not. */
  availability?: BookingAvailability | null;
  /** Offered as the way out when nothing is free. */
  phone?: string;
  /** Called after anything that may change the widget's height. */
  onChange?: () => void;
  /** Title the calendar itself — when it is the whole page, at /book. */
  heading?: boolean;
}) {
  const [availability, setAvailability] = useState<BookingAvailability | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [date, setDate] = useState("");
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const reload = useCallback(async () => {
    try {
      setAvailability(await api.bookingAvailability());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (initial) setAvailability(initial);
    else void reload();
  }, [initial, reload]);

  const days = availability?.days ?? [];
  const settings = availability?.settings;
  const day = days.find(entry => entry.date === date) ?? days[0];

  useEffect(() => onChange?.(), [onChange, step, day, problem, availability, failed]);

  useEffect(() => {
    if (heading && settings?.title) document.title = settings.title;
  }, [heading, settings?.title]);

  if (!availability) {
    return failed ? (
      <p className="text-lg text-muted-foreground">The calendar could not be loaded just now. Please try again shortly.</p>
    ) : (
      <p className="text-muted-foreground" role="status">
        Loading available times…
      </p>
    );
  }

  const zone = settings!.timezone;
  const tel = phone ? phoneHref(phone) : "";
  const title = heading && <h1 className="text-2xl font-bold sm:text-3xl">{settings!.title}</h1>;

  if (!settings!.enabled || !days.length) {
    return (
      <div className="flex flex-col items-start gap-3">
        {title}
        <p className="text-lg">
          {settings!.enabled ? "Every time we have is taken for now." : "Online booking is not open just now."}
        </p>
        {tel && (
          <a href={tel} className={cn(solidButton, "h-12 text-base")}>
            <Phone className="size-4" aria-hidden /> Call {phone}
          </a>
        )}
      </div>
    );
  }

  if (step.kind === "done") {
    return (
      <>
        {title}
        <Booked confirmation={step.confirmation} title={settings!.title} zone={zone} onAnother={() => setStep({ kind: "pick" })} />
      </>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>, slot: BookingSlot) {
    event.preventDefault();
    setSending(true);
    setProblem("");
    try {
      const fields = Object.fromEntries([...new FormData(event.currentTarget)].map(([key, value]) => [key, String(value)]));
      const confirmation = await api.bookAppointment({ ...fields, start: slot.start });
      setStep({ kind: "done", confirmation });
      void reload();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The booking could not be made. Please try again or give us a call.");
      // Taken in the meantime: show what is still free, rather than a form for a time that is gone.
      if (error instanceof ApiError && error.status === 409) {
        setStep({ kind: "pick" });
        await reload();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      {title}
      {step.kind === "pick" ? (
        <>
          <DayStrip days={days.map(entry => entry.date)} selected={day!.date} onSelect={setDate} />
          <fieldset>
            <legend className="text-base font-semibold">{formatBookingDate(day!.date)}</legend>
            <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
              {day!.slots.map(slot => (
                <li key={slot.start}>
                  <button
                    type="button"
                    onClick={() => {
                      setProblem("");
                      setStep({ kind: "details", slot });
                    }}
                    className="h-12 w-full rounded-md border border-input bg-card font-semibold transition-colors hover:border-brand hover:bg-secondary"
                  >
                    {formatBookingTime(slot.start, zone)}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          <ZoneNote zone={zone} at={Date.parse(day!.slots[0]!.start)} minutes={settings!.durationMinutes} />
        </>
      ) : (
        <form onSubmit={event => void submit(event, step.slot)} className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary p-4 sm:col-span-2">
            <p className="flex items-center gap-3 text-lg font-semibold">
              <CalendarCheck className="size-6 shrink-0 text-brand" aria-hidden />
              <span>
                {formatBookingDate(day!.date)}, {formatBookingTime(step.slot.start, zone)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setStep({ kind: "pick" })}
              className="font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Change time
            </button>
          </div>

          <BookingField id="firstName" label="First name" required autoComplete="given-name" />
          <BookingField id="lastName" label="Last name" required autoComplete="family-name" />
          <BookingField id="email" label="Email" type="email" required autoComplete="email" />
          <BookingField id="phone" label="Phone" type="tel" required autoComplete="tel" />
          <BookingField id="address" label="Address of the job" autoComplete="street-address" className="sm:col-span-2" />

          <div className="grid gap-2 sm:col-span-2">
            <label htmlFor="booking-notes" className="text-base font-semibold">
              Anything we should know?
            </label>
            <textarea id="booking-notes" name="notes" rows={4} maxLength={MAX_BOOKING_NOTES} className={cn(fieldClass, "h-auto py-2")} />
          </div>

          {/* People never see this, so never fill it in. See BOOKING_HONEYPOT. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor={`booking-${BOOKING_HONEYPOT}`}>Leave this empty</label>
            <input id={`booking-${BOOKING_HONEYPOT}`} name={BOOKING_HONEYPOT} tabIndex={-1} autoComplete="off" />
          </div>

          {problem && (
            <p role="alert" className="font-semibold text-destructive sm:col-span-2">
              {problem}
            </p>
          )}

          <button type="submit" className={cn(solidButton, "h-12 text-base disabled:opacity-60 sm:col-span-2")} disabled={sending}>
            {sending ? "Booking…" : "Book this time"}
          </button>
        </form>
      )}

      {step.kind === "pick" && problem && (
        <p role="alert" className="font-semibold text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The bookable days, a week's width at a time, scrolled rather than paged. */
function DayStrip({ days, selected, onSelect }: { days: string[]; selected: string; onSelect: (date: string) => void }) {
  const strip = useRef<HTMLUListElement>(null);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * 0.8, behavior: "smooth" });
  const arrow = "hidden size-12 shrink-0 items-center justify-center rounded-md border bg-card hover:bg-secondary sm:inline-flex";

  return (
    <div className="flex items-center gap-2">
      <button type="button" className={arrow} aria-label="Earlier days" onClick={() => scroll(-1)}>
        <ChevronLeft className="size-5" />
      </button>
      <ul ref={strip} aria-label="Days with open times" className="flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-1">
        {days.map(date => {
          const active = date === selected;
          const [weekday, month, dayOfMonth] = [
            new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short" }),
            new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "short" }),
            new Intl.DateTimeFormat(undefined, { timeZone: "UTC", day: "numeric" }),
          ].map(format => format.format(new Date(`${date}T12:00:00Z`)));
          return (
            <li key={date} className="snap-start">
              <button
                type="button"
                aria-pressed={active}
                aria-label={formatBookingDate(date)}
                onClick={() => onSelect(date)}
                className={cn(
                  "flex w-[4.5rem] flex-col items-center rounded-md border px-2 py-2 leading-tight transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary",
                )}
              >
                <span className="text-xs font-semibold tracking-wider uppercase">{weekday}</span>
                <span className="font-[family-name:var(--font-display)] text-2xl font-bold">{dayOfMonth}</span>
                <span className="text-xs">{month}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className={arrow} aria-label="Later days" onClick={() => scroll(1)}>
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}

/** How long a visit is, and — when it differs from the reader's — whose clock the times are on. */
function ZoneNote({ zone, at, minutes }: { zone: string; at: number; minutes: number }) {
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <Clock className="size-4 shrink-0" aria-hidden />
      <span>
        Visits take about {minutes} minutes.
        {mine !== zone && ` Times are in ${zoneName(zone, at)}.`}
      </span>
    </p>
  );
}

function Booked({
  confirmation,
  title,
  zone,
  onAnother,
}: {
  confirmation: BookingConfirmation;
  title: string;
  zone: string;
  onAnother: () => void;
}) {
  const ics = useMemo(() => {
    const body = appointmentIcs({ id: confirmation.id, start: confirmation.start, end: confirmation.end, title });
    return URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  }, [confirmation, title]);
  useEffect(() => () => URL.revokeObjectURL(ics), [ics]);

  const when = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(confirmation.start));

  return (
    <div role="status" className="flex flex-col items-center gap-4 py-8 text-center">
      <CheckCircle2 className="size-12 text-brand" aria-hidden />
      <p className="font-[family-name:var(--font-display)] text-2xl font-bold">You’re booked</p>
      <p className="text-lg">
        {title} — <strong>{when}</strong>
      </p>
      <p className="text-muted-foreground">We’ll be in touch beforehand to confirm the details.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <a href={ics} download="appointment.ics" className={cn(solidButton, "h-11 text-base")}>
          <CalendarPlus className="size-4" aria-hidden /> Add to my calendar
        </a>
        <button type="button" className="rounded-md border bg-background px-4 py-2 font-semibold hover:bg-accent" onClick={onAnother}>
          Book another time
        </button>
      </div>
    </div>
  );
}

function BookingField({
  id,
  label,
  required,
  className,
  ...props
}: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className={cn("grid gap-2", className)}>
      <label htmlFor={`booking-${id}`} className="text-base font-semibold">
        {label} {required && <span className="font-normal text-muted-foreground">(required)</span>}
      </label>
      <input id={`booking-${id}`} name={id} required={required} className={fieldClass} {...props} />
    </div>
  );
}

/**
 * The calendar on its own, at /book — for an iframe on somebody else's
 * website. It tells its parent how tall it is whenever that changes, which is
 * what the snippet from `bookingEmbedSnippet` listens for.
 */
export function BookingEmbed() {
  useSiteFonts();
  const root = useRef<HTMLDivElement>(null);

  const report = useCallback(() => {
    if (!root.current || window.parent === window) return;
    // Only a height, so any parent may read it; the snippet checks the origin it came from.
    window.parent.postMessage({ type: BOOKING_HEIGHT_MESSAGE, height: Math.ceil(root.current.scrollHeight) }, "*");
  }, []);

  // The whole document is the calendar here, so it wears the site's paper
  // rather than the app's ground below the last row.
  useEffect(() => {
    document.body.classList.add("site");
    return () => document.body.classList.remove("site");
  }, []);

  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(report);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [report]);

  return (
    <div ref={root} className="site p-4 sm:p-6">
      <BookingWidget heading onChange={report} />
    </div>
  );
}
