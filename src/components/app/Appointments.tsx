import { useMemo, useState, type FormEvent } from "react";
import { CalendarCog, Copy, ExternalLink, Mail, MapPin, Phone, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  BOOKING_EMBED_PATH,
  BOOKING_LIMITS,
  STANDING_LABELS,
  WEEKDAYS,
  appointmentStanding,
  bookingEmbedSnippet,
  formatBookingTime,
  isTimeZone,
  zonedParts,
  formatBookingDate,
  type Appointment,
  type AppointmentStanding,
  type AppointmentState,
  type BookingSettings,
  type DayHours,
} from "@/lib/booking";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { EmptyState, Field, Notice, Section } from "./common";
import { useDirty, useFeedback, useUnsavedChanges } from "./feedback";

const STANDING_TONE: Record<AppointmentStanding, "info" | "pending" | "success" | "neutral" | "warn"> = {
  upcoming: "info",
  awaiting: "pending",
  completed: "success",
  cancelled: "neutral",
  no_show: "warn",
};

type Filter = "ahead" | "all";

/**
 * Visits booked from the public website, and the settings that decide when
 * they may be.
 *
 * "Ahead" is what still needs somebody: every visit still to come, plus any
 * that has happened with nobody saying how it went. Everything is shown on
 * the business's clock, whatever the browser's is — a 9am visit is at 9am on
 * site.
 */
export function AppointmentsTab({
  appointments,
  settings,
  onChange,
  onEditSettings,
  onError,
}: {
  appointments: Appointment[];
  settings: BookingSettings;
  onChange: (next: Appointment[]) => void;
  onEditSettings: () => void;
  onError: (error: unknown) => void;
}) {
  const { confirm, toast } = useFeedback();
  const [filter, setFilter] = useState<Filter>("ahead");
  const now = Date.now();

  const shown = useMemo(() => {
    if (filter === "all") return [...appointments].sort((a, b) => b.start.localeCompare(a.start));
    return appointments.filter(entry => ["upcoming", "awaiting"].includes(appointmentStanding(entry, now)));
  }, [appointments, filter, now]);

  async function setState(appointment: Appointment, state: AppointmentState) {
    if (
      state === "cancelled" &&
      !(await confirm({
        title: `Cancel ${appointment.firstName} ${appointment.lastName}'s visit?`,
        message: "The time goes back on the public calendar. Let them know — nothing here tells them.",
        confirmLabel: "Cancel the visit",
      }))
    ) {
      return;
    }
    try {
      const updated = await api.setAppointmentState(appointment.id, state);
      onChange(appointments.map(entry => (entry.id === updated.id ? updated : entry)));
    } catch (error) {
      onError(error);
    }
  }

  async function remove(appointment: Appointment) {
    if (!(await confirm(`Delete the visit with ${appointment.firstName} ${appointment.lastName}? It cannot be recovered.`))) return;
    try {
      await api.deleteAppointment(appointment.id);
      onChange(appointments.filter(entry => entry.id !== appointment.id));
    } catch (error) {
      onError(error);
    }
  }

  const snippet = bookingEmbedSnippet(window.location.origin);

  return (
    <div className="space-y-4">
      <Section
        title="Appointments"
        description={`Visits booked from the website, on ${settings.timezone.replace(/_/g, " ")} time.`}
        actions={
          <>
            <div role="tablist" aria-label="Which appointments" className="flex gap-1">
              {(
                [
                  ["ahead", "Ahead"],
                  ["all", "All"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filter === id}
                  onClick={() => setFilter(id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-sm transition-colors",
                    filter === id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={onEditSettings}>
              <CalendarCog /> Booking settings
            </Button>
          </>
        }
      >
        {!settings.enabled && (
          <Notice
            kind="info"
            className="m-3"
            lines={["Online booking is off, so the website shows no calendar. Switch it on in Booking settings once the hours are right."]}
          />
        )}
        {shown.length === 0 ? (
          <EmptyState title={filter === "ahead" ? "Nothing booked ahead" : "No appointments yet"}>
            When somebody books a visit on the website, it lands here.
          </EmptyState>
        ) : (
          <ul className="divide-y">
            {shown.map(appointment => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                zone={settings.timezone}
                standing={appointmentStanding(appointment, now)}
                onState={state => void setState(appointment, state)}
                onDelete={() => void remove(appointment)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Put the calendar on another website"
        description="The website already shows it. To add it to a different site too, paste this where the calendar should go."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={BOOKING_EMBED_PATH} target="_blank" rel="noreferrer">
                <ExternalLink /> Preview
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void copyText(snippet).then(
                  () => toast("success", "The embed code is copied."),
                  error => onError(error),
                )
              }
            >
              <Copy /> Copy
            </Button>
          </>
        }
      >
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground">{snippet}</pre>
      </Section>
    </div>
  );
}

function AppointmentRow({
  appointment,
  zone,
  standing,
  onState,
  onDelete,
}: {
  appointment: Appointment;
  zone: string;
  standing: AppointmentStanding;
  onState: (state: AppointmentState) => void;
  onDelete: () => void;
}) {
  const local = zonedParts(Date.parse(appointment.start), zone);
  const open = appointment.state === "booked";

  return (
    <li className={cn("space-y-2 px-4 py-3", !open && "opacity-75")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-display font-semibold tabular-nums">
          {formatBookingDate(local.date, undefined, "short")} · {formatBookingTime(appointment.start, zone)}–
          {formatBookingTime(appointment.end, zone)}
        </p>
        <p className="font-medium">
          {appointment.firstName} {appointment.lastName}
        </p>
        <Badge tone={STANDING_TONE[standing]}>{STANDING_LABELS[standing]}</Badge>
        <div className="ml-auto flex flex-wrap gap-1">
          {open ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onState("completed")}>
                Completed
              </Button>
              {standing === "awaiting" && (
                <Button variant="ghost" size="sm" onClick={() => onState("no_show")}>
                  No-show
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onState("cancelled")}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onState("booked")}>
              Reopen
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={`tel:${appointment.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline">
          <Phone className="size-3.5" /> {appointment.phone}
        </a>
        <a href={`mailto:${appointment.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
          <Mail className="size-3.5" /> {appointment.email}
        </a>
        {appointment.address && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appointment.address)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <MapPin className="size-3.5" /> {appointment.address}
          </a>
        )}
      </div>
      {appointment.notes && <p className="text-sm whitespace-pre-line text-foreground/90">{appointment.notes}</p>}
    </li>
  );
}

/* --------------------------------- settings -------------------------------- */

/** Every zone the browser knows, for the picker; free typing still works. */
const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return [];
  }
})();

export function BookingSettingsEditor({
  settings,
  onClose,
  onSaved,
  onError,
}: {
  settings: BookingSettings;
  onClose: () => void;
  onSaved: (saved: BookingSettings) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState<BookingSettings>(settings);
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) => setDraft(current => ({ ...current, [key]: value }));
  const setDay = (day: number, patch: Partial<DayHours>) =>
    set(
      "hours",
      draft.hours.map((entry, index) => (index === day ? { ...entry, ...patch } : entry)),
    );

  const problems = [
    ...(isTimeZone(draft.timezone) ? [] : [`“${draft.timezone}” is not a time zone. Pick one from the list.`]),
    ...draft.hours.flatMap((entry, day) => (entry.open && entry.start >= entry.end ? [`${WEEKDAYS[day]} closes before it opens.`] : [])),
  ];
  const openDays = draft.hours.filter(entry => entry.open).length;

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (problems.length) return;
    setBusy(true);
    try {
      await onSaved(await api.saveBookingSettings(draft));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  function addClosed() {
    if (!closing || draft.closedDates.includes(closing)) return;
    set("closedDates", [...draft.closedDates, closing].sort());
    setClosing("");
  }

  const { dirty } = useDirty(draft);
  const close = useUnsavedChanges(dirty, onClose);
  const number = (key: "durationMinutes" | "bufferMinutes" | "noticeHours" | "horizonDays") => ({
    type: "number",
    min: BOOKING_LIMITS[key].min,
    max: BOOKING_LIMITS[key].max,
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(key, Number(event.target.value)),
  });

  return (
    <Sheet
      title="Booking settings"
      description="When visitors to the website may book a visit."
      onClose={() => void close()}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || problems.length > 0}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="grid gap-4 @md:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 @md:col-span-2">
          <span>
            <span className="block text-sm font-medium">Take bookings on the website</span>
            <span className="block text-xs text-muted-foreground">
              {draft.enabled ? "The calendar is on the website." : "Off: the website shows no calendar."}
            </span>
          </span>
          <Switch checked={draft.enabled} onChange={event => set("enabled", event.target.checked)} />
        </label>

        <Field label="What is being booked" className="@md:col-span-2">
          <Input value={draft.title} maxLength={BOOKING_LIMITS.title} onChange={event => set("title", event.target.value)} />
        </Field>
        <Field label="Description" hint="Shown beside the calendar. **Bold** works." className="@md:col-span-2">
          <Textarea
            value={draft.description}
            rows={3}
            maxLength={BOOKING_LIMITS.description}
            onChange={event => set("description", event.target.value)}
          />
        </Field>

        <Field label="Time zone" hint="The hours below are on this clock." className="@md:col-span-2">
          <Input list="booking-zones" value={draft.timezone} onChange={event => set("timezone", event.target.value.trim())} />
          <datalist id="booking-zones">
            {TIME_ZONES.map(zone => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Field>

        <Field label="Visit length (minutes)">
          <Input {...number("durationMinutes")} step={15} />
        </Field>
        <Field label="Buffer between visits (minutes)" hint="Travel, and the visit that runs long.">
          <Input {...number("bufferMinutes")} step={15} />
        </Field>
        <Field label="Notice (hours)" hint="How far ahead a visit must be booked.">
          <Input {...number("noticeHours")} />
        </Field>
        <Field label="Calendar reaches (days)" hint="How far ahead visitors can book.">
          <Input {...number("horizonDays")} />
        </Field>

        <fieldset className="space-y-2 @md:col-span-2">
          <legend className="text-xs text-muted-foreground">Weekly hours — a visit must end by closing time</legend>
          <ul className="divide-y rounded-md border">
            {draft.hours.map((entry, day) => (
              <li key={WEEKDAYS[day]} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Switch
                  checked={entry.open}
                  aria-label={`Open on ${WEEKDAYS[day]}`}
                  onChange={event => setDay(day, { open: event.target.checked })}
                />
                <span className={cn("w-24 text-sm", !entry.open && "text-muted-foreground")}>{WEEKDAYS[day]}</span>
                {entry.open ? (
                  <span className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${WEEKDAYS[day]} opens`}
                      value={entry.start}
                      onChange={event => setDay(day, { start: event.target.value })}
                      className="w-32"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="time"
                      aria-label={`${WEEKDAYS[day]} closes`}
                      value={entry.end}
                      onChange={event => setDay(day, { end: event.target.value })}
                      className="w-32"
                    />
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </li>
            ))}
          </ul>
        </fieldset>

        <Field label="Closed days" hint="Holidays, a week away — no visits at all on these." className="@md:col-span-2">
          <div className="flex gap-2">
            <Input type="date" value={closing} onChange={event => setClosing(event.target.value)} className="w-44" />
            <Button type="button" variant="outline" onClick={addClosed} disabled={!closing}>
              <Plus /> Add
            </Button>
          </div>
          {draft.closedDates.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {draft.closedDates.map(date => (
                <li key={date}>
                  <Badge tone="outline" className="gap-1 pr-1">
                    {formatBookingDate(date, undefined, "short")}
                    <button
                      type="button"
                      aria-label={`Open again on ${date}`}
                      onClick={() =>
                        set(
                          "closedDates",
                          draft.closedDates.filter(entry => entry !== date),
                        )
                      }
                      className="rounded-sm hover:bg-accent"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <Notice
          kind="warning"
          className="@md:col-span-2"
          lines={[...problems, ...(draft.enabled && openDays === 0 ? ["Booking is on, but no day is open — the calendar will be empty."] : [])]}
        />
      </form>
    </Sheet>
  );
}
