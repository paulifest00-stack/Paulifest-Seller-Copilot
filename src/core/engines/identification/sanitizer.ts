/** Conservative OCR cleanup: retain model numbers, measurements and punctuation. */
export function sanitizeName(value: string): string {
  return value.normalize('NFC').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function deduplicateWords(value: string): string {
  // Only consecutive duplicate words: global deduplication corrupts names and sizes.
  return sanitizeName(value).replace(/\b([\p{L}]+)(?:\s+\1\b)+/giu, '$1');
}
