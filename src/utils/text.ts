/**
 * Normalize whitespace in extracted message text:
 * - Normalize line endings to LF
 * - Collapse 3+ consecutive newlines to 2 (one blank line)
 * - Trim leading/trailing whitespace
 */
export function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
