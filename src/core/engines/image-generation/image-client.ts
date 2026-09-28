import { requestAI } from '../../services/ai-gateway.ts';
import { resolveImageAsset } from '../../storage/image-assets.ts';
export const IMAGE_MODEL = 'gemini-2.5-flash-image';

export async function generateProductImage(key: string, prompt: string, reference: string): Promise<string> {
  const url = await resolveImageAsset(reference);
  const match = url.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error('Envie uma foto do produto nesta galeria para usá-la como referência.');
  const body = await requestAI(key, `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: match[1], data: match[2] } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
  });
  const candidate = body?.candidates?.[0];
  if (body?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP')) throw new Error('A geração de imagem não foi concluída. Revise o briefing e tente novamente.');
  const part = candidate?.content?.parts?.find((p: any) => !p.thought && /^image\/(png|jpeg|webp)$/.test(p.inlineData?.mimeType) && typeof p.inlineData?.data === 'string');
  if (!part) throw new Error('A IA não retornou imagem. Confira se sua chave tem acesso ao modelo de imagens.');
  return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
}

export async function editProductImage(source: string, options: { size: number; crop: boolean; white: boolean; quality: number }): Promise<string> {
  const url = await resolveImageAsset(source);
  if (!url.startsWith('data:image/')) throw new Error('Envie o arquivo da imagem para editar.');
  if (!Number.isInteger(options.size) || options.size < 256 || options.size > 2048 || options.quality < .5 || options.quality > 1) throw new Error('Configuração de imagem inválida.');
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = options.size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Editor de imagens indisponível.');
  if (options.white) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, options.size, options.size); }
  const scale = options.crop ? Math.max(options.size / img.width, options.size / img.height) : Math.min(options.size / img.width, options.size / img.height);
  ctx.drawImage(img, (options.size - img.width * scale) / 2, (options.size - img.height * scale) / 2, img.width * scale, img.height * scale);
  return canvas.toDataURL(options.white ? 'image/jpeg' : 'image/png', options.quality);
}
