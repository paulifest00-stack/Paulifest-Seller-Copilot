export function parseApiKeys(input: string): string[] {
  const keys = [...new Set(input.split(/[\r\n,;]+/).map(key => key.trim()).filter(Boolean))];
  if (keys.length > 5) throw new Error('Configure no máximo 5 chaves próprias.');
  return keys;
}

export function redactCredentials(message: string, keys: string[]): string {
  return keys.reduce((text, key) => text.split(key).join('[chave omitida]'), message);
}
