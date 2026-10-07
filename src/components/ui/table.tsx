import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The data table used by every list in the app.
 *
 * `Td`/`Th` take `numeric`, which right-aligns and switches to tabular
 * figures. Money in a proportional font does not line up column-wise, and a
 * column of prices that does not line up is a column nobody can scan.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom border-collapse text-sm", className)} {...props} />
    </div>
  );
}

const Thead = ({ className, ...props }: React.ComponentProps<"thead">) => (
  <thead className={cn("[&_tr]:border-b", className)} {...props} />
);

const Tbody = ({ className, ...props }: React.ComponentProps<"tbody">) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
);

const Tr = ({ className, ...props }: React.ComponentProps<"tr">) => (
  <tr className={cn("border-b transition-colors hover:bg-muted/40", className)} {...props} />
);

const Th = ({ className, numeric, ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) => (
  <th
    className={cn(
      "px-3 py-2 text-left align-middle text-xs font-medium tracking-wide text-muted-foreground uppercase",
      numeric && "text-right",
      className,
    )}
    {...props}
  />
);

const Td = ({ className, numeric, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) => (
  <td
    className={cn("px-3 py-2 align-middle", numeric && "text-right tabular-nums", className)}
    {...props}
  />
);

export { Table, Tbody, Td, Th, Thead, Tr };

/**
 * A header that sorts its column. Clicking the active column flips the
 * direction; clicking another starts it at that column's natural order.
 */
function SortTh<K extends string>({
  column,
  sort,
  onSort,
  numeric,
  className,
  children,
}: {
  column: K;
  sort: { key: K; ascending: boolean };
  onSort: (key: K) => void;
  numeric?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort.key === column;
  return (
    <Th
      numeric={numeric}
      className={className}
      aria-sort={active ? (sort.ascending ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 uppercase hover:text-foreground",
          numeric && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {children}
        <span aria-hidden="true" className={cn("text-[9px]", !active && "opacity-0")}>
          {active && !sort.ascending ? "▼" : "▲"}
        </span>
      </button>
    </Th>
  );
}

/**
 * Sorting state for a table sorted in the browser: the key, the direction, and
 * the click handler `SortTh` wants. `natural` says which way a column starts —
 * money and dates read best largest or newest first.
 */
function useSort<K extends string>(initial: K, initialAscending = true, natural: (key: K) => boolean = () => true) {
  const [sort, setSort] = React.useState({ key: initial, ascending: initialAscending });
  const onSort = (key: K) =>
    setSort(current => (current.key === key ? { key, ascending: !current.ascending } : { key, ascending: natural(key) }));
  return { sort, onSort };
}

/** Compares two cells: numbers as numbers, anything else as text in the reader's language. */
function compareCells(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function sortRows<T, K extends string>(rows: T[], sort: { key: K; ascending: boolean }, value: (row: T, key: K) => unknown): T[] {
  const sign = sort.ascending ? 1 : -1;
  return [...rows].sort((a, b) => sign * compareCells(value(a, sort.key), value(b, sort.key)));
}

export { SortTh, sortRows, useSort };
