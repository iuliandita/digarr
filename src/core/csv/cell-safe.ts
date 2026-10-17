const DANGEROUS_PREFIX = /^[=+\-@\t\r]+/

export function cellSafe(value: string): string {
  const stripped = value.replace(DANGEROUS_PREFIX, '')
  const needsQuote = /["\n\r,]/.test(stripped)
  if (!needsQuote) return stripped
  const escaped = stripped.replace(/"/g, '""')
  return `"${escaped}"`
}

/** RFC 4180 parser: quoted fields may contain commas, newlines and doubled quotes. Blank records are skipped. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0
  const endField = () => {
    fields.push(current.replace(DANGEROUS_PREFIX, ''))
    current = ''
  }
  const endRow = () => {
    endField()
    if (!(fields.length === 1 && fields[0] === '')) rows.push(fields)
    fields = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        current += ch
      }
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      endField()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      endRow()
    } else {
      current += ch
    }
    i += 1
  }
  if (current !== '' || fields.length > 0) endRow()
  return rows
}

export function parseCsvRow(row: string): string[] {
  return parseCsvRows(row)[0] ?? ['']
}
