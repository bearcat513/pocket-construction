import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, HardHat, MapPin, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { EmptyState, InvoiceStatusBadge, RowLink, Section, StatusBadge, formatters } from "./common";
import { routePath } from "@/lib/route";
import { ProjectEditor } from "./ProjectEditor";
import { api, type DirectoryUser, type ProjectSummary, type Shareable } from "@/lib/api";
import type { Preferences } from "@/lib/preferences";
import { filterProjects, sortProjects, type ProjectSort } from "@/lib/projects";
import { invoiceStatus } from "@/lib/receivable";
import {
  CONTRACT_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type Account,
  type Project,
  type ProjectStatus,
} from "@/lib/types";
import type { ProjectInput } from "@/lib/validate";
import { cn } from "@/lib/utils";
import { useFeedback } from "./feedback";

type Props = {
  projects: Project[];
  accounts: Account[];
  directory: DirectoryUser[];
  preferences: Preferences;
  myId: string;
  /** The project open on screen, from the URL; null for the list. */
  openId: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => Promise<void>;
  onOpenQuote: (id: string) => void;
  onShare: (kind: Shareable, id: string, title: string) => void;
  onError: (error: unknown) => void;
};

const STATUS_TONE: Record<ProjectStatus, "neutral" | "info" | "pending" | "success" | "danger"> = {
  lead: "neutral",
  bidding: "pending",
  awarded: "info",
  in_progress: "success",
  complete: "neutral",
  cancelled: "danger",
};

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{PROJECT_STATUS_LABELS[status] ?? status}</Badge>;
}

/**
 * The jobs: a list until you pick one, and then that job's whole position.
 *
 * The same shape as the clients screen, for the same reason — a list of
 * everything cannot show any one thing in enough depth to be useful, and a
 * screen that tried would be a worse version of both.
 */
export function ProjectsView(props: Props) {
  const { accounts, directory, preferences, myId, openId } = props;
  const { pending, removeWithUndo } = useFeedback();
  const projects = useMemo(() => props.projects.filter(project => !pending.has(project.id)), [props.projects, pending]);

  const [editing, setEditing] = useState<Project | null | undefined>(undefined);
  const setOpenId = props.onOpen;

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [sort, setSort] = useState<ProjectSort>("status");

  const format = formatters(preferences.defaultCurrency, preferences.locale);

  const visible = useMemo(
    () => sortProjects(filterProjects(projects, { search, status }), sort),
    [projects, search, status, sort],
  );

  const save = async (input: ProjectInput) => {
    if (editing) await api.updateProject(editing.id, input);
    else await api.createProject(input);
    await props.onChanged();
    setEditing(undefined);
  };

  /** Gone from the list at once, deleted when the undo window closes. */
  const remove = (project: Project) =>
    removeWithUndo({
      id: project.id,
      label: `Deleted ${project.number} — ${project.name}. Its estimates and invoices are kept.`,
      remove: () => api.deleteProject(project.id),
      done: props.onChanged,
    });

  if (openId) {
    return (
      <ProjectDetail
        projectId={openId}
        preferences={preferences}
        onBack={() => setOpenId(null)}
        onEdit={project => setEditing(project)}
        onOpenQuote={props.onOpenQuote}
        onError={props.onError}
        editor={
          editing !== undefined && (
            <ProjectEditor
              project={editing}
              accounts={accounts}
              directory={directory}
              onSave={save}
              onClose={() => setEditing(undefined)}
            />
          )
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title="Projects"
        description={
          visible.length === projects.length
            ? `${projects.length} job${projects.length === 1 ? "" : "s"}`
            : `${visible.length} of ${projects.length} jobs`
        }
        actions={
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus /> New project
          </Button>
        }
      >
        {projects.length === 0 ? (
          <EmptyState title="No projects yet">
            A project is the job that gets built, gets billed and gets argued about. Estimates and invoices hang off
            one, so this is usually the first thing to create.
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by name, client, address or permit number"
                className="h-8 max-w-sm text-xs"
                aria-label="Search projects"
              />
              <Select value={status || "all"} onValueChange={value => setStatus(value === "all" ? "" : (value as ProjectStatus))}>
                <SelectTrigger className="h-8 w-auto min-w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every status</SelectItem>
                  {PROJECT_STATUSES.map(entry => (
                    <SelectItem key={entry} value={entry}>
                      {PROJECT_STATUS_LABELS[entry]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={value => setSort(value as ProjectSort)}>
                <SelectTrigger className="h-8 w-auto min-w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Live work first</SelectItem>
                  <SelectItem value="recent">Recently changed</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="value">Contract value</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {visible.length === 0 ? (
              <EmptyState title="Nothing matches that">Clear the search, or widen the status.</EmptyState>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>Project</Th>
                    <Th>Client</Th>
                    <Th>Status</Th>
                    <Th>Dates</Th>
                    <Th numeric>Contract</Th>
                    <Th className="w-24" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {visible.map(project => {
                    const mine = project.ownerId === myId;
                    return (
                      <Tr
                        key={project.id}
                        className={cn("cursor-pointer", project.status === "cancelled" && "opacity-60")}
                        onClick={() => setOpenId(project.id)}
                      >
                        <Td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <HardHat className="size-3.5 shrink-0 text-muted-foreground" />
                            <RowLink href={routePath({ view: "projects", id: project.id })} onOpen={() => setOpenId(project.id)}>
                              {project.name}
                            </RowLink>
                            <span className="font-mono text-xs text-muted-foreground">{project.number}</span>
                            {!mine && <Badge tone="info">shared with you</Badge>}
                          </div>
                          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                            {project.siteAddress.city ? (
                              <>
                                <MapPin className="size-3 shrink-0" />
                                {[project.siteAddress.line1, project.siteAddress.city, project.siteAddress.state]
                                  .filter(Boolean)
                                  .join(", ")}
                              </>
                            ) : (
                              project.projectType || "—"
                            )}
                          </p>
                        </Td>
                        <Td className="text-muted-foreground">{project.accountName || "—"}</Td>
                        <Td>
                          <ProjectStatusBadge status={project.status} />
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {CONTRACT_TYPE_LABELS[project.contractType]}
                          </span>
                        </Td>
                        <Td className="text-xs text-muted-foreground">
                          {project.startDate || project.targetCompletionDate
                            ? `${format.date(project.startDate)} → ${format.date(project.targetCompletionDate)}`
                            : "Not scheduled"}
                        </Td>
                        <Td numeric>
                          {project.contractValue
                            ? format.money(project.contractValue, project.currency)
                            : <span className="text-muted-foreground">—</span>}
                        </Td>
                        <Td>
                          <div className="flex justify-end gap-0.5" onClick={event => event.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditing(project)}
                              aria-label={`Edit ${project.name}`}
                            >
                              <Pencil />
                            </Button>
                            {mine && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => props.onShare("projects", project.id, project.name)}
                                  aria-label={`Share ${project.name}`}
                                >
                                  <Share2 />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => void remove(project)}
                                  aria-label={`Delete ${project.name}`}
                                >
                                  <Trash2 className="text-muted-foreground hover:text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </>
        )}
      </Section>

      {editing !== undefined && (
        <ProjectEditor
          project={editing}
          accounts={accounts}
          directory={directory}
          onSave={save}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

/* ------------------------------- one project ------------------------------ */

/**
 * One job: what has been offered, what has been billed, and what is left.
 *
 * Every figure on this page is derived by `projectStats` from the estimates and
 * invoices beside it — nothing here is a stored total. That is why the page
 * reads its three parts from one endpoint: a screen that fetched them
 * separately would show a job with no contract value for as long as the second
 * request took.
 */
function ProjectDetail({
  projectId,
  preferences,
  onBack,
  onEdit,
  onOpenQuote,
  onError,
  editor,
}: {
  projectId: string;
  preferences: Preferences;
  onBack: () => void;
  onEdit: (project: Project) => void;
  onOpenQuote: (id: string) => void;
  onError: (error: unknown) => void;
  editor: React.ReactNode;
}) {
  const [summary, setSummary] = useState<ProjectSummary | null>(null);

  useEffect(() => {
    let live = true;
    api
      .projectSummary(projectId)
      .then(result => live && setSummary(result))
      .catch(error => live && onError(error));
    return () => {
      live = false;
    };
  }, [projectId, onError]);

  if (!summary) {
    return (
      <Section title="Loading the job…" description="Its estimates and its invoices, together.">
        <div className="px-4 py-10" />
      </Section>
    );
  }

  const { project, estimates, invoices, stats } = summary;
  const format = formatters(project.currency, preferences.locale);

  /**
   * The contract value against what the estimates actually say.
   *
   * Shown as a difference rather than resolved, because the two disagreeing is
   * normal — a contract is negotiated after an estimate is accepted — and the
   * app has no business deciding which of them is right.
   *
   * Only once something has actually been accepted, though: on a job that is
   * still being bid the difference is the whole contract, and reporting
   * "−$1,850,000 against the contract" reads as an alarm rather than as the
   * ordinary state of a job nobody has signed for yet.
   */
  const contractGap =
    project.contractValue && stats.acceptedEstimateValue ? stats.acceptedEstimateValue - project.contractValue : 0;

  const figures: { label: string; value: string; hint?: string }[] = [
    { label: "Contract", value: project.contractValue ? format.money(project.contractValue) : "Not set" },
    {
      label: "Accepted estimates",
      value: format.money(stats.acceptedEstimateValue),
      hint: contractGap ? `${contractGap > 0 ? "+" : ""}${format.money(contractGap)} against the contract` : undefined,
    },
    { label: "Out for decision", value: format.money(stats.openEstimateValue), hint: `${stats.openEstimateCount} open` },
    { label: "Invoiced", value: format.money(stats.invoicedValue) },
    { label: "Paid", value: format.money(stats.paidValue) },
    {
      label: "Outstanding",
      value: format.money(stats.outstandingValue),
      hint: stats.overdueValue ? `${format.money(stats.overdueValue)} overdue` : undefined,
    },
    { label: "Backlog", value: format.money(stats.backlogValue), hint: "Accepted and not yet billed" },
  ];

  return (
    <div className="space-y-4">
      <Section
        title={project.name}
        description={[project.number, project.accountName, CONTRACT_TYPE_LABELS[project.contractType]]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft /> All projects
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(project)}>
              <Pencil /> Edit
            </Button>
          </>
        }
      >
        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            {project.projectType && <Badge tone="outline">{project.projectType}</Badge>}
            {project.permitNumber && <Badge tone="outline">Permit {project.permitNumber}</Badge>}
            {project.tags.map(tag => (
              <Badge key={tag} tone="outline">
                {tag}
              </Badge>
            ))}
          </div>

          {stats.otherCurrencyCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {stats.otherCurrencyCount} document{stats.otherCurrencyCount === 1 ? " is" : "s are"} written in another
              currency and {stats.otherCurrencyCount === 1 ? "is" : "are"} counted but not added into these totals.
            </p>
          )}

          {/* A grid of figures, not a chart: these are numbers people read out
              loud in a meeting. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {figures.map(figure => (
              <div key={figure.label} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{figure.label}</p>
                <p className="font-display text-lg font-semibold tabular-nums">{figure.value}</p>
                {figure.hint && <p className="text-xs text-muted-foreground">{figure.hint}</p>}
              </div>
            ))}
          </div>

          {(project.siteAddress.line1 || project.projectManager || project.startDate) && (
            <div className="grid gap-3 text-xs sm:grid-cols-3">
              {project.siteAddress.line1 && (
                <div>
                  <p className="text-muted-foreground">Site</p>
                  <p>
                    {[
                      project.siteAddress.line1,
                      project.siteAddress.line2,
                      `${project.siteAddress.city} ${project.siteAddress.state} ${project.siteAddress.postalCode}`.trim(),
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
              )}
              {(project.projectManager || project.superintendent) && (
                <div>
                  <p className="text-muted-foreground">Running it</p>
                  {project.projectManager && <p>PM: {project.projectManager}</p>}
                  {project.superintendent && <p>Super: {project.superintendent}</p>}
                </div>
              )}
              {(project.startDate || project.targetCompletionDate) && (
                <div>
                  <p className="text-muted-foreground">Schedule</p>
                  <p>
                    {format.date(project.startDate)} → {format.date(project.actualCompletionDate || project.targetCompletionDate)}
                    {project.actualCompletionDate && " (handed over)"}
                  </p>
                </div>
              )}
            </div>
          )}

          {project.description && <p className="text-xs text-muted-foreground">{project.description}</p>}
        </div>
      </Section>

      <Section title="Estimates" description={`${estimates.length} written against this job`}>
        {estimates.length === 0 ? (
          <EmptyState title="Nothing estimated yet">
            Create an estimate and attach it to this job, and it will appear here.
          </EmptyState>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Estimate</Th>
                <Th>Status</Th>
                <Th>Valid until</Th>
                <Th numeric>Total</Th>
              </Tr>
            </Thead>
            <Tbody>
              {estimates.map(estimate => (
                <Tr key={estimate.id} className="cursor-pointer" onClick={() => onOpenQuote(estimate.id)}>
                  <Td>
                    <span className="font-medium">{estimate.name}</span>
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{estimate.number}</span>
                    {estimate.version > 1 && <Badge tone="outline">rev {estimate.version}</Badge>}
                  </Td>
                  <Td>
                    <StatusBadge status={estimate.status} />
                  </Td>
                  <Td className="text-xs text-muted-foreground">{format.date(estimate.validUntil)}</Td>
                  <Td numeric>{format.money(estimate.totals.grandTotal, estimate.currency)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Section>

      <Section title="Invoices" description={`${invoices.length} raised against this job`}>
        {invoices.length === 0 ? (
          <EmptyState title="Nothing billed yet">
            Bill an accepted estimate from the estimate itself, and the invoice lands here.
          </EmptyState>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Invoice</Th>
                <Th>Status</Th>
                <Th>Due</Th>
                <Th numeric>Total</Th>
                <Th numeric>Balance</Th>
              </Tr>
            </Thead>
            <Tbody>
              {invoices.map(invoice => (
                <Tr key={invoice.id}>
                  <Td>
                    <span className="font-mono text-xs">{invoice.number}</span>
                    {invoice.poNumber && (
                      <span className="ml-1.5 text-xs text-muted-foreground">PO {invoice.poNumber}</span>
                    )}
                  </Td>
                  <Td>
                    <InvoiceStatusBadge status={invoiceStatus(invoice)} />
                  </Td>
                  <Td className="text-xs text-muted-foreground">{format.date(invoice.dueDate)}</Td>
                  <Td numeric>{format.money(invoice.totals.total, invoice.currency)}</Td>
                  <Td numeric className={invoice.totals.balance > 0 ? undefined : "text-muted-foreground"}>
                    {format.money(invoice.totals.balance, invoice.currency)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Section>

      {editor}
    </div>
  );
}
