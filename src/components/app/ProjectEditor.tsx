import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Field, Notice } from "./common";
import type { DirectoryUser } from "@/lib/api";
import type { ProjectInput } from "@/lib/validate";
import {
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
  CURRENCIES,
  EMPTY_ADDRESS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type Account,
  type Address,
  type Project,
} from "@/lib/types";
import { useDirty, useFeedback, useUnsavedChanges } from "./feedback";

type Props = {
  /** null when a job is being created. */
  project: Project | null;
  accounts: Account[];
  directory: DirectoryUser[];
  onSave: (input: ProjectInput) => Promise<void>;
  onClose: () => void;
};

const BLANK: ProjectInput = {
  number: "",
  name: "",
  accountId: "",
  accountName: "",
  status: "lead",
  contractType: "fixed_price",
  projectType: "",
  description: "",
  siteAddress: { ...EMPTY_ADDRESS },
  startDate: "",
  targetCompletionDate: "",
  actualCompletionDate: "",
  projectManager: "",
  superintendent: "",
  permitNumber: "",
  clientReference: "",
  currency: "USD",
  contractValue: 0,
  tags: [],
  notes: "",
};

const toInput = (project: Project | null): ProjectInput =>
  project
    ? {
        number: project.number,
        name: project.name,
        accountId: project.accountId,
        accountName: project.accountName,
        status: project.status,
        contractType: project.contractType,
        projectType: project.projectType,
        description: project.description,
        siteAddress: { ...project.siteAddress },
        startDate: project.startDate,
        targetCompletionDate: project.targetCompletionDate,
        actualCompletionDate: project.actualCompletionDate,
        projectManager: project.projectManager,
        superintendent: project.superintendent,
        permitNumber: project.permitNumber,
        clientReference: project.clientReference,
        currency: project.currency,
        contractValue: project.contractValue,
        tags: [...project.tags],
        notes: project.notes,
      }
    : { ...BLANK, siteAddress: { ...EMPTY_ADDRESS }, tags: [] };

/**
 * A job.
 *
 * The one thing worth noticing in here is what the contract value field says
 * about itself. It is entered rather than derived, because an awarded contract
 * is negotiated after the estimate is accepted more often than not — and the
 * project screen reports what the estimates actually say beside it, so a
 * disagreement between the two is visible instead of resolved by guessing.
 */
export function ProjectEditor({ project, accounts, directory, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<ProjectInput>(() => toInput(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const patch = (changes: Partial<ProjectInput>) => setDraft(current => ({ ...current, ...changes }));
  const patchAddress = (changes: Partial<Address>) =>
    setDraft(current => ({ ...current, siteAddress: { ...current.siteAddress, ...changes } }));

  const clientOptions = useMemo(
    () => accounts.map(account => ({ value: account.id, label: account.name })),
    [accounts],
  );

  const peopleOptions = useMemo(
    () => directory.map(user => ({ value: user.email, label: user.name ? `${user.name} (${user.email})` : user.email })),
    [directory],
  );

  /**
   * Picking a client copies their name and their currency onto the job.
   *
   * The name so the project list reads without a join; the currency because a
   * job billed in something other than the client's is the exception, and the
   * exception should cost a keystroke rather than be the default.
   */
  const chooseClient = (accountId: string) => {
    const account = accounts.find(entry => entry.id === accountId) ?? null;
    patch({
      accountId,
      accountName: account?.name ?? "",
      ...(account && !project ? { currency: account.currency } : {}),
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this project.");
    } finally {
      setSaving(false);
    }
  };

  const { dirty } = useDirty(draft);
  const close = useUnsavedChanges(dirty, onClose);

  return (
    <Sheet
      title={project ? `Edit ${project.name}` : "New project"}
      description={
        project
          ? project.number
          : "A job: where the work is, who is running it, and what the contract says. The number is minted for you."
      }
      onClose={() => void close()}
      error={error}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !draft.name}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            {project ? "Save project" : "Create project"}
          </Button>
        </>
      }
    >

      <div className="space-y-4">
        <div className="grid gap-3 @md:grid-cols-2">
          <Field label="Name" hint="What everybody calls the job.">
            <Input value={draft.name} onChange={event => patch({ name: event.target.value })} autoFocus />
          </Field>
          <Field label="Client">
            <Combobox
              value={draft.accountId}
              onChange={chooseClient}
              options={clientOptions}
              emptyLabel="No client yet"
              placeholder="Choose a client"
              aria-label="Client"
            />
          </Field>
          <Field label="Status">
            <Select value={draft.status} onValueChange={value => patch({ status: value as ProjectInput["status"] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map(status => (
                  <SelectItem key={status} value={status}>
                    {PROJECT_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Contract type" hint="What the estimate is: a price, a projection, or an authorisation to start.">
            <Select
              value={draft.contractType}
              onValueChange={value => patch({ contractType: value as ProjectInput["contractType"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map(type => (
                  <SelectItem key={type} value={type}>
                    {CONTRACT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Project type" hint="“Multifamily — 14 units”, “Tenant improvement”.">
            <Input value={draft.projectType} onChange={event => patch({ projectType: event.target.value })} />
          </Field>
          <Field label="Currency">
            <Select value={draft.currency} onValueChange={value => patch({ currency: value as ProjectInput["currency"] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(code => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Scope">
          <Textarea value={draft.description} onChange={event => patch({ description: event.target.value })} rows={2} />
        </Field>

        <div className="rounded-md border p-3">
          <p className="mb-3 text-xs font-medium">Site</p>
          <div className="grid gap-3 @md:grid-cols-2">
            <Field label="Address" className="@md:col-span-2">
              <Input value={draft.siteAddress.line1} onChange={event => patchAddress({ line1: event.target.value })} />
            </Field>
            <Field label="Unit, floor or suite">
              <Input value={draft.siteAddress.line2} onChange={event => patchAddress({ line2: event.target.value })} />
            </Field>
            <Field label="City">
              <Input value={draft.siteAddress.city} onChange={event => patchAddress({ city: event.target.value })} />
            </Field>
            <Field label="State">
              <Input value={draft.siteAddress.state} onChange={event => patchAddress({ state: event.target.value })} />
            </Field>
            <Field label="Postal code">
              <Input
                value={draft.siteAddress.postalCode}
                onChange={event => patchAddress({ postalCode: event.target.value })}
              />
            </Field>
            <Field label="Country">
              <Input value={draft.siteAddress.country} onChange={event => patchAddress({ country: event.target.value })} />
            </Field>
          </div>
        </div>

        <div className="rounded-md border p-3">
          <p className="mb-3 text-xs font-medium">Who is running it</p>
          <div className="grid gap-3 @md:grid-cols-2">
            <Field label="Project manager">
              <Combobox
                value={draft.projectManager}
                onChange={projectManager => patch({ projectManager })}
                options={peopleOptions}
                emptyLabel="Nobody yet"
                placeholder="Choose or type an address"
                allowCustom
                aria-label="Project manager"
              />
            </Field>
            <Field label="Superintendent">
              <Combobox
                value={draft.superintendent}
                onChange={superintendent => patch({ superintendent })}
                options={peopleOptions}
                emptyLabel="Nobody yet"
                placeholder="Choose or type an address"
                allowCustom
                aria-label="Superintendent"
              />
            </Field>
          </div>
        </div>

        <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
          <Field label="Start date">
            <Input type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value })} />
          </Field>
          <Field label="Target completion">
            <Input
              type="date"
              value={draft.targetCompletionDate}
              onChange={event => patch({ targetCompletionDate: event.target.value })}
            />
          </Field>
          <Field label="Actual completion" hint="Handover, not final payment.">
            <Input
              type="date"
              value={draft.actualCompletionDate}
              onChange={event => patch({ actualCompletionDate: event.target.value })}
            />
          </Field>
        </div>

        <div className="grid gap-3 @md:grid-cols-2 @2xl:grid-cols-3">
          <Field label="Permit number" hint="Printed on nearly everything.">
            <Input
              className="font-mono"
              value={draft.permitNumber}
              onChange={event => patch({ permitNumber: event.target.value })}
            />
          </Field>
          <Field label="Client's reference">
            <Input
              className="font-mono"
              value={draft.clientReference}
              onChange={event => patch({ clientReference: event.target.value })}
            />
          </Field>
          <Field
            label="Contract value"
            hint="The negotiated sum, once there is one. What the estimates say is reported beside it."
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={draft.contractValue}
              onChange={event => patch({ contractValue: Number(event.target.value) })}
            />
          </Field>
        </div>

        <Field label="Tags" hint="Comma separated. “phase-2”, “prevailing-wage”.">
          <Input
            value={draft.tags.join(", ")}
            onChange={event =>
              patch({
                tags: event.target.value
                  .split(",")
                  .map(tag => tag.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
          />
        </Field>

        <Field label="Notes">
          <Textarea value={draft.notes} onChange={event => patch({ notes: event.target.value })} rows={3} />
        </Field>
      </div>
    </Sheet>
  );
}
