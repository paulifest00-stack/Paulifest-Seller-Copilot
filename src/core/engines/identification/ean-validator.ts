// Validador e utilitário de Códigos EAN / GTIN (Algoritmo Módulo 10 Oficial GS1)

export interface EanValidationResult {
  valid: boolean;
  cleanCode: string;
  expectedCheckDigit?: number;
  actualCheckDigit?: number;
  format: 'EAN-13' | 'GTIN-8' | 'GTIN-12' | 'GTIN-14' | 'NONE' | 'INVALID';
  isMissing?: boolean;
  message: string;
}

/**
 * Calcula o dígito verificador módulo 10 ponderado conforme padrão GS1.
 */
export function calculateEanCheckDigit(digitsWithoutCheck: string): number {
  const digits = digitsWithoutCheck.replace(/\D/g, '');
  let sum = 0;
  
  // O peso alterna: o dígito imediatamente anterior ao verificador tem peso 3, o anterior peso 1, etc.
  // Iterando da direita para a esquerda:
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += parseInt(digits[i], 10) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Valida se um código EAN/GTIN possui checksum matematicamente autêntico.
 * Se o campo estiver vazio, considera válido como "Produto sem GTIN informado".
 */
export function validateEan(rawCode: string): EanValidationResult {
  if (!rawCode || rawCode.trim() === '') {
    return {
      valid: true,
      cleanCode: '',
      format: 'NONE',
      isMissing: true,
      message: 'Produto sem GTIN informado.'
    };
  }

  const clean = rawCode.replace(/\D/g, '');

  if (![8, 12, 13, 14].includes(clean.length)) {
    return {
      valid: false,
      cleanCode: clean,
      format: 'INVALID',
      isMissing: false,
      message: `Tamanho inválido (${clean.length} dígitos). GTIN deve ter 8, 12, 13 ou 14 dígitos.`
    };
  }

  const format = clean.length === 13 ? 'EAN-13' : clean.length === 8 ? 'GTIN-8' : clean.length === 12 ? 'GTIN-12' : 'GTIN-14';
  const payload = clean.slice(0, -1);
  const actualCheck = parseInt(clean.slice(-1), 10);
  const expectedCheck = calculateEanCheckDigit(payload);

  if (actualCheck === expectedCheck) {
    return {
      valid: true,
      cleanCode: clean,
      actualCheckDigit: actualCheck,
      expectedCheckDigit: expectedCheck,
      format,
      isMissing: false,
      message: `Código ${format} com dígito verificador válido.`
    };
  }

  return {
    valid: false,
    cleanCode: clean,
    actualCheckDigit: actualCheck,
    expectedCheckDigit: expectedCheck,
    format,
    isMissing: false,
    message: `Dígito verificador inválido. Encontrado: ${actualCheck}, Esperado: ${expectedCheck}.`
  };
}

/**
 * ATENÇÃO: Utilitário exclusivo para testes e fixtures controladas.
 * Apenas calcula o checksum matemático de um prefixo numérico para suítes de teste.
 * NÃO gera e NUNCA deve ser usado para atribuir GTIN oficial a produtos reais.
 */
export function generateTestEan13Checksum(prefix12: string): string {
  const digits = prefix12.replace(/\D/g, '').padEnd(12, '0').slice(0, 12);
  const check = calculateEanCheckDigit(digits);
  return `${digits}${check}`;
}
