/**
 * Fichier Excel (.xlsx) minimal d'une feuille : titre, sous-titre, en-têtes en gras avec filtre, puis les lignes.
 * Montants en dollars (format « 12 450,00 $US »), dates au format JJ/MM/AAAA, nombres et pourcentages.
 * Écrit les parties XML à la main avec PizZip (déjà utilisé pour les documents Word) — aucune dépendance de plus.
 * Module autonome (Deno et Vitest).
 */
import PizZip from "pizzip";

export type XlsxCellType = "text" | "usd" | "date" | "int" | "percent";
export type XlsxValue = string | number | null;

export interface XlsxColumn {
  label: string;
  type: XlsxCellType;
  /** Largeur en caractères. */
  width?: number;
}

export interface XlsxSheet {
  sheetName: string;
  title: string;
  subtitle: string;
  columns: XlsxColumn[];
  /** Montants « usd » en centimes ; dates « date » au format AAAA-MM-JJ (ou date-heure ISO). */
  rows: XlsxValue[][];
}

const STYLE = { default: 0, header: 1, usd: 2, date: 3, int: 4, title: 5, percent: 6 } as const;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caractères de contrôle interdits en XML (hors tabulation et retours à la ligne).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/** A, B, …, Z, AA, AB… */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Date AAAA-MM-JJ → numéro de série Excel (jours depuis le 30/12/1899). */
export function excelDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function textCell(ref: string, value: string, style: number = STYLE.default): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function valueCell(ref: string, column: XlsxColumn, value: XlsxValue): string {
  if (value === null || value === "") return "";
  if (column.type === "text" || typeof value === "string") {
    if (column.type === "date" && typeof value === "string") {
      const serial = excelDate(value);
      if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
    }
    return textCell(ref, String(value));
  }
  if (!Number.isFinite(value)) return "";
  if (column.type === "usd") return `<c r="${ref}" s="${STYLE.usd}"><v>${value / 100}</v></c>`;
  if (column.type === "percent") return `<c r="${ref}" s="${STYLE.percent}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${STYLE.int}"><v>${value}</v></c>`;
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00&quot; $US&quot;"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.0&quot; %&quot;"/></numFmts>' +
  '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

function sheetXml(sheet: XlsxSheet): string {
  const headerRow = 4;
  const lastColumn = columnLetter(Math.max(sheet.columns.length - 1, 0));
  const lastRow = headerRow + sheet.rows.length;
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join("");
  const rows = [
    `<row r="1">${textCell("A1", sheet.title, STYLE.title)}</row>`,
    `<row r="2">${textCell("A2", sheet.subtitle)}</row>`,
    `<row r="${headerRow}">${sheet.columns
      .map((c, i) => textCell(`${columnLetter(i)}${headerRow}`, c.label, STYLE.header))
      .join("")}</row>`,
    ...sheet.rows.map((row, r) => {
      const rowNumber = headerRow + 1 + r;
      const cells = sheet.columns
        .map((column, i) => valueCell(`${columnLetter(i)}${rowNumber}`, column, row[i] ?? null))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    }),
  ].join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${rows}</sheetData>` +
    `<autoFilter ref="A${headerRow}:${lastColumn}${lastRow}"/>` +
    "</worksheet>"
  );
}

export function buildXlsx(sheet: XlsxSheet): Uint8Array {
  const name = escapeXml(sheet.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>` +
      `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$4:$${columnLetter(Math.max(sheet.columns.length - 1, 0))}$${4 + sheet.rows.length}</definedName></definedNames>` +
      "</workbook>",
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
  );
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", sheetXml(sheet));
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}
