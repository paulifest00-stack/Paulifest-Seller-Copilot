// Módulo de Criptografia Autenticada AES-256-GCM (Fase 4C.1)
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedPayload } from '../types/contracts.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits recomendado pelo NIST para GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits

/**
 * Cifra um dado utilizando AES-256-GCM, gerando IV único e Authentication Tag.
 */
export function encryptAesGcm(
  plaintext: string | Buffer,
  key: Buffer,
  keyVersion: number = 1
): EncryptedPayload {
  if (!key || key.length !== 32) {
    throw new Error('Chave de criptografia inválida: AES-256 requer exatamente 32 bytes (256 bits).');
  }

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });

  const bufferPlaintext = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const ciphertext = Buffer.concat([cipher.update(bufferPlaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion
  };
}

/**
 * Decifra um payload AES-256-GCM validando a integridade e autenticidade da tag.
 * Lança erro se qualquer byte do ciphertext, IV ou auth tag foi alterado.
 */
export function decryptAesGcm(
  payload: EncryptedPayload,
  key: Buffer
): string {
  if (!key || key.length !== 32) {
    throw new Error('Chave de criptografia inválida: AES-256 requer exatamente 32 bytes.');
  }

  if (!payload || !payload.ciphertext || !payload.iv || !payload.authTag) {
    throw new Error('Payload criptográfico incompleto: ciphertext, iv e authTag são obrigatórios.');
  }

  const iv = Buffer.from(payload.iv, 'base64');
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(`IV inválido: esperado ${IV_LENGTH_BYTES} bytes, recebido ${iv.length}.`);
  }

  const authTag = Buffer.from(payload.authTag, 'base64');
  if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error(`Authentication Tag inválida: esperado ${AUTH_TAG_LENGTH_BYTES} bytes, recebido ${authTag.length}.`);
  }

  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });

  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    throw new Error('Falha na autenticação criptográfica AES-GCM: ciphertext ou auth tag adulterados.');
  }
}
