import { createAuditedField } from '../../schema/product.ts';
import type { ProductVariation } from '../../schema/workbench.ts';
import { assignGeneratedEan, generateRandomEan13 } from './ean-generator.ts';
import { createInitialSheet } from '../../schema/product.ts';
import { generateChildSku, sanitizeSkuBlock } from './sku-generator.ts';

export function createVariationMatrix(parent: string, labels: string[]): ProductVariation[] {
  const values = [...new Set(labels.map(v => v.trim()).filter(Boolean))];
  if (!values.length || values.length > 100) throw new Error('Informe entre 1 e 100 variações.');
  const used = new Set<string>();
  return values.map(label => {
    const sku = generateChildSku(parent, sanitizeSkuBlock(label));
    if (used.has(sku)) throw new Error('Duas variações resultaram no mesmo SKU. Use sufixos distintos.');
    used.add(sku);
    return { id: crypto.randomUUID(), label, sku, ean: createAuditedField('', 'user_manual', 0, 'missing') };
  });
}

export function fillVariationEans(variations: ProductVariation[], reserved: string[] = []): ProductVariation[] {
  const used = new Set([...reserved, ...variations.map(v => v.ean.value).filter(Boolean)]);
  return variations.map(variation => {
    if (variation.ean.value.trim()) return variation;
    const template = assignGeneratedEan(createInitialSheet()).ean;
    let value = template.value;
    let attempts = 0;
    while (used.has(value)) {
      if (++attempts > 100) throw new Error('Não foi possível obter códigos únicos. Tente novamente.');
      value = generateRandomEan13();
    }
    used.add(value);
    return { ...variation, ean: { ...template, value } };
  });
}
