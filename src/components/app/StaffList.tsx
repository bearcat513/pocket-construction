import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { api, type StaffMember } from "@/lib/api";
import { useFeedback } from "./feedback";

/**
 * Who keeps the company catalogue.
 *
 * Every account on the instance, with a switch for whether it is staff. Sign-up
 * is open, so an account turning up here is somebody who registered, not
 * somebody who works here — the switch is how the second becomes true. Your
 * own switch is fixed on: the server refuses to take you off, so the company
 * always has someone who can put people back.
 */
export function StaffList({ myId }: { myId: string }) {
  const { toast } = useFeedback();
  const [users, setUsers] = useState<StaffMember[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api
      .listStaff()
      .then(result => {
        if (!live) return;
        setUsers(result.users);
        setTruncated(result.truncated);
      })
      .catch(failure => live && setError(failure instanceof Error ? failure.message : "Could not read the team."));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (user: StaffMember, staff: boolean) => {
    setBusy(user.id);
    setError("");
    try {
      const updated = await api.setStaff(user.id, staff);
      setUsers(current => (current ?? []).map(other => (other.id === updated.id ? updated : other)));
      toast("success", staff ? `${user.email} is now staff.` : `${user.email} is no longer staff.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change that.");
    } finally {
      setBusy("");
    }
  };

  if (error && !users) return <p className="px-4 py-3 text-sm text-destructive">{error}</p>;
  if (!users) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Reading the team…
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y">
        {users.map(user => {
          const me = user.id === myId;
          return (
            <li key={user.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {user.name || user.email}
                  {me && <span className="text-muted-foreground"> (you)</span>}
                </p>
                {user.name && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
              </div>
              {user.staff ? <Badge tone="success">staff</Badge> : <Badge tone="neutral">not staff</Badge>}
              {busy === user.id ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  checked={user.staff}
                  disabled={me || Boolean(busy)}
                  onChange={event => void toggle(user, event.target.checked)}
                  aria-label={`${user.email} is staff`}
                  title={me ? "You can't take yourself off staff" : undefined}
                />
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="border-t px-4 py-2 text-xs text-destructive">{error}</p>}
      {truncated && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">Only the first {users.length} accounts are shown.</p>
      )}
    </>
  );
}
