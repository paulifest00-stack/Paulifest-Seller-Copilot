import { planProductImages } from '../../core/engines/image-generation/objection-planner.ts';
import { useEffect, useRef, useState } from 'react';
import { createAuditedField, type CentralProductSheet } from '../../core/schema/product.ts';
import type { ImageBrief } from '../../core/schema/workbench.ts';
import { buildImageBriefs } from '../../core/engines/image-generation/image-brief-generator.ts';
import { generateProductImage, editProductImage, IMAGE_MODEL } from '../../core/engines/image-generation/image-client.ts';
import { saveImageAsset, resolveImageAsset } from '../../core/storage/image-assets.ts';
import { loadSellerPreferences } from '../../core/storage/storage.ts';
import { ProductPhoto } from './ProductPhoto.tsx';
import { PanelDialog } from './PanelDialog.tsx';

type Props = { sheet: CentralProductSheet; onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void };
export function ImagesTab({ sheet, onUpdateSheet }: Props) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [editId, setEditId] = useState('');
  const [crop, setCrop] = useState(false);
  const [size, setSize] = useState(1200);
  const [preview, setPreview] = useState('');
  const [white, setWhite] = useState(true);
  const live = useRef(sheet); live.current = sheet;
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const briefs = sheet.workbench?.briefs || buildImageBriefs(sheet);
  const run = async (label: string, action: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(label); setMessage('');
    try { await action(); } catch (e) { if (mounted.current) setMessage(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  };
  const addImage = async (data: string, snapshot: CentralProductSheet, brief?: ImageBrief) => {
    if (!mounted.current || JSON.stringify(live.current) !== JSON.stringify(snapshot)) throw new Error('A ficha mudou. Tente novamente com os dados atuais.');
    const url = await saveImageAsset(data);
    if (!mounted.current) return;
    const id = crypto.randomUUID();
    const image = { id, url, isMain: snapshot.images.length === 0 && !brief, status: createAuditedField<'approved' | 'warning' | 'rejected'>(brief ? 'warning' : 'approved', brief ? 'ai_generated' : 'user_manual', 1, brief ? 'pending_review' : 'approved', { capturedAt: new Date().toISOString(), sourceName: brief ? IMAGE_MODEL : 'Arquivo enviado pelo usuário' }) };
    const existingBriefs = snapshot.workbench?.briefs || buildImageBriefs(snapshot);
    onUpdateSheet(current => JSON.stringify(current) !== JSON.stringify(snapshot) ? current : ({ ...current,
      images: [...current.images.filter(i => i.id !== brief?.imageId), image],
      workbench: { ...current.workbench, ...(brief ? { briefs: existingBriefs.map(b => b.kind === brief.kind ? { ...brief, imageId: id, generatedAt: new Date().toISOString() } : b) } : {}) }
    }));
    setMessage(brief ? 'Imagem gerada. Confira produto, quantidade e rótulo antes de aprovar.' : 'Imagem adicionada à galeria.');
  };
  const generate = (brief: ImageBrief) => run(brief.kind, async () => {
    const snapshot = structuredClone(sheet);
    const reference = snapshot.images.find(i => i.status.source === 'user_manual') || snapshot.images[0];
    if (!reference) throw new Error('Envie uma foto real do produto antes de gerar.');
    const prefs = await loadSellerPreferences();
    const data = await generateProductImage(prefs.geminiApiKey || '', brief.prompt, reference.url);
    await addImage(data, snapshot, brief);
  });
  const download = (url: string) => run('download', async () => {
    const data = await resolveImageAsset(url);
    if (!data.startsWith('data:')) { window.open(data, '_blank', 'noopener,noreferrer'); return; }
    const anchor = document.createElement('a'); anchor.href = data; anchor.download = `produto-${sheet.id}.${data.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`; anchor.click();
  });
  const editImage = sheet.images.find(i => i.id === editId);
  return <section className="space-y-4 text-xs">
    <div className="rounded-2xl border bg-white p-4 space-y-3">
      <h2 className="font-bold text-base">Fotos do produto</h2>
      <p>Envie uma foto real. As gerações usam sua chave Gemini e podem consumir créditos do provedor.</p>
      <label className="block font-semibold">Adicionar foto<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!busy} className="block w-full mt-2" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        void run('upload', async () => {
          if (file.size > 6_000_000) throw new Error('Envie uma imagem de até 6 MB.');
          const snapshot = structuredClone(sheet);
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
          const optimized = await editProductImage(data, { size: 1536, crop: false, white: true, quality: .9 });
          await addImage(optimized, snapshot);
        });
      }} /></label>
      <div className="grid grid-cols-2 gap-3">
        {sheet.images.map(img => <article key={img.id} className="rounded-xl border p-2 space-y-2 min-w-0">
          <ProductPhoto url={img.url} alt="Foto do produto" className="aspect-square w-full object-contain rounded-lg bg-slate-50" />
          <p>{img.isMain ? 'Principal · ' : ''}{img.status.status === 'pending_review' ? 'Revisão pendente' : 'Revisada'}</p>
          <div className="flex gap-2 flex-wrap text-blue-700">
            <button disabled={!!busy} onClick={() => void download(img.url)}>Baixar</button>
            <button disabled={!!busy} onClick={() => { setEditId(img.id); setPreview(''); }}>Editar</button>
            <button disabled={!!busy} onClick={() => onUpdateSheet(s => ({ ...s, images: s.images.map(i => ({ ...i, isMain: i.id === img.id })) }))}>Principal</button>
            {img.status.status === 'pending_review' && <button onClick={() => onUpdateSheet(s => ({ ...s, images: s.images.map(i => i.id === img.id ? { ...i, status: { ...i.status, value: 'approved', status: 'approved' } } : i) }))}>Aprovar</button>}
            <button disabled={!!busy} className="text-red-700" onClick={() => onUpdateSheet(s => ({ ...s, images: s.images.filter(i => i.id !== img.id), workbench: { ...s.workbench, briefs: s.workbench?.briefs?.map(b => b.imageId === img.id ? { ...b, imageId: undefined } : b) } }))}>Remover</button>
          </div>
        </article>)}
      </div>
    </div>
    <h3 className="font-bold text-sm">Sete propostas de imagem</h3>
    <button disabled={!!busy || !sheet.images.length} className="border rounded-lg bg-white p-3 disabled:opacity-40" onClick={() => void run('plan', async () => {
      const snapshot = structuredClone(sheet), prefs = await loadSellerPreferences();
      const planned = await planProductImages(snapshot, prefs.geminiApiKey || '');
      if (!mounted.current || JSON.stringify(live.current) !== JSON.stringify(snapshot)) throw new Error('A ficha mudou. Planeje novamente.');
      onUpdateSheet(s => JSON.stringify(s) !== JSON.stringify(snapshot) ? s : ({ ...s, workbench: { ...s.workbench, briefs: planned } }));
      setMessage('Propostas atualizadas com a proporção visual e os fatos confirmados. Revise os briefings. As fotos existentes foram preservadas.');
    })}>{busy === 'plan' ? 'Analisando foto…' : 'Analisar proporção e planejar infográfico com IA'}</button>
    <p>Edite cada briefing antes de gerar. Fundo branco por IA pode alterar detalhes; revise o resultado.</p>
    <div className="grid grid-cols-2 gap-3">
      {briefs.map(brief => <article key={brief.kind} className="rounded-xl border bg-white p-3 space-y-2 min-w-0">
        <h4 className="font-semibold">{brief.title}</h4><span className="text-slate-500">Layout {brief.layout}</span>
        <details><summary className="cursor-pointer">Editar briefing</summary><textarea aria-label={`Briefing ${brief.title}`} rows={8} value={brief.prompt} disabled={!!busy} className="w-full border rounded-lg p-2 mt-2" onChange={e => { const prompt = e.target.value; onUpdateSheet(s => ({ ...s, workbench: { ...s.workbench, briefs: (s.workbench?.briefs || buildImageBriefs(s)).map(b => b.kind === brief.kind ? { ...b, prompt } : b) } })); }} /></details>
        <button className="rounded-lg bg-blue-700 text-white px-3 py-2 disabled:opacity-40" disabled={!!busy || !sheet.images.length} onClick={() => void generate(brief)}>{busy === brief.kind ? 'Gerando…' : brief.imageId ? 'Gerar outra' : 'Gerar imagem'}</button>
      </article>)}
    </div>
    {message && <p role="status" className="rounded-xl bg-blue-50 p-3">{message}</p>}
    {editImage && <PanelDialog title="Editar foto" onClose={() => { if (!busy) setEditId(''); }}>
      <div className="space-y-3">
        <ProductPhoto url={preview || editImage.url} alt="Prévia da edição" className="w-full aspect-square object-contain border rounded-xl" />
        <label className="block">Tamanho<select className="ml-2 border rounded p-2" value={size} onChange={e => { setSize(Number(e.target.value)); setPreview(''); }}>{[800, 1200, 1600, 2048].map(n => <option key={n} value={n}>{n} × {n}</option>)}</select></label>
        <label className="block"><input type="checkbox" checked={crop} onChange={e => { setCrop(e.target.checked); setPreview(''); }} /> Recorte quadrado central (pode cortar bordas)</label>
        <label className="block"><input type="checkbox" checked={white} onChange={e => { setWhite(e.target.checked); setPreview(''); }} /> Margens e transparência com fundo branco</label>
        <p>O editor ajusta enquadramento e tamanho. Para substituir o fundo da foto, use a proposta Principal com IA.</p>
        <button disabled={!!busy} className="border rounded-lg p-2 mr-2" onClick={() => void run('edit', async () => setPreview(await editProductImage(editImage.url, { size, crop, white, quality: .9 })))}>Ver resultado</button>
        <button disabled={!!busy || !preview} className="bg-blue-700 text-white rounded-lg p-2 disabled:opacity-40" onClick={() => void run('save-edit', async () => { await addImage(preview, structuredClone(sheet)); setEditId(''); })}>Salvar como nova foto</button>
        {message && <p role="status">{message}</p>}
      </div>
    </PanelDialog>}
  </section>;
}
