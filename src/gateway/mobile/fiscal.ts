/** Remove display punctuation without discarding invalid letters or leading zeros. */
export function normalizeFiscalCode(value: string): string {
  return value.replace(/[.\s]/g, "");
}

export function normalizeFiscalInput<T extends { ncm: string; cest: string }>(input: T): T {
  return { ...input, ncm: normalizeFiscalCode(input.ncm), cest: normalizeFiscalCode(input.cest) };
}
