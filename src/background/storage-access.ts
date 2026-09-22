/** MV3: credentials only in trusted extension contexts. UI never receives them in messages. */
export async function restrictCredentialStorage(storage: Pick<typeof chrome.storage, 'local' | 'session'>): Promise<void> {
  if (typeof storage.local?.setAccessLevel !== 'function' || typeof storage.session?.setAccessLevel !== 'function') {
    throw new Error('Isolamento de credenciais indisponível. Chrome 114+ obrigatório.');
  }
  await Promise.all([
    storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]);
}
