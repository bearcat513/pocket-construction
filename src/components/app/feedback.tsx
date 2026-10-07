/**
 * How the app answers back: toasts, confirmations, undo, and the guard that
 * stops unsaved work being thrown away.
 *
 * One provider at the top of the app, one hook everywhere else. They live
 * together because they lean on each other — an undo is a toast with a
 * button, and leaving a form with changes in it is a confirmation.
 *
 * ## Why toasts
 *
 * There used to be one banner at the top of a scrolling page. A save pressed
 * at the bottom of a long invoice reported itself somewhere off-screen, behind
 * the scrim if a panel was open, and the next screen change wiped it. A toast
 * sits in a fixed corner above everything, and goes away on its own unless it
 * is an error.
 *
 * ## Why undo rather than "are you sure?"
 *
 * A confirmation asked every time is one people learn to click through. A
 * deletion that waits a few seconds, with the record already gone from the
 * screen and an Undo beside it, protects against the slip without taxing the
 * deliberate. The record really is deleted when the toast expires — or at once
 * if the page is closed first, since the person was told it was gone. What
 * cannot be undone that way (issuing an invoice, revoking a key) still asks.
 *
 * Without a provider — the static-markup tests — every function still works:
 * a toast goes nowhere and a confirmation falls back to the browser's own.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/* --------------------------------- types --------------------------------- */

export type ToastKind = "success" | "info" | "warn" | "error";

type ToastAction = { label: string; run: () => void };

type Toast = {
  id: number;
  kind: ToastKind;
  lines: string[];
  action?: ToastAction;
  /** Milliseconds; 0 stays until dismissed. */
  duration: number;
};

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  /** Paints the button as the dangerous choice. True unless said otherwise. */
  destructive?: boolean;
  /**
   * Text that has to be typed before the button works — for the handful of
   * actions where a slip is expensive and permanent.
   */
  typeToConfirm?: string;
  /**
   * Ask even when the account has turned confirmations off. For discarding
   * unsaved work, and for anything the account's own setting was never about.
   */
  always?: boolean;
};

export type RemoveWithUndo = {
  /** Hidden from every list at once, and shown again by Undo. */
  id: string;
  /** "Deleted ROOF-30" — what the toast says. */
  label: string;
  remove: () => Promise<unknown>;
  /** Run after the delete lands, usually a refresh. */
  done?: () => Promise<unknown> | void;
};

export type Feedback = {
  toast: (kind: ToastKind, lines: string | string[], options?: { action?: ToastAction; duration?: number }) => void;
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
  removeWithUndo: (options: RemoveWithUndo) => void;
  /** Ids waiting out their undo window; lists leave them out. */
  pending: ReadonlySet<string>;
  /** Reports whether a form has unsaved changes. Use `useUnsavedChanges`. */
  setDirty: (key: string, dirty: boolean) => void;
  /** True when it is fine to move on: nothing unsaved, or the person said discard. */
  leave: () => Promise<boolean>;
  /** Runs every pending delete now — signing out, or the page going away. */
  flush: () => void;
  /** The account's "ask before deleting" preference, which `confirm` honours. */
  setConfirmDestructive: (on: boolean) => void;
};

const UNDO_MS = 6000;
const TOAST_MS: Record<ToastKind, number> = { success: 4000, info: 6000, warn: 8000, error: 0 };

const EMPTY = new Set<string>();

const fallback: Feedback = {
  toast: () => {},
  confirm: options =>
    Promise.resolve(
      typeof window === "undefined" ? true : window.confirm(typeof options === "string" ? options : options.message),
    ),
  removeWithUndo: ({ remove, done }) => void remove().then(() => done?.()),
  pending: EMPTY,
  setDirty: () => {},
  leave: () => Promise.resolve(true),
  flush: () => {},
  setConfirmDestructive: () => {},
};

const FeedbackContext = createContext<Feedback>(fallback);

export const useFeedback = () => useContext(FeedbackContext);

/**
 * Registers a form's unsaved state, so navigating away and closing the tab
 * both ask first, and returns a close function that asks too. Hand that
 * function a callback only from a plain click — `close(true)` skips asking.
 */
export function useUnsavedChanges(dirty: boolean, onClose?: () => void) {
  const { setDirty, confirm } = useFeedback();
  const key = useId();

  useEffect(() => {
    setDirty(key, dirty);
    return () => setDirty(key, false);
  }, [key, dirty, setDirty]);

  // `force` is for a close the form decided on itself — after deleting the
  // record, say — where asking about its edits would be absurd.
  return useCallback(async (force = false) => {
    if (dirty && !force && !(await confirm(DISCARD))) return;
    // Cleared before closing, so the guard does not ask a second time on the
    // way out.
    setDirty(key, false);
    onClose?.();
  }, [dirty, confirm, setDirty, key, onClose]);
}

/**
 * Whether a draft differs from what it started as. The first value seen is the
 * baseline; `reset` moves it after a save.
 */
export function useDirty<T>(draft: T): { dirty: boolean; reset: () => void } {
  const serialized = JSON.stringify(draft);
  const baseline = useRef(serialized);
  const [, bump] = useState(0);
  return {
    dirty: serialized !== baseline.current,
    reset: () => {
      baseline.current = serialized;
      bump(value => value + 1);
    },
  };
}

export const DISCARD: ConfirmOptions = {
  title: "Discard unsaved changes?",
  message: "What you have typed here has not been saved, and leaving now throws it away.",
  confirmLabel: "Discard",
  always: true,
};

/* -------------------------------- provider ------------------------------- */

type Asking = ConfirmOptions & { resolve: (answer: boolean) => void };

type PendingDelete = RemoveWithUndo & { timer: ReturnType<typeof setTimeout> };

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(EMPTY);
  const deletes = useRef(new Map<string, PendingDelete>());
  const dirty = useRef(new Set<string>());
  const nextId = useRef(1);
  const confirmRef = useRef(true);
  const setConfirmDestructive = useCallback((on: boolean) => {
    confirmRef.current = on;
  }, []);

  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), []);

  const toast = useCallback<Feedback["toast"]>(
    (kind, lines, options = {}) => {
      const list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
      if (!list.length) return;
      const id = nextId.current++;
      const duration = options.duration ?? TOAST_MS[kind];
      // Four is plenty; the oldest makes room.
      setToasts(current => [...current.slice(-3), { id, kind, lines: list, action: options.action, duration }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const confirm = useCallback<Feedback["confirm"]>(options => {
    const asked = typeof options === "string" ? { message: options } : options;
    if (!asked.always && !asked.typeToConfirm && !confirmRef.current) return Promise.resolve(true);
    return new Promise<boolean>(resolve => setAsking({ ...asked, resolve }));
  }, []);

  const unhide = useCallback((id: string) => {
    deletes.current.delete(id);
    setPending(current => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const commit = useCallback(
    async (id: string) => {
      const entry = deletes.current.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      deletes.current.delete(id);
      try {
        await entry.remove();
        await entry.done?.();
      } catch (error) {
        toast("error", [error instanceof Error ? error.message : "Could not delete that.", `${entry.label} — it is back.`]);
      } finally {
        unhide(id);
      }
    },
    [toast, unhide],
  );

  const removeWithUndo = useCallback<Feedback["removeWithUndo"]>(
    options => {
      // A second delete of the same thing restarts nothing; it is already going.
      if (deletes.current.has(options.id)) return;
      const timer = setTimeout(() => void commit(options.id), UNDO_MS);
      deletes.current.set(options.id, { ...options, timer });
      setPending(current => new Set(current).add(options.id));
      toast("info", options.label, {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          run: () => {
            const entry = deletes.current.get(options.id);
            if (!entry) return;
            clearTimeout(entry.timer);
            unhide(options.id);
          },
        },
      });
    },
    [commit, toast, unhide],
  );

  const flush = useCallback(() => {
    for (const id of [...deletes.current.keys()]) void commit(id);
  }, [commit]);

  const setDirty = useCallback((key: string, value: boolean) => {
    if (value) dirty.current.add(key);
    else dirty.current.delete(key);
  }, []);

  const leave = useCallback(async () => (dirty.current.size === 0 ? true : confirm(DISCARD)), [confirm]);

  // Closing the tab: unsaved work asks, and deletes already promised happen.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (dirty.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", flush);
    };
  }, [flush]);

  const value = useMemo<Feedback>(
    () => ({ toast, confirm, removeWithUndo, pending, setDirty, leave, flush, setConfirmDestructive }),
    [toast, confirm, removeWithUndo, pending, setDirty, leave, flush, setConfirmDestructive],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
      {asking && (
        <ConfirmDialog
          {...asking}
          onAnswer={answer => {
            setAsking(null);
            asking.resolve(answer);
          }}
        />
      )}
    </FeedbackContext.Provider>
  );
}

/* --------------------------------- toasts -------------------------------- */

const TOAST_STYLE: Record<ToastKind, { Icon: typeof Info; tone: string }> = {
  success: { Icon: CheckCircle2, tone: "text-signal" },
  info: { Icon: Info, tone: "text-chart-4" },
  warn: { Icon: AlertTriangle, tone: "text-hazard" },
  error: { Icon: AlertCircle, tone: "text-flare" },
};

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <Portal>
      <ol
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-20 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 lg:bottom-4"
      >
        {toasts.map(toast => {
          const { Icon, tone } = TOAST_STYLE[toast.kind];
          return (
            <li
              key={toast.id}
              role={toast.kind === "error" ? "alert" : "status"}
              className="panel motion-safe:animate-rise pointer-events-auto flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm shadow-lg"
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
              <div className="min-w-0 flex-1 space-y-0.5">
                {toast.lines.map((line, index) => (
                  <p key={index} className={cn(index > 0 && "text-xs text-muted-foreground")}>
                    {line}
                  </p>
                ))}
              </div>
              {toast.action && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => {
                    toast.action!.run();
                    onDismiss(toast.id);
                  }}
                >
                  <Undo2 /> {toast.action.label}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mr-1 size-6 shrink-0"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss"
              >
                <X />
              </Button>
            </li>
          );
        })}
      </ol>
    </Portal>
  );
}

/* ------------------------------ confirmation ----------------------------- */

function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  destructive = true,
  typeToConfirm,
  onAnswer,
}: ConfirmOptions & { onAnswer: (answer: boolean) => void }) {
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const ready = !typeToConfirm || typed.trim() === typeToConfirm;
  const answer = (value: boolean) => {
    if (working) return;
    setWorking(value);
    onAnswer(value);
  };

  return (
    <Dialog
      title={title ?? "Are you sure?"}
      onClose={() => answer(false)}
      footer={
        <>
          {/* The safe answer has focus, unless typing is the next step. */}
          <Button variant="ghost" onClick={() => answer(false)} autoFocus={!typeToConfirm}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ready}
            onClick={() => answer(true)}
          >
            {working && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          if (ready) answer(true);
        }}
      >
        <p className="text-sm">{message}</p>
        {typeToConfirm && (
          <label className="block space-y-1.5 text-xs text-muted-foreground">
            <span>
              Type <strong className="font-mono text-foreground">{typeToConfirm}</strong> to confirm.
            </span>
            <Input value={typed} onChange={event => setTyped(event.target.value)} autoFocus spellCheck={false} />
          </label>
        )}
      </form>
    </Dialog>
  );
}
