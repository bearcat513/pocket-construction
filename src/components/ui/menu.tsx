import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEscapeLayer } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

/**
 * A "⋯" button with the actions that are not the next step.
 *
 * A record's header used to show every action it allowed at once — nine on a
 * sent estimate — and wrapped onto three lines on a laptop. One primary action
 * for where the record is now, and the rest in here, reads at a glance.
 */
export function Menu({ label = "More actions", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="icon"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <MoreHorizontal />
      </Button>
      {open && (
        <MenuList onClose={() => setOpen(false)}>{children}</MenuList>
      )}
    </div>
  );
}

function MenuList({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscapeLayer(onClose);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      // Any choice closes the menu.
      onClick={onClose}
      className="panel motion-safe:animate-rise absolute top-full right-0 z-40 mt-1 min-w-52 rounded-md border p-1 shadow-lg"
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onSelect,
  href,
  destructive,
  disabled,
  children,
}: {
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const className = cn(
    "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0",
    "hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50",
    destructive ? "text-destructive" : "[&_svg]:text-muted-foreground",
  );
  return href ? (
    <a role="menuitem" href={href} className={className}>
      {children}
    </a>
  ) : (
    <button role="menuitem" type="button" className={className} onClick={onSelect} disabled={disabled}>
      {children}
    </button>
  );
}

export const MenuSeparator = () => <div role="separator" className="my-1 h-px bg-border" />;
