const DANGEROUS_PREFIX = /^[=+\-@\t\r]+/

export function cellSafe(value: string): string {
  const stripped = value.replace(DANGEROUS_PREFIX, '')
  const needsQuote = /["\n\r,]/.test(stripped)
  if (!needsQuote) return stripped
  const escaped = stripped.replace(/"/g, '""')
  return `"${escaped}"`
}

export function parseCell(raw: string): string {
  let value = raw
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/""/g, '"')
  }
  return value.replace(DANGEROUS_PREFIX, '')
}

export function parseCsvRow(row: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0
  while (i < row.length) {
    const ch = row[i]
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          current += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      current += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      fields.push(current.replace(DANGEROUS_PREFIX, ''))
      current = ''
      i += 1
      continue
    }
    current += ch
    i += 1
  }
  fields.push(current.replace(DANGEROUS_PREFIX, ''))
  return fields
}
