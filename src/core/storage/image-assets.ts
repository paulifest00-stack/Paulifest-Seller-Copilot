const PREFIX = 'paulifest-asset:';
function openAssets(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paulifest-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Não foi possível abrir a biblioteca de imagens.'));
  });
}
export async function saveImageAsset(dataUrl: string): Promise<string> {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl) || dataUrl.length > 8_000_000) throw new Error('Imagem inválida ou muito grande.');
  const db = await openAssets();
  const id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('Não foi possível salvar a imagem. Verifique o espaço disponível.'));
    });
    return PREFIX + id;
  } finally { db.close(); }
}
export async function resolveImageAsset(url: string): Promise<string> {
  if (!url.startsWith(PREFIX)) return /^(https:\/\/|data:image\/(jpeg|png|webp);base64,)/.test(url) ? url : '';
  const db = await openAssets();
  try {
    return await new Promise<string>((resolve, reject) => {
      const request = db.transaction('images').objectStore('images').get(url.slice(PREFIX.length));
      request.onsuccess = () => typeof request.result === 'string' ? resolve(request.result) : reject(new Error('Imagem não encontrada neste navegador.'));
      request.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    });
  } finally { db.close(); }
}
