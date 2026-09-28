import { useEffect, useState } from 'react';
import { resolveImageAsset } from '../../core/storage/image-assets.ts';
export function ProductPhoto({ url, alt, className }: { url?: string; alt: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let active = true; setSrc(''); if (url) void resolveImageAsset(url).then(value => { if (active) setSrc(value); }).catch(() => {}); return () => { active = false; }; }, [url]);
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`${className || ""} flex items-center justify-center bg-slate-50 text-slate-500`} aria-label={alt}>Sem foto</div>;
}
