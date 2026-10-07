import { Download, FileSpreadsheet, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { CATALOG_CSV_COLUMNS } from "@/lib/catalogCsv";
import { CATALOG_TEMPLATES, catalogTemplateUrl } from "@/lib/catalogTemplates";

type Props = { onClose: () => void };

/**
 * The files a catalogue can be started from, and what each spreadsheet
 * column means.
 *
 * A modal rather than a panel: there is nothing to fill in here, only
 * something to read before filling in a spreadsheet somewhere else.
 */
export function CatalogTemplatesDialog({ onClose }: Props) {
  return (
    <Dialog
      title="Catalogue templates"
      description="Download one, fill it in, and bring it back with Import."
      onClose={onClose}
      className="max-w-3xl"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-5">
        <ul className="divide-y rounded-sm border">
          {CATALOG_TEMPLATES.map(template => (
            <li key={template.file} className="flex items-start gap-3 px-3 py-2.5">
              {template.file.endsWith(".json") ? (
                <FileJson className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{template.title}</div>
                <p className="text-xs text-muted-foreground">{template.description}</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={catalogTemplateUrl(template.file)} download={template.file}>
                  <Download /> {template.file}
                </a>
              </Button>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          <h3 className="seam font-display text-sm font-semibold">Spreadsheet columns</h3>
          <p className="text-xs text-muted-foreground">
            Headings are matched loosely — <code>List Price</code>, <code>list_price</code> and{" "}
            <code>listPrice</code> are the same column. A cell that cannot be read stops the import and names the row;
            nothing is written until every row is good, and a SKU already in the catalogue is left exactly as it is.
            Options, volume tiers and assemblies need the catalogue file.
          </p>
          <Table className="text-xs">
            <Thead>
              <Tr>
                <Th>Column</Th>
                <Th>What goes in it</Th>
              </Tr>
            </Thead>
            <Tbody>
              {CATALOG_CSV_COLUMNS.map(spec => (
                <Tr key={spec.column}>
                  <Td className="align-top font-mono whitespace-nowrap">
                    {spec.column}
                    {spec.required && <span className="text-alert"> *</span>}
                  </Td>
                  <Td className="text-muted-foreground">
                    {spec.note}
                    {spec.values && (spec.kind === "enum" || spec.column === "unitOfMeasure") && (
                      <span className="block font-mono">{spec.values.join(" · ")}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </div>
    </Dialog>
  );
}
