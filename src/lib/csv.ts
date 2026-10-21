import { formatLocalDate, formatLocalTime } from './time';
import { NAME_SOURCE_TEXT, type Visit } from './visits';

export type CsvSeparator = ',' | ';';

/**
 * Neutraliza fórmulas: una celda que empieza por = + - @ tabulador o retorno de carro
 * se interpretaría como fórmula en Excel/LibreOffice/Sheets. Se antepone un apóstrofo.
 */
export function protectFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const s = protectFormula(String(value));
  return `"${s.replace(/"/g, '""')}"`;
}

export const CSV_HEADERS = [
  'Nombre',
  'Institución',
  'Cargo',
  'Estado',
  'Identificador QR',
  'Tipo de código',
  'Fecha',
  'Hora local',
  'Zona horaria',
  'Timestamp UTC',
  'Stand',
  'Observaciones',
  'Origen del nombre',
  'ID registro',
] as const;

export function visitsToCsv(visits: Visit[], timeZone: string, separator: CsvSeparator = ','): string {
  const rows = [...visits]
    .sort((a, b) => a.visited_at.localeCompare(b.visited_at))
    .map((v) =>
      [
        v.attendee_name,
        v.attendee_institution ?? null,
        v.attendee_role ?? null,
        v.attendee_name ? 'Identificado' : 'Pendiente de nombre',
        v.qr_identifier,
        v.qr_kind,
        formatLocalDate(v.visited_at, timeZone),
        formatLocalTime(v.visited_at, timeZone),
        timeZone,
        v.visited_at,
        v.stand_id,
        v.notes,
        v.name_source ? NAME_SOURCE_TEXT[v.name_source] : null,
        v.id,
      ]
        .map(csvCell)
        .join(separator),
    );
  const header = CSV_HEADERS.map(csvCell).join(separator);
  // BOM para que Excel detecte UTF-8; fin de línea CRLF según RFC 4180.
  return String.fromCharCode(0xfeff) + [header, ...rows].join('\r\n') + '\r\n';
}

export function csvFileName(standId: string, suffix: string): string {
  const safe = standId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'stand';
  return `visitas-${safe}-${suffix}.csv`;
}

export function downloadCsv(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
