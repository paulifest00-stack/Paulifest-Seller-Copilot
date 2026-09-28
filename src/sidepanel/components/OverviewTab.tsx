import { useState } from 'react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import { evaluatePreparationStatus } from '../../core/schema/product.ts';
import { convertToKit } from '../../core/engines/kit-converter/kit-converter.ts';
import { ProductPhoto } from './ProductPhoto.tsx';
import { PanelDialog } from './PanelDialog.tsx';

export function OverviewTab({ sheet, onCreate }: { sheet: CentralProductSheet; onCreate: (sheet: CentralProductSheet) => Promise<void> }) {
  const [kit, setKit] = useState(false), [quantity, setQuantity] = useState(3), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const status = evaluatePreparationStatus(sheet);
  const labels: Record<string, string> = { title: 'Título', titleBling: 'Nome Bling', sku: 'SKU', ean: 'EAN', brand: 'Marca', model: 'Modelo', ncm: 'NCM', packageWeightKg: 'Peso embalado', packageHeightCm: 'Altura', packageWidthCm: 'Largura', packageLengthCm: 'Comprimento', costPrice: 'Custo', currentSalePrice: 'Preço atual', suggestedSalePrice: 'Preço sugerido', descriptionPlain: 'Descrição', bulletPoints: 'Destaques', warrantyDays: 'Garantia', categoryIdML: 'Categoria ML', categoryPathML: 'Caminho da categoria' };
  const photo = sheet.images.find(i => i.isMain) || sheet.images[0];
  return <section className="space-y-4 text-xs">
    <div className="rounded-2xl border bg-white p-4 flex gap-3">
      <ProductPhoto url={photo?.url} alt="Produto atual" className="h-20 w-20 rounded-xl object-contain bg-slate-50 shrink-0" />
      <div className="space-y-2 min-w-0"><h2 className="font-bold text-base break-words">{sheet.titleBling?.value || sheet.title.value || 'Novo produto'}</h2><p className="break-all">{sheet.sku.value || 'SKU ausente'}</p><p>{sheet.brand.value || 'Marca não identificada'}</p>{sheet.workbench?.kit && <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-1">Kit {sheet.workbench.kit.quantity} unidades</span>}</div>
    </div>
    <div className="grid grid-cols-3 gap-2">{[[status.missingFields.length, 'Ausentes'], [status.pendingFields.length, 'Para revisar'], [status.conflictFields.length, 'Conflitos']].map(([n, name]) => <div key={name} className="rounded-xl border bg-white p-3 text-center"><strong className="block text-xl">{n}</strong>{name}</div>)}</div>
    <div className="rounded-2xl border bg-white p-4 space-y-2"><h3 className="font-bold text-sm">Antes de anunciar</h3>
      {status.conflictFields.length > 0 && <p className="text-red-700">Resolva: {status.conflictFields.map(k => labels[k] || k).join(', ')}.</p>}
      {status.pendingFields.length > 0 && <p className="text-amber-800">Revise: {status.pendingFields.map(k => labels[k] || k).join(', ')}.</p>}
      <p>Faltando na ficha: {status.missingFields.map(k => labels[k] || k).join(', ') || 'nenhum campo estrutural'}.</p>
      <p>Os requisitos para publicação dependem da categoria e serão conferidos na aba Mercado Livre.</p>
    </div>
    <button className="w-full rounded-xl bg-blue-700 text-white py-3 font-semibold" onClick={() => { setKit(true); setMessage(''); }}>Criar versão em kit</button>
    {kit && <PanelDialog title="Criar kit do produto" onClose={() => { if (!busy) setKit(false); }}><div className="space-y-4">
      <p>Será criada uma nova ficha. O original permanece na biblioteca. Estoque, dimensões, peso final e preço do kit precisam ser conferidos.</p>
      <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 10, 12].map(n => <button key={n} onClick={() => setQuantity(n)} className={`border rounded-lg px-3 py-2 ${quantity === n ? 'bg-blue-700 text-white' : ''}`}>{n}x</button>)}</div>
      <label className="block">Quantidade personalizada<input type="number" min={1} max={999} value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="block border rounded-lg p-2 mt-1" /></label>
      <button disabled={busy} className="rounded-lg bg-blue-700 text-white p-3 disabled:opacity-40" onClick={async () => { if (busy) return; setBusy(true); try { const derived = convertToKit(sheet, quantity); await onCreate(derived); setKit(false); } catch (e) { setMessage(e instanceof Error ? e.message : 'Falha ao criar kit.'); } finally { setBusy(false); } }}>{busy ? 'Criando…' : 'Criar ficha do kit'}</button>
      {message && <p role="alert">{message}</p>}
    </div></PanelDialog>}
  </section>;
}
