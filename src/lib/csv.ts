/**
 * Delimited text, parsed properly.
 *
 * Supplier price lists arrive as CSV and they arrive badly: quoted fields with
 * commas in the description, embedded newlines in an address, a byte-order
 * mark from Excel, CRLF line endings, and semicolons instead of commas from
 * anywhere that uses a comma as a decimal point. A `split(",")` handles none
 * of that and fails *silently* — it does not throw, it just shifts every
 * column after the first quoted comma by one, which puts a weight in a price
 * field and reprices a catalogue.
 *
 * So this is a real RFC 4180 reader: a small state machine over the
 * characters, with the two common extensions (a configurable delimiter, and
 * tolerance of bare CR). It is pure and it never throws — a malformed file
 * yields the rows it could read, because half a price list a human can look
 * at beats an exception they cannot.
 */

/** What separates one field from the next. */
export type Delimiter = "," | ";" | "\t" | "|";

const DELIMITERS: Delimiter[] = [",", ";", "\t", "|"];

/**
 * Guesses the delimiter from the first few lines.
 *
 * The winner is the candidate that appears the same number of times on every
 * line, most often — consistency rather than raw frequency, because a
 * description field full of commas will out-count a semicolon that is doing
 * the actual work.
 */
export function sniffDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter(line => line.trim()).slice(0, 10);
  if (!lines.length) return ",";

  let best: Delimiter = ",";
  let bestScore = -1;

  for (const candidate of DELIMITERS) {
    // Counted outside quotes, or a quoted description would win every time.
    const counts = lines.map(line => {
      let quoted = false;
      let count = 0;
      for (const character of line) {
        if (character === '"') quoted = !quoted;
        else if (character === candidate && !quoted) count++;
      }
      return count;
    });

    const first = counts[0] ?? 0;
    if (!first) continue;
    const consistent = counts.every(count => count === first);
    const score = (consistent ? 1000 : 0) + first;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/** Excel writes one, and it turns the first column name into garbage. */
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Reads delimited text into rows of fields.
 *
 * Quoting follows RFC 4180: a field may be wrapped in double quotes, inside
 * which the delimiter, CR and LF are ordinary characters, and a literal quote
 * is written twice. An unterminated quote at end of file closes itself rather
 * than discarding everything after it.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): string[][] {
  const source = stripBom(text);
  const separator = delimiter ?? sniffDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;

  const endField = () => {
    row.push(field);
    field = "";
    started = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    started = false;
  };

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;

    if (quoted) {
      if (character !== '"') {
        field += character;
        continue;
      }
      // A doubled quote is one literal quote; a single one ends the field.
      if (source[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (character === '"' && field === "") {
      quoted = true;
      started = true;
      continue;
    }
    if (character === separator) {
      endField();
      continue;
    }
    if (character === "\n") {
      endRow();
      continue;
    }
    if (character === "\r") {
      // CRLF, or a lone CR from a very old exporter.
      if (source[index + 1] === "\n") index++;
      endRow();
      continue;
    }
    field += character;
    started = true;
  }

  // Whatever was in hand when the file ended is a row, unless the file ended
  // on a newline and there is nothing in hand.
  if (started || field || row.length) endRow();

  return rows.filter(entry => entry.length > 1 || (entry[0] ?? "").trim() !== "");
}

export type DelimitedTable = {
  /** The header row, trimmed. Duplicates are suffixed so every name is usable. */
  columns: string[];
  /** One record per data row, keyed by column name. */
  rows: Record<string, string>[];
  delimiter: Delimiter;
};

/**
 * Reads delimited text as a table with a header row.
 *
 * Short rows are padded rather than rejected: a trailing empty column is the
 * single most common thing wrong with an exported price list, and it is not
 * worth refusing a file over. Long rows keep their extra fields under
 * generated names, so nothing read is silently dropped.
 */
export function parseTable(text: string, delimiter?: Delimiter): DelimitedTable {
  const separator = delimiter ?? sniffDelimiter(stripBom(text));
  const raw = parseDelimited(text, separator);
  if (!raw.length) return { columns: [], rows: [], delimiter: separator };

  const seen = new Map<string, number>();
  const columns = (raw[0] ?? []).map((name, index) => {
    const trimmed = name.trim() || `column${index + 1}`;
    const count = seen.get(trimmed) ?? 0;
    seen.set(trimmed, count + 1);
    return count ? `${trimmed} (${count + 1})` : trimmed;
  });

  const rows = raw.slice(1).map(fields => {
    const record: Record<string, string> = {};
    for (const [index, column] of columns.entries()) record[column] = (fields[index] ?? "").trim();
    for (let index = columns.length; index < fields.length; index++) {
      record[`column${index + 1}`] = (fields[index] ?? "").trim();
    }
    return record;
  });

  return { columns, rows, delimiter: separator };
}

/**
 * A price as a feed writes it, as a number.
 *
 * Feeds put currency symbols, thousands separators and footnote markers in
 * price columns, and a European feed writes 1.234,56 for what a US one calls
 * 1,234.56. Both are read here, decided by which separator comes last.
 *
 * Returns null rather than 0 for anything unreadable: a price of zero is a
 * real price, and a sync that turns an unparseable cell into a free item is
 * the worst available outcome.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const text = String(value ?? "").trim();
  if (!text) return null;

  // Strip everything that is not a digit, separator or sign.
  let cleaned = text.replace(/[^\d.,\-+]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    // 1.234,56 — dots group, the comma is the decimal point.
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // 1,234.56 — commas group.
    cleaned = cleaned.replace(/,/g, "");
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "yes", "Y", "TRUE", "1" — how a feed writes a boolean. */
export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "y", "yes", "true", "t", "active", "available"].includes(text)) return true;
  if (["0", "n", "no", "false", "f", "inactive", "discontinued"].includes(text)) return false;
  return fallback;
}
