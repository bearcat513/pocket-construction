import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Mail, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox, siteContentOptions } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  MAX_SITE_IMAGE_BYTES,
  SITE_IMAGE_TYPES,
  SITE_SECTIONS,
  SITE_SLOTS,
  slotDefinition,
  type ContactRequest,
  type ContactRequestStatus,
  type SiteContent,
  type SiteImage,
  type SiteText,
  type SlotDefinition,
} from "@/lib/site";
import type { Appointment, BookingSettings } from "@/lib/booking";
import { cn } from "@/lib/utils";
import { AppointmentsTab, BookingSettingsEditor } from "./Appointments";
import { EmptyState, Field, Notice, Section } from "./common";
import { useDirty, useFeedback, useUnsavedChanges } from "./feedback";

type Tab = "layout" | "texts" | "images" | "requests" | "appointments";

type Props = {
  onError: (error: unknown) => void;
  onNotice: (lines: string[]) => void;
};

/** The ids in one slot, in order. */
const slotIds = (content: SiteContent, slot: SlotDefinition): string[] =>
  content.placements
    .filter(placement => placement.slot === slot.key)
    .sort((a, b) => a.position - b.position)
    .map(placement => (slot.kind === "text" ? placement.textId : placement.imageId))
    .filter(Boolean);

/** Where each text or image appears, for the "used in" column. */
function usage(content: SiteContent): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const placement of content.placements) {
    const slot = slotDefinition(placement.slot);
    if (!slot) continue;
    const id = slot.kind === "text" ? placement.textId : placement.imageId;
    if (!id) continue;
    const where = `${slot.section} · ${slot.label}`;
    used.set(id, [...new Set([...(used.get(id) ?? []), where])]);
  }
  return used;
}

/**
 * The public website, from the inside.
 *
 * Four tabs over four collections: the layout is the website config (which
 * text or picture is in which slot), and the texts and images are the content
 * it points at — edited once, shown wherever they are placed. Enquiries are
 * what the contact form has received, and appointments are the visits booked
 * from the calendar on the page.
 *
 * Only an account with `siteEditor` is shown this, and PocketBase refuses
 * anyone else's writes regardless.
 */
export function WebsiteView({ onError, onNotice }: Props) {
  const { confirm } = useFeedback();
  const [tab, setTab] = useState<Tab>("layout");
  const [content, setContent] = useState<SiteContent | null>(null);
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [booking, setBooking] = useState<BookingSettings | null>(null);
  const [editingBooking, setEditingBooking] = useState(false);

  const [editingSlot, setEditingSlot] = useState<SlotDefinition | null>(null);
  const [editingText, setEditingText] = useState<SiteText | null | undefined>(undefined);
  const [editingImage, setEditingImage] = useState<SiteImage | null | undefined>(undefined);

  const load = useCallback(async () => {
    const [nextContent, nextRequests, nextAppointments, availability] = await Promise.all([
      api.siteContent(),
      api.contactRequests(),
      api.appointments(),
      api.bookingAvailability(),
    ]);
    setContent(nextContent);
    setRequests(nextRequests);
    setAppointments(nextAppointments);
    setBooking(availability.settings);
  }, []);

  useEffect(() => {
    void load().catch(onError);
  }, [load, onError]);

  const used = useMemo(() => (content ? usage(content) : new Map<string, string[]>()), [content]);
  const unread = requests.filter(request => request.status === "new").length;
  // What still needs somebody: a visit still booked is either to come, or
  // over with nobody having said how it went.
  const ahead = appointments.filter(entry => entry.state === "booked").length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "layout", label: "Layout" },
    { id: "texts", label: "Texts", count: content?.texts.length },
    { id: "images", label: "Images", count: content?.images.length },
    { id: "requests", label: "Enquiries", count: unread || undefined },
    { id: "appointments", label: "Appointments", count: ahead || undefined },
  ];

  async function removeText(text: SiteText) {
    const where = used.get(text.id);
    const warning = where?.length ? ` It is on the page in: ${where.join(", ")}.` : "";
    if (!(await confirm({ title: `Delete “${text.name}”?`, message: `This text is removed from the website.${warning}` }))) return;
    try {
      await api.deleteSiteText(text.id);
      await load();
    } catch (error) {
      onError(error);
    }
  }

  async function removeImage(image: SiteImage) {
    const where = used.get(image.id);
    const warning = where?.length ? ` It is on the page in: ${where.join(", ")}.` : "";
    if (!(await confirm({ title: `Delete “${image.name}”?`, message: `This picture is removed from the website.${warning}` }))) return;
    try {
      await api.deleteSiteImage(image.id);
      await load();
    } catch (error) {
      onError(error);
    }
  }

  async function setStatus(request: ContactRequest, status: ContactRequestStatus) {
    try {
      const updated = await api.setContactRequestStatus(request.id, status);
      setRequests(list => list.map(entry => (entry.id === updated.id ? updated : entry)));
    } catch (error) {
      onError(error);
    }
  }

  async function removeRequest(request: ContactRequest) {
    if (!(await confirm(`Delete the enquiry from ${request.firstName} ${request.lastName}? It cannot be recovered.`))) return;
    try {
      await api.deleteContactRequest(request.id);
      setRequests(list => list.filter(entry => entry.id !== request.id));
    } catch (error) {
      onError(error);
    }
  }

  return (
    <div className="space-y-4">
      <Section
        title="Website"
        description="The page visitors see before they sign in — what it says, which pictures it shows, and where."
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href="/site" target="_blank" rel="noreferrer">
              <ExternalLink /> View the website
            </a>
          </Button>
        }
      >
        <div role="tablist" aria-label="Website" className="flex gap-1 overflow-x-auto px-3 py-2">
          {tabs.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                tab === entry.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {entry.label}
              {entry.count !== undefined && (
                <Badge tone={entry.id === "requests" || entry.id === "appointments" ? "pending" : "neutral"}>{entry.count}</Badge>
              )}
            </button>
          ))}
        </div>
      </Section>

      {!content ? (
        <p className="px-1 text-sm text-muted-foreground">Loading…</p>
      ) : tab === "layout" ? (
        <LayoutTab content={content} onEdit={setEditingSlot} />
      ) : tab === "texts" ? (
        <Section
          title="Texts"
          description="Words, written once and shown wherever the layout puts them."
          actions={
            <Button size="sm" onClick={() => setEditingText(null)}>
              <Plus /> New text
            </Button>
          }
        >
          {content.texts.length === 0 ? (
            <EmptyState title="No texts yet" />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Reads</Th>
                  <Th>On the page</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {content.texts.map(text => (
                  <Tr key={text.id}>
                    <Td className="font-medium">{text.name}</Td>
                    <Td className="max-w-[28rem] truncate text-muted-foreground">
                      {[text.title, text.body, text.items.join(", ")].filter(Boolean).join(" — ")}
                    </Td>
                    <Td>
                      <UsedIn where={used.get(text.id)} />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${text.name}`} onClick={() => setEditingText(text)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${text.name}`} onClick={() => void removeText(text)}>
                        <Trash2 />
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </Section>
      ) : tab === "images" ? (
        <Section
          title="Images"
          description="Pictures, uploaded once and shown wherever the layout puts them."
          actions={
            <Button size="sm" onClick={() => setEditingImage(null)}>
              <ImagePlus /> Upload image
            </Button>
          }
        >
          {content.images.length === 0 ? (
            <EmptyState title="No images yet" />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 p-3">
              {content.images.map(image => (
                <li key={image.id} className="overflow-hidden rounded-md border bg-card">
                  <img src={`${image.url}?thumb=480x0`} alt={image.alt} loading="lazy" className="aspect-[4/3] w-full bg-muted object-cover" />
                  <div className="space-y-1 p-2">
                    <div className="flex items-start justify-between gap-1">
                      <p className="min-w-0 truncate text-sm font-medium">{image.name}</p>
                      <div className="flex shrink-0">
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${image.name}`} onClick={() => setEditingImage(image)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${image.name}`} onClick={() => void removeImage(image)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <UsedIn where={used.get(image.id)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : tab === "appointments" ? (
        booking && (
          <AppointmentsTab
            appointments={appointments}
            settings={booking}
            onChange={setAppointments}
            onEditSettings={() => setEditingBooking(true)}
            onError={onError}
          />
        )
      ) : (
        <Section title="Enquiries" description="What the contact form has received, newest first.">
          {requests.length === 0 ? (
            <EmptyState title="Nothing yet">When somebody fills in the contact form, it lands here.</EmptyState>
          ) : (
            <ul className="divide-y">
              {requests.map(request => (
                <ContactRequestRow
                  key={request.id}
                  request={request}
                  onStatus={status => void setStatus(request, status)}
                  onDelete={() => void removeRequest(request)}
                />
              ))}
            </ul>
          )}
        </Section>
      )}

      {editingSlot && content && (
        <SlotEditor
          slot={editingSlot}
          content={content}
          onClose={() => setEditingSlot(null)}
          onSaved={async () => {
            setEditingSlot(null);
            await load().catch(onError);
          }}
          onError={onError}
        />
      )}

      {editingText !== undefined && (
        <SiteTextEditor
          text={editingText}
          onClose={() => setEditingText(undefined)}
          onSaved={async saved => {
            setEditingText(undefined);
            await load().catch(onError);
            if (!used.get(saved.id)?.length) onNotice([`“${saved.name}” is saved. Put it on the page from the Layout tab.`]);
          }}
          onError={onError}
        />
      )}

      {editingBooking && booking && (
        <BookingSettingsEditor
          settings={booking}
          onClose={() => setEditingBooking(false)}
          onSaved={saved => {
            setEditingBooking(false);
            setBooking(saved);
            onNotice([saved.enabled ? "Booking settings saved. The calendar is on the website." : "Booking settings saved. Booking is off."]);
          }}
          onError={onError}
        />
      )}

      {editingImage !== undefined && (
        <SiteImageEditor
          image={editingImage}
          onClose={() => setEditingImage(undefined)}
          onSaved={async saved => {
            setEditingImage(undefined);
            await load().catch(onError);
            if (!used.get(saved.id)?.length) onNotice([`“${saved.name}” is uploaded. Put it on the page from the Layout tab.`]);
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function UsedIn({ where }: { where?: string[] }) {
  if (!where?.length) return <Badge tone="outline">not on the page</Badge>;
  return <p className="text-xs text-muted-foreground">{where.join(", ")}</p>;
}

/* --------------------------------- layout -------------------------------- */

function LayoutTab({ content, onEdit }: { content: SiteContent; onEdit: (slot: SlotDefinition) => void }) {
  const texts = new Map(content.texts.map(text => [text.id, text]));
  const images = new Map(content.images.map(image => [image.id, image]));

  return (
    <>
      {SITE_SECTIONS.map(section => (
        <Section key={section} title={section}>
          <ul className="divide-y">
            {SITE_SLOTS.filter(slot => slot.section === section).map(slot => {
              const ids = slotIds(content, slot);
              return (
                <li key={slot.key} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="w-full min-w-0 sm:w-56 sm:shrink-0">
                    <p className="text-sm font-medium">
                      {slot.label}
                      {slot.many && <span className="ml-1.5 text-xs font-normal text-muted-foreground">list</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{slot.hint}</p>
                  </div>

                  <div className="min-w-0 flex-1">
                    {ids.length === 0 ? (
                      <Badge tone="outline">empty — hidden on the page</Badge>
                    ) : slot.kind === "image" ? (
                      <div className="flex flex-wrap gap-2">
                        {ids.map(id => {
                          const image = images.get(id);
                          return image ? (
                            <img
                              key={id}
                              src={`${image.url}?thumb=480x0`}
                              alt={image.alt}
                              title={image.name}
                              className="h-14 w-20 rounded-sm border bg-muted object-cover"
                            />
                          ) : null;
                        })}
                      </div>
                    ) : (
                      <ol className="space-y-0.5 text-sm">
                        {ids.map(id => {
                          const text = texts.get(id);
                          return text ? (
                            <li key={id} className="truncate">
                              <span className="font-medium">{text.name}</span>
                              {(text.title || text.body) && (
                                <span className="text-muted-foreground"> — {text.title || text.body}</span>
                              )}
                            </li>
                          ) : null;
                        })}
                      </ol>
                    )}
                  </div>

                  <Button variant="outline" size="sm" onClick={() => onEdit(slot)}>
                    <Pencil /> Change
                  </Button>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </>
  );
}

/**
 * What one slot holds. A single slot is one picker; a list is an ordered list
 * with a picker to add to it. Saving replaces the slot's placements in order.
 */
export function SlotEditor({
  slot,
  content,
  onClose,
  onSaved,
  onError,
}: {
  slot: SlotDefinition;
  content: SiteContent;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [ids, setIds] = useState(() => slotIds(content, slot));
  const [busy, setBusy] = useState(false);

  const entries: { id: string; name: string; title?: string; alt?: string }[] =
    slot.kind === "text" ? content.texts : content.images;
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const what = slot.kind === "text" ? "text" : "image";

  const move = (index: number, delta: number) =>
    setIds(list => {
      const next = [...list];
      const [moved] = next.splice(index, 1);
      next.splice(index + delta, 0, moved!);
      return next;
    });

  async function save() {
    setBusy(true);
    try {
      await api.setSiteSlot(slot.key, ids);
      await onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const { dirty } = useDirty(ids);
  const close = useUnsavedChanges(dirty, onClose);

  return (
    <Sheet
      title={`${slot.section} · ${slot.label}`}
      description={slot.hint}
      onClose={() => void close()}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!slot.many ? (
          <Field label={`Which ${what}`} hint="Choose nothing to hide this part of the page.">
            <Combobox
              value={ids[0] ?? ""}
              onChange={id => setIds(id ? [id] : [])}
              options={siteContentOptions(entries)}
              emptyLabel="Nothing — hide it"
              placeholder="Nothing — hide it"
              aria-label={`${slot.label}: which ${what}`}
            />
          </Field>
        ) : (
          <>
            {ids.length === 0 ? (
              <Notice kind="info" lines={[`Nothing here yet, so this part of the page is hidden.`]} />
            ) : (
              <ol className="space-y-1.5">
                {ids.map((id, index) => {
                  const entry = byId.get(id);
                  const image = slot.kind === "image" ? content.images.find(candidate => candidate.id === id) : undefined;
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5">
                      <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{index + 1}</span>
                      {image && (
                        <img src={`${image.url}?thumb=480x0`} alt="" className="h-9 w-12 rounded-sm bg-muted object-cover" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{entry?.name ?? id}</span>
                      <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move down"
                        disabled={index === ids.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Take it off the page"
                        onClick={() => setIds(list => list.filter(other => other !== id))}
                      >
                        <X />
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}

            <Field label={`Add a ${what}`}>
              <Combobox
                value=""
                onChange={id => id && setIds(list => [...list, id])}
                options={siteContentOptions(entries, ids)}
                placeholder={`Choose a ${what} to add…`}
                aria-label={`Add a ${what} to ${slot.label}`}
              />
            </Field>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          New {what}s are made on the {slot.kind === "text" ? "Texts" : "Images"} tab, then placed here.
        </p>
      </div>
    </Sheet>
  );
}

/* ---------------------------------- texts -------------------------------- */

export function SiteTextEditor({
  text,
  onClose,
  onSaved,
  onError,
}: {
  text: SiteText | null;
  onClose: () => void;
  onSaved: (saved: SiteText) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(text?.name ?? "");
  const [title, setTitle] = useState(text?.title ?? "");
  const [body, setBody] = useState(text?.body ?? "");
  const [items, setItems] = useState(text?.items.join("\n") ?? "");
  const [busy, setBusy] = useState(false);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    try {
      const payload = { name, title, body, items: items.split("\n") };
      await onSaved(text ? await api.updateSiteText(text.id, payload) : await api.createSiteText(payload));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const { dirty } = useDirty({ name, title, body, items });
  const close = useUnsavedChanges(dirty, onClose);

  return (
    <Sheet
      title={text ? `Edit “${text.name}”` : "New text"}
      description="What each part means depends on the slot it is placed in."
      onClose={() => void close()}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="grid gap-3 @md:grid-cols-2">
        <Field label="Name" hint="For you — never shown on the page." className="@md:col-span-2">
          <Input value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Service: kitchens" />
        </Field>
        <Field label="Title" className="@md:col-span-2">
          <Input value={title} onChange={event => setTitle(event.target.value)} maxLength={300} />
        </Field>
        <Field label="Body" hint="A blank line starts a new paragraph. **Bold** works." className="@md:col-span-2">
          <Textarea value={body} onChange={event => setBody(event.target.value)} rows={6} maxLength={10000} />
        </Field>
        <Field label="List" hint="One entry per line — a service's examples, the form's choices." className="@md:col-span-2">
          <Textarea value={items} onChange={event => setItems(event.target.value)} rows={4} />
        </Field>
      </form>
    </Sheet>
  );
}

/* --------------------------------- images -------------------------------- */

export function SiteImageEditor({
  image,
  onClose,
  onSaved,
  onError,
}: {
  image: SiteImage | null;
  onClose: () => void;
  onSaved: (saved: SiteImage) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState(image?.name ?? "");
  const [alt, setAlt] = useState(image?.alt ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : image?.url ?? ""), [file, image]);
  useEffect(() => () => (file ? URL.revokeObjectURL(preview) : undefined), [file, preview]);

  function choose(next: File | undefined) {
    setProblem("");
    if (!next) return setFile(null);
    if (!(SITE_IMAGE_TYPES as readonly string[]).includes(next.type)) {
      return setProblem(`“${next.name}” is not a JPEG, PNG, WebP, GIF or AVIF image.`);
    }
    if (next.size > MAX_SITE_IMAGE_BYTES) {
      return setProblem(`“${next.name}” is over ${MAX_SITE_IMAGE_BYTES / 1_048_576} MB.`);
    }
    setFile(next);
    if (!name) setName(next.name.replace(/\.[^.]+$/, ""));
  }

  async function save() {
    if (!image && !file) return setProblem("Choose a picture to upload.");
    setBusy(true);
    try {
      const meta = { name, alt };
      await onSaved(image ? await api.updateSiteImage(image.id, meta, file) : await api.uploadSiteImage(file!, meta));
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const { dirty } = useDirty({ name, alt, file: file?.name });
  const close = useUnsavedChanges(dirty, onClose);

  return (
    <Sheet
      title={image ? `Edit “${image.name}”` : "Upload an image"}
      onClose={() => void close()}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : image ? "Save" : "Upload"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {preview && <img src={preview} alt="" className="max-h-64 w-full rounded-md border bg-muted object-contain" />}
        <Field
          label={image ? "Replace the picture" : "Picture"}
          hint={`JPEG, PNG, WebP, GIF or AVIF, up to ${MAX_SITE_IMAGE_BYTES / 1_048_576} MB.${image ? " Leave empty to keep the current one." : ""}`}
        >
          <Input type="file" accept={SITE_IMAGE_TYPES.join(",")} onChange={event => choose(event.target.files?.[0])} />
        </Field>
        <Notice kind="error" lines={problem ? [problem] : []} />
        <Field label="Name" hint="For you — never shown on the page.">
          <Input value={name} onChange={event => setName(event.target.value)} maxLength={120} />
        </Field>
        <Field label="Description" hint="Read aloud by screen readers. Leave empty for a purely decorative picture.">
          <Textarea value={alt} onChange={event => setAlt(event.target.value)} rows={2} maxLength={500} />
        </Field>
      </div>
    </Sheet>
  );
}

/* -------------------------------- enquiries ------------------------------ */

const STATUS_TONE = { new: "pending", replied: "success", archived: "neutral" } as const;

function ContactRequestRow({
  request,
  onStatus,
  onDelete,
}: {
  request: ContactRequest;
  onStatus: (status: ContactRequestStatus) => void;
  onDelete: () => void;
}) {
  const received = new Date(request.createdAt);
  return (
    <li className={cn("space-y-2 px-4 py-3", request.status === "archived" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-medium">
          {request.firstName} {request.lastName}
        </p>
        <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
        {request.area && <Badge tone="outline">{request.area}</Badge>}
        <span className="text-xs text-muted-foreground">
          {Number.isNaN(received.getTime()) ? "" : received.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          {request.status !== "replied" && (
            <Button variant="outline" size="sm" onClick={() => onStatus("replied")}>
              Mark replied
            </Button>
          )}
          {request.status !== "archived" ? (
            <Button variant="ghost" size="sm" onClick={() => onStatus("archived")}>
              Archive
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onStatus("new")}>
              Reopen
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={`mailto:${request.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
          <Mail className="size-3.5" /> {request.email}
        </a>
        {request.phone && (
          <a href={`tel:${request.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Phone className="size-3.5" /> {request.phone}
          </a>
        )}
      </div>
      <p className="text-sm whitespace-pre-line text-foreground/90">{request.description}</p>
    </li>
  );
}
