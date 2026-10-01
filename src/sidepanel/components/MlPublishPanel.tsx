import { useEffect, useRef, useState } from 'react';
import type { CentralProductSheet } from '../../core/schema/product.ts';
import type { MlAction, MlAttribute, MlPreparedListing } from '../../shared/mercadolivre-contracts.ts';
import { reviewed, sheetMlAttributes, sheetToMlDraft } from '../../integrations/mercadolivre/sheet-to-listing.ts';
import { resolveImageAsset } from '../../core/storage/image-assets.ts';
import { PanelDialog } from './PanelDialog.tsx';
import { safeWebUrl } from '../../core/services/product-research.ts';

export async function mlAction(action: MlAction, payload: Record<string, unknown> = {}): Promise<any> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('Abra a extensão no Chrome e conecte o Bling/Gateway para usar o Mercado Livre.');
  const result = await chrome.runtime.sendMessage({ type: 'ML_ACTION', action, payload });
  if (!result?.ok) throw new Error(result?.error || 'O Gateway não respondeu.');
  return result;
}
interface CategoryAttribute { id: string; name: string; tags?: { required?: boolean; read_only?: boolean; hidden?: boolean }; values?: { id: string; name: string }[] }
type Props = { sheet: CentralProductSheet; onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void };
export function MlPublishPanel({ sheet, onUpdateSheet }: Props) {
  const [connection, setConnection] = useState<any>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState('');
  const [categoryId, setCategoryId] = useState(sheet.categoryIdML.value);
  const [familyName, setFamilyName] = useState(sheet.titleBling?.value || sheet.title.value);
  const [price, setPrice] = useState(sheet.suggestedSalePrice.value ?? sheet.currentSalePrice.value ?? 0);
  const [quantity, setQuantity] = useState(reviewed(sheet.stockInfo) ? Math.max(0, Math.floor(sheet.stockInfo!.value.virtualTotal)) : 0);
  const [listingType, setListingType] = useState<'gold_special' | 'gold_pro'>(sheet.mlCalculator?.listingType || sheet.pricingDraft?.listingType || 'gold_special');
  const [condition, setCondition] = useState<'new' | 'used'>(sheet.mlCalculator?.condition || 'new');
  const [freeShipping, setFreeShipping] = useState(sheet.mlCalculator?.freeShipping ?? false), [pickup, setPickup] = useState(false);
  const [shippingMode, setShippingMode] = useState<'me2' | 'custom'>(sheet.mlCalculator?.shippingMode === 'custom' ? 'custom' : 'me2');
  const [attributes, setAttributes] = useState<MlAttribute[]>(sheetMlAttributes(sheet));
  const [metadata, setMetadata] = useState<{ id: string; name: string; attributes: CategoryAttribute[] } | null>(null);
  const [fees, setFees] = useState<any>(null);
  const [prepared, setPrepared] = useState<{ value: MlPreparedListing; signature: string } | null>(null);
  const [remote, setRemote] = useState<any>(null), [itemId, setItemId] = useState(sheet.externalReferences.find(r => r.system === 'mercadolivre')?.externalId || '');
  const [syncPrice, setSyncPrice] = useState(true), [syncStock, setSyncStock] = useState(false), [syncReview, setSyncReview] = useState(false);
  const lock = useRef(false), mounted = useRef(true), live = useRef(sheet); live.current = sheet;
  const signature = JSON.stringify({ sheet, categoryId, familyName, price, quantity, listingType, condition, attributes, freeShipping, pickup, shippingMode });
  const liveSignature = useRef(signature); liveSignature.current = signature;
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, []);
  const run = async (label: string, fn: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(label); setMessage('');
    try { await fn(); } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Falha na integração.'); }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  };
  const updateAttribute = (id: string, value: string, isId: boolean) => setAttributes(prev => [...prev.filter(a => a.id !== id), ...(value ? [{ id, ...(isId ? { value_id: value } : { value_name: value }) }] : [])]);
  const shownAttributes = metadata?.id === categoryId ? metadata.attributes.filter(a => !a.tags?.read_only && !a.tags?.hidden) : [];
  const canReview = prepared?.signature === signature;
  const refresh = async () => {
    try {
      const value = await mlAction('status');
      if (!mounted.current) return;
      setConnection(value);
      const recovered = value.operations?.find((op: any) => op.sheetId === sheet.id && op.state === 'published' && op.itemId);
      if (recovered) {
        setItemId(recovered.itemId);
        onUpdateSheet(s => s.id !== sheet.id || s.externalReferences.some(r => r.system === 'mercadolivre' && r.externalId === recovered.itemId) ? s : ({ ...s, externalReferences: [...s.externalReferences, { system: 'mercadolivre', externalId: recovered.itemId, importedAt: new Date().toISOString(), metadata: { operationId: recovered.id } }] }));
        setMessage('Publicação recuperada: ' + recovered.itemId + '. ' + (recovered.warning || ''));
      }
    } catch {}
  };
  return <section className="rounded-2xl border bg-white p-4 space-y-4 text-xs">
    <h3 className="font-bold text-base">Publicação e sincronização</h3>
    <p className="text-slate-600">Confira os requisitos da categoria e revise o anúncio completo antes da publicação oficial no Mercado Livre.</p>
    
    {connection?.connected ? (
      <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-emerald-900">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-xs">
            Mercado Livre Conectado ({connection.nickname || connection.sellerId || 'Conta'})
          </span>
        </div>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run('status', refresh)}
          className="text-[11px] text-emerald-700 hover:text-emerald-900 font-medium underline"
        >
          {busy === 'status' ? 'Verificando…' : 'Atualizar'}
        </button>
      </div>
    ) : (
      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 space-y-2">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-800">
          <span>⚠️ Mercado Livre não conectado</span>
        </div>
        <p className="text-[11px] text-amber-700 leading-relaxed">
          Para publicar ou sincronizar anúncios, configure sua chave de API ou conecte sua conta na aba <strong>Conexões</strong>.
        </p>
        <button
          type="button"
          onClick={() => {
            window.postMessage({ type: 'PAULIFEST_SYNC_WORKSPACE', targetScreen: 'connections' }, '*');
          }}
          className="text-xs font-semibold px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors inline-flex items-center gap-1"
        >
          Abrir Conexões →
        </button>
      </div>
    )}
    {connection?.operations?.filter((op: any) => op.sheetId === sheet.id && ['publishing', 'uncertain', 'failed'].includes(op.state)).map((op: any) => <p key={op.id} role="status" className="bg-amber-50 rounded-lg p-3">{op.state === 'failed' ? 'A tentativa anterior foi recusada.' : 'Há uma tentativa sem resultado confirmado. Confira sua conta Mercado Livre antes de criar outro anúncio.'} {op.error || ''}</p>)}
    <fieldset disabled={!!busy} className="space-y-3 disabled:opacity-70">
      <label className="block">Categoria ML<input value={categoryId} onChange={e => { setCategoryId(e.target.value.toUpperCase()); setMetadata(null); }} className="w-full border rounded-lg p-2 mt-1" placeholder="MLB…" /></label>
      <button className="border rounded-lg p-2" onClick={() => void run('category', async () => {
        const id = categoryId; const data = await mlAction('category', { categoryId: id });
        if (mounted.current) { setMetadata({ id, name: data.category.name, attributes: data.attributes }); setMessage('Categoria consultada. Preencha os atributos com dados conferidos.'); }
      })}>Consultar categoria e atributos</button>
      {metadata?.id === categoryId && <strong className="block">{metadata.name}</strong>}
      <div className="grid grid-cols-2 gap-3"><label>Preço de venda<input type="number" min={.01} step={.01} value={price} onChange={e => setPrice(Number(e.target.value))} className="border rounded-lg p-2 w-full mt-1" /></label><label>Estoque para anúncio<input type="number" min={0} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="border rounded-lg p-2 w-full mt-1" /></label></div>
      <div className="grid grid-cols-2 gap-3"><label>Tipo<select className="border rounded-lg p-2 w-full mt-1" value={listingType} onChange={e => setListingType(e.target.value as typeof listingType)}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></select></label><label>Condição<select className="border rounded-lg p-2 w-full mt-1" value={condition} onChange={e => setCondition(e.target.value as typeof condition)}><option value="new">Novo</option><option value="used">Usado</option></select></label></div>
      <label className="block">Nome da família (contas User Products)<input className="border rounded-lg p-2 w-full mt-1" value={familyName} onChange={e => setFamilyName(e.target.value)} /></label>
      <label className="block">Envio<select className="border rounded-lg p-2 ml-2" value={shippingMode} onChange={e => setShippingMode(e.target.value as typeof shippingMode)}><option value="me2">Mercado Envios</option><option value="custom">Combinar com comprador</option></select></label>
      <label className="block"><input type="checkbox" checked={freeShipping} onChange={e => setFreeShipping(e.target.checked)} /> Oferecer frete grátis</label>
      <label className="block"><input type="checkbox" checked={pickup} onChange={e => setPickup(e.target.checked)} /> Permitir retirada</label>
      <button className="border rounded-lg p-2" onClick={() => void run('quote', async () => { const quote = await mlAction('pricing-quote', { categoryId, price, listingType, shippingMode, logisticType: sheet.mlCalculator?.logisticType || '', condition, freeShipping, dimensions: sheet.mlCalculator?.dimensions }); const data = { queriedAt: quote.queriedAt, fees: { sale_fee_amount: quote.saleFee } }; if (mounted.current) setFees({ ...data, signature: JSON.stringify([categoryId, price, listingType]) }); })}>Consultar comissão na API ML</button><p className="text-slate-500">A logística e as medidas vêm da etapa Preço. Confira-as lá antes de consultar.</p>
      {fees?.signature === JSON.stringify([categoryId, price, listingType]) && <div className="rounded-xl bg-blue-50 p-3 space-y-1">{(Array.isArray(fees.fees) ? fees.fees : [fees.fees]).map((fee: any, i: number) => <p key={i}>Comissão de venda: {typeof fee?.sale_fee_amount === 'number' ? fee.sale_fee_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'não retornada'}</p>)}<p>Consulta em {new Date(fees.queriedAt).toLocaleString('pt-BR')}. A tarifa fixa já está incluída. Frete, impostos e outros custos são separados.</p></div>}
      {shownAttributes.length > 0 && <details open><summary className="font-semibold cursor-pointer">Atributos da categoria</summary><div className="space-y-2 mt-3">{shownAttributes.map(attr => {
        const current = attributes.find(a => a.id === attr.id); const enumerable = (attr.values?.length || 0) > 0 && (attr.values?.length || 0) <= 100;
        return <label key={attr.id} className="block">{attr.name}{attr.tags?.required ? ' *' : ''}{enumerable ? <select className="border rounded-lg p-2 w-full mt-1" value={current?.value_id || ''} onChange={e => updateAttribute(attr.id, e.target.value, true)}><option value="">Selecione…</option>{attr.values!.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select> : <input className="border rounded-lg p-2 w-full mt-1" value={current?.value_name || ''} onChange={e => updateAttribute(attr.id, e.target.value, false)} />}</label>;
      })}</div></details>}
    </fieldset>
    <button disabled={!!busy || !connection?.connected} className="bg-blue-700 text-white rounded-lg p-3 disabled:opacity-40" onClick={() => void run('prepare', async () => {
      const snapshot = structuredClone(sheet), expected = signature;
      const photos = [...snapshot.images].sort((a, b) => Number(b.isMain) - Number(a.isMain));
      if (!photos.length || photos.some(i => !reviewed(i.status) || i.status.value !== 'approved')) throw new Error('Adicione e aprove todas as fotos que deseja publicar.');
      // Validate audited fields before sending any photo to the marketplace.
      const options = { familyName, categoryId, price, quantity, listingType, condition, attributes, pictureIds: ['pending-upload'], shippingMode, freeShipping, localPickup: pickup };
      sheetToMlDraft(snapshot, options);
      const pictureIds: string[] = [];
      for (const photo of photos.slice(0, 12)) {
        if (!mounted.current || liveSignature.current !== expected) throw new Error('Dados alterados durante a preparação. Prepare novamente.');
        const dataUrl = await resolveImageAsset(photo.url); const result = await mlAction('picture', { dataUrl }); pictureIds.push(result.pictureId);
      }
      if (liveSignature.current !== expected) throw new Error('Dados alterados. Prepare novamente.');
      const draft = sheetToMlDraft(snapshot, { ...options, pictureIds });
      const result = await mlAction('prepare', { draft });
      if (mounted.current && liveSignature.current === expected) setPrepared({ value: result, signature: expected });
    })}>{busy === 'prepare' ? 'Enviando fotos e validando…' : 'Enviar fotos e validar anúncio'}</button>
    {message && <p role="status" className="rounded-xl bg-blue-50 p-3 whitespace-pre-wrap">{message}</p>}
    {prepared && <PanelDialog title="Revisar publicação real" onClose={() => { if (!busy) setPrepared(null); }}><div className="space-y-3">
      <p>Conta: <strong>{prepared.value.account.nickname}</strong> ({prepared.value.account.id})</p>
      <p>{String(prepared.value.payload.title || prepared.value.payload.family_name)} · R$ {String(prepared.value.payload.price)} · {String(prepared.value.payload.available_quantity)} unidades</p>
      <p>Categoria {String(prepared.value.payload.category_id)} · {String(prepared.value.payload.listing_type_id)}</p>
      <p className="whitespace-pre-wrap border rounded-lg p-3 max-h-36 overflow-auto">{prepared.value.description}</p>
      {prepared.value.warnings.map((w, i) => <p key={i} className="text-amber-800">{w}</p>)}
      <details><summary>Conferir todos os campos enviados</summary><pre className="whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(prepared.value.payload, null, 2)}</pre></details>
      {!canReview && <p className="text-red-700">Os dados mudaram. Feche e prepare novamente.</p>}
      <button disabled={!!busy || !canReview} className="rounded-lg bg-blue-700 text-white p-3 disabled:opacity-40" onClick={() => void run('publish', async () => {
        if (liveSignature.current !== prepared.signature) throw new Error('Os dados mudaram. Prepare novamente.');
        const originalId = sheet.id; const result = await mlAction('publish', { id: prepared.value.id, hash: prepared.value.hash, confirmed: true });
        if (!mounted.current) return;
        setItemId(result.itemId); setPrepared(null); setMessage(`Anúncio criado: ${result.itemId}. ${result.warning || ''}`);
        onUpdateSheet(s => s.id !== originalId ? s : ({ ...s, externalReferences: [...s.externalReferences.filter(r => r.system !== 'mercadolivre' || r.externalId !== result.itemId), { system: 'mercadolivre', externalId: result.itemId, importedAt: new Date().toISOString(), metadata: { operationId: prepared.value.id, userProductId: result.userProductId, permalink: safeWebUrl(result.permalink) } }] }));
      })}>{busy === 'publish' ? 'Publicando…' : 'Confirmar e publicar no Mercado Livre'}</button>
      {message && <p role="status">{message}</p>}
    </div></PanelDialog>}
    <details className="border-t pt-3"><summary className="font-semibold cursor-pointer">Anúncio existente · comparar e sincronizar</summary><div className="space-y-3 mt-3">
      <label className="block">ID do anúncio<input className="border rounded-lg p-2 mt-1 w-full" value={itemId} onChange={e => { setItemId(e.target.value.toUpperCase()); setRemote(null); }} placeholder="MLB1234567890" /></label>
      <button disabled={!!busy} className="border rounded-lg p-2" onClick={() => void run('item', async () => { const item = await mlAction('item', { itemId }); if (mounted.current) setRemote(item); })}>Ler anúncio da conta</button>
      {remote?.itemId === itemId && <><p>{remote.title}</p><p>Preço ML: R$ {remote.price} → proposto: R$ {price}</p><p>Estoque ML: {remote.quantity} → proposto: {quantity}</p><label className="block"><input type="checkbox" checked={syncPrice} onChange={e => setSyncPrice(e.target.checked)} /> Atualizar preço</label><label className="block"><input type="checkbox" checked={syncStock} onChange={e => setSyncStock(e.target.checked)} /> Atualizar estoque simples</label><button disabled={!!busy || (!syncPrice && !syncStock)} className="border rounded-lg p-2 disabled:opacity-40" onClick={() => setSyncReview(true)}>Revisar atualização</button></>}
    </div></details>
    {syncReview && remote && <PanelDialog title="Confirmar atualização do anúncio" onClose={() => { if (!busy) setSyncReview(false); }}><div className="space-y-3"><p>Anúncio {remote.itemId}</p>{syncPrice && <p>Preço: R$ {remote.price} → R$ {price}</p>}{syncStock && <p>Estoque: {remote.quantity} → {quantity}</p>}<p>Uma alteração simultânea feita fora do Copilot pode exigir nova conferência.</p><button disabled={!!busy} className="bg-blue-700 text-white rounded-lg p-3 disabled:opacity-40" onClick={() => void run('sync', async () => { const result = await mlAction('sync', { itemId: remote.itemId, expectedLastUpdated: remote.lastUpdated, confirmed: true, ...(syncPrice ? { price } : {}), ...(syncStock ? { quantity } : {}) }); setRemote({ ...remote, ...result }); setSyncReview(false); setMessage('Atualização enviada ao Mercado Livre.'); })}>Confirmar atualização</button>{message && <p role="status">{message}</p>}</div></PanelDialog>}
  </section>;
}
