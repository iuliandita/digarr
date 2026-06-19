/** Strip ASCII control characters (C0 range + DEL) from user-supplied freeform text. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ASCII control chars from user-supplied freeform text is the point
export const stripControlChars = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, '')
