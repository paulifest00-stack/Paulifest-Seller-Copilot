import { useState } from 'react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import { createAuditedField } from '../../core/schema/product.ts';
import { createVariationMatrix, fillVariationEans } from '../../core/engines/identification/sku-variation-matrix.ts';
import { validateEan } from '../../core/engines/identification/ean-validator.ts';
import { isGeneratedEan } from '../../core/engines/identification/ean-generator.ts';

export function VariationEditor({ sheet, onUpdateSheet }: { sheet: CentralProductSheet; onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void }) {
  const [parent, setParent] = useState(sheet.sku.value.split('-')[0]);
  const [labels, setLabels] = useState('');
  const [message, setMessage] = useState('');
  const variations = sheet.workbench?.variations || [];
  const attempt = (fn: () => void) => { try { fn(); setMessage(''); } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha ao gerar variações.'); } };
  return <section className="rounded-2xl border bg-white p-4 space-y-3 text-xs">
    <h3 className="font-bold text-sm">Variações · SKU e EAN</h3>
    <p>O pai contém a base familiar. Cor, tamanho ou volume variável entram no filho. Informe somente as variações que você vende.</p>
    <label className="block">SKU pai<input value={parent} onChange={e => setParent(e.target.value.toUpperCase())} className="w-full border rounded-lg p-2 mt-1" placeholder="POPTPC150" /></label>
    <label className="block">Novos sufixos (um por linha)<textarea value={labels} onChange={e => setLabels(e.target.value)} className="w-full border rounded-lg p-2 mt-1" placeholder={'AZ\nVM\nPR'} /></label>
    <button className="rounded-lg border p-2 mr-2" onClick={() => attempt(() => {
      const added = createVariationMatrix(parent, labels.split(/[\n,;]+/));
      if (added.some(a => variations.some(v => v.sku === a.sku))) throw new Error('Um dos SKUs já está na matriz.');
      if (variations.length + added.length > 100) throw new Error('Limite de 100 variações por ficha.');
      onUpdateSheet(s => ({ ...s, workbench: { ...s.workbench, variations: [...(s.workbench?.variations || []), ...added] } })); setLabels('');
    })}>Adicionar variações</button>
    <button className="rounded-lg bg-blue-700 text-white p-2 disabled:opacity-40" disabled={!variations.some(v => !v.ean.value)} onClick={() => attempt(() => onUpdateSheet(s => ({ ...s, workbench: { ...s.workbench, variations: fillVariationEans(s.workbench?.variations || [], [s.ean.value]) } })))}>Gerar EANs vazios</button>
    <p className="text-slate-500">Códigos gerados têm checksum válido e uso interno; não são registro GS1.</p>
    {variations.map(v => <div key={v.id} className="border rounded-xl p-3 space-y-2">
      <div className="flex justify-between"><strong>{v.sku}</strong><button className="text-red-700" onClick={() => onUpdateSheet(s => ({ ...s, workbench: { ...s.workbench, variations: s.workbench?.variations?.filter(item => item.id !== v.id) } }))}>Remover</button></div>
      <label className="block">EAN de {v.label}<input aria-label={`EAN ${v.sku}`} inputMode="numeric" maxLength={14} className="border rounded-lg p-2 w-full mt-1" value={v.ean.value} onChange={e => {
        const value = e.target.value.replace(/\D/g, '');
        onUpdateSheet(s => ({ ...s, workbench: { ...s.workbench, variations: s.workbench?.variations?.map(item => item.id === v.id ? { ...item, ean: createAuditedField(value, 'user_manual', 1, value ? 'edited' : 'missing') } : item) } }));
      }} /></label>
      {v.ean.value && <p className={validateEan(v.ean.value).valid ? 'text-emerald-700' : 'text-red-700'}>{validateEan(v.ean.value).valid ? 'Checksum válido' : 'Código inválido'}{isGeneratedEan(v.ean) ? ' · gerado para uso interno' : ''}{variations.filter(x => x.ean.value === v.ean.value).length > 1 || sheet.ean.value === v.ean.value ? ' · código duplicado na ficha' : ''}</p>}
    </div>)}
    {message && <p role="alert" className="text-red-700">{message}</p>}
  </section>;
}
