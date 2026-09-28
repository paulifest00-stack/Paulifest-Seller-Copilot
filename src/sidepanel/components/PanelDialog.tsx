import { useEffect, useRef, type ReactNode } from 'react';
export function PanelDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={dialog} onCancel={onClose} aria-label={title} className="w-[calc(100%-24px)] max-w-lg max-h-[90vh] overflow-auto rounded-2xl border p-4 text-xs backdrop:bg-black/40">
    <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-base">{title}</h2><button autoFocus onClick={onClose} aria-label="Fechar" className="rounded-lg border px-3 py-2">Fechar</button></div>{children}
  </dialog>;
}
