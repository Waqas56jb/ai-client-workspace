/**
 * Plain text from the light markdown drafts use: **bold**, *italic*, `code` and
 * # headings lose their symbols, "-" bullets become "•", and table rows become
 * tab-separated lines — what a .txt download or a plain paste should contain.
 */
export function markdownToPlain(text = '') {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && !/^\s*```/.test(l))
    .map((l) =>
      l
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/^\s*\|(.*)\|\s*$/, (_, row) => row.split('|').map((c) => c.trim()).join('\t'))
        .replace(/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g, '$1$2')
        .replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1'),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
