import { calculateEanCheckDigit } from './ean-validator.ts';
import { createAuditedField, type AuditedField, type CentralProductSheet } from '../../schema/product.ts';

const GENERATED_SOURCE = 'paulifest:generated-ean13';

/** Código de circulação interna com estrutura EAN-13; não registra GTIN na GS1. */
export function generateRandomEan13(): string {
  let payload = '20';
  while (payload.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      // Rejeição evita favorecer dígitos quando o byte é reduzido módulo 10.
      if (byte < 250) payload += String(byte % 10);
      if (payload.length === 12) break;
    }
  }
  return payload + calculateEanCheckDigit(payload);
}

export function isGeneratedEan(field: AuditedField<string>): boolean {
  return field.evidence?.sourceId === GENERATED_SOURCE;
}

/** Gera uma vez; preserva códigos existentes e não substitui SKU já atribuído. */
export function assignGeneratedEan(sheet: CentralProductSheet): CentralProductSheet {
  if (sheet.ean.value.trim()) return sheet;
  const code = generateRandomEan13();
  const evidence = {
    sourceType: 'rule_engine' as const,
    sourceId: GENERATED_SOURCE,
    sourceName: 'Gerador EAN-13 do Paulifest',
    extractedSnippet: 'Número aleatório de uso interno, com dígito verificador calculado. Sem registro GS1 ou garantia de aceitação como GTIN no marketplace.',
    capturedAt: new Date().toISOString()
  };
  return {
    ...sheet,
    ean: createAuditedField(code, 'rule_engine', 1.0, 'approved', evidence),
    sku: sheet.sku
  };
}
