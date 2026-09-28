export interface SkuBlocks { brand: string; product: string; fixed: string; quantity: string; variation: string }
export const sanitizeSkuBlock = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

const BRANDS: Record<string, string> = {
  'CASA IN KICHEN': 'CIK',
  'CASA IN KITCHEN': 'CIK',
  'NORCAU PURATOS': 'PUR',
  PURATOS: 'PUR',
  NORCAU: 'NOR',
  POPPER: 'POP',
  BOMPACK: 'BP',
  'GOUR MAX': 'GM',
  'PIC PIC': 'PP',
  FREEGELLS: 'FRE',
  ' SINA ': 'SIN',
  SILVER: 'SIL',
  STRAWPLAST: 'STR',
  COPOBRAS: 'CPB',
  GALVANOTEK: 'GAL',
  PRAZOPACK: 'PRZ',
  REGINA: 'REG',
  CROMUS: 'CRO',
  GENERICO: 'GEN',
  GENERICA: 'GEN',
  'SEM MARCA': 'GEN'
};

const COLORS: Record<string, string> = {
  AZUL: 'AZ',
  VERMELHO: 'VM',
  VERMELHA: 'VM',
  AMARELO: 'AM',
  AMARELA: 'AM',
  PRETO: 'PR',
  PRETA: 'PR',
  BRANCO: 'BR',
  BRANCA: 'BR',
  ROSA: 'RS',
  PINK: 'PK',
  VERDE: 'VD',
  ROXO: 'RX',
  ROXA: 'RX',
  LILAS: 'LI',
  LARANJA: 'LJ',
  DOURADO: 'DOU',
  DOURADA: 'DOU',
  OURO: 'DOU',
  PRATA: 'PRT',
  PRATEADO: 'PRT',
  PRATEADA: 'PRT',
  MARROM: 'MR',
  CINZA: 'CZ',
  GRAFITE: 'GF',
  BEGE: 'BG',
  NUDE: 'ND',
  TRANSPARENTE: 'TR',
  CRISTAL: 'CR',
  INCOLOR: 'INC',
  COLORIDO: 'COR',
  COLORIDA: 'COR',
  SORTIDO: 'SRT',
  SORTIDA: 'SRT',
  MULTICOR: 'MC',
  TIFFANY: 'TIF',
  MARSALA: 'MRS',
  NEON: 'NEO'
};

const FLAVORS: Record<string, string> = {
  MORANGO: 'MOR',
  UVA: 'UVA',
  MENTA: 'MEN',
  HORTELA: 'HOR',
  LIMAO: 'LIM',
  CEREJA: 'CER',
  ABACAXI: 'ABA',
  MELANCIA: 'MEL',
  MARACUJA: 'MCJ',
  FRAMBOESA: 'FRA',
  PESSEGO: 'PES',
  COCO: 'COC',
  CHOCOLATE: 'CHO',
  BAUNILHA: 'BAU',
  CARAMELO: 'CAR',
  CAFE: 'CAF',
  LEITE: 'LEI',
  TUTTIFRUTTI: 'TUT',
  TUTTI: 'TUT',
  MACA: 'MAC',
  BANANA: 'BAN',
  AMORA: 'AMO',
  ACAI: 'ACA',
  EUCALIPTO: 'EUC',
  CANELA: 'CAN',
  MEL: 'MEL',
  PISTACHE: 'PIS',
  AVELA: 'AVE',
  TRADICIONAL: 'TRD',
  ORIGINAL: 'ORG',
  NATURAL: 'NAT'
};

const STOP_WORDS = new Set([
  'DE', 'DA', 'DO', 'DAS', 'DOS', 'COM', 'SEM', 'PARA', 'POR', 'EM', 'E', 'NO', 'NA',
  'UN', 'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'PC', 'PCA', 'PCS', 'PECA', 'PECAS',
  'ML', 'GR', 'GRAMAS', 'KG', 'LT', 'LITRO', 'LITROS',
  'TAM', 'TAMANHO', 'SABOR', 'COR', 'TIPO', 'MODELO', 'CX', 'PCT', 'FRUTTI',
  'INFANTIL', 'ADULTO', 'DESCARTAVEL', 'DESCARTAVEIS', 'SPRAY', 'DECORAR', 'BOLOS', 'BOLO',
  'TERROR', 'PELUCIA'
]);

const WORD_ABBR: Record<string, string> = {
  MASCARA: 'MASC',
  RIGIDA: 'RGD',
  RIGIDO: 'RGD',
  TOUCA: 'TOUC',
  DESMOLDANTE: 'DESM',
  CONFEITAR: 'CONF',
  CONFEITARIA: 'CONF',
  BATMAN: 'BATM',
  THOR: 'THOR',
  HULK: 'HULK',
  HMFRO: 'HMFRO',
  HMARA: 'HMARA',
  CAPAM: 'CAPAM',
  MLHMR: 'MLHMR',
  BALAO: 'BALAO'
};

function abbreviateWord(word: string): string {
  if (WORD_ABBR[word]) return WORD_ABBR[word];
  if (word === 'KIT') return 'KT';
  return word.slice(0, 4);
}

function resolveBrandCode(brandInput: string): string {
  const norm = normalize(brandInput);
  if (!norm) return '';
  if (BRANDS[norm]) return BRANDS[norm];
  const parts = norm.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 3) {
    return parts.map(p => p[0]).join('');
  }
  return sanitizeSkuBlock(norm).slice(0, 3);
}

export function generateParentSku(blocks: Omit<SkuBlocks, 'variation'>): string {
  const brand = sanitizeSkuBlock(blocks.brand);
  const product = sanitizeSkuBlock(blocks.product);
  const fixed = sanitizeSkuBlock(blocks.fixed);
  const quantity = sanitizeSkuBlock(blocks.quantity);
  if (brand && !/^[A-Z]{2,4}$/.test(brand)) throw new Error('Marca: use uma sigla de 2 a 4 letras ou deixe vazio.');
  if (!/^[A-Z]{2,8}$/.test(product)) throw new Error('Produto: use uma sigla de 2 a 8 letras.');
  if (fixed && !/^[A-Z0-9]{2,9}$/.test(fixed)) throw new Error('Atributo fixo: use 2 a 9 caracteres.');
  if (quantity && !/^[A-Z0-9]{1,5}$/.test(quantity)) throw new Error('Medida base: use até 5 caracteres ou deixe vazio.');
  const parent = brand + product + fixed + quantity;
  if (parent.length < 5 || parent.length > 16) throw new Error('SKU pai deve ter 5 a 16 caracteres. Ajuste os blocos.');
  return parent;
}

export function generateChildSku(parent: string, variation: string): string {
  if (!/^[A-Z0-9]{5,16}$/.test(parent)) throw new Error('SKU pai inválido.');
  const suffix = sanitizeSkuBlock(variation);
  if (!suffix) throw new Error('Informe a variação.');
  const child = parent + '-' + suffix;
  if (child.length < 7 || child.length > 20) throw new Error('SKU filho deve ter 7 a 20 caracteres. Ajuste os blocos.');
  return child;
}

export function inferSkuBlocks(title: string, brand?: string): SkuBlocks {
  let text = normalize(title)
    .replace(/\bHOMEM DE FERRO\b/g, 'HMFRO')
    .replace(/\bHOMEM ARANHA\b/g, 'HMARA')
    .replace(/\bCAPITAO AMERICA\b/g, 'CAPAM')
    .replace(/\bMULHER MARAVILHA\b/g, 'MLHMR');

  const knownBrand = Object.keys(BRANDS).find(name => (' ' + text + ' ').includes(' ' + name.trim() + ' '));
  const brandName = knownBrand ? knownBrand.trim() : normalize(brand || '');
  let brandCode = knownBrand ? BRANDS[knownBrand] : resolveBrandCode(brandName);
  if (knownBrand) {
    text = (' ' + text + ' ').replace(' ' + knownBrand.trim() + ' ', ' ').trim();
  } else if (brandName) {
    text = (' ' + text + ' ').replace(' ' + brandName + ' ', ' ').trim();
  }

  const hair = /(?:PINTA|TINTA).*CABELO/.test(text);
  const glove = /LUVA.*NITRIL/.test(text);
  const pot = /POTE.*RETANGULAR/.test(text);

  // Detecta sabor ou cor explícita ("SABOR MORANGO", "COR AZUL") ou nos dicionários
  const explicitFlavorMatch = text.match(/(?:^| )SABOR\s+([A-Z]{3,12})(?: |$)/);
  const explicitColorMatch = text.match(/(?:^| )COR\s+([A-Z]{3,12})(?: |$)/);

  const flavorKey = Object.keys(FLAVORS).find(f => new RegExp('(?:^| )' + f + '(?: |$)').test(text));
  const colorKey = Object.keys(COLORS).find(c => new RegExp('(?:^| )' + c + '(?: |$)').test(text));

  const flavorCode = flavorKey
    ? FLAVORS[flavorKey]
    : explicitFlavorMatch
      ? sanitizeSkuBlock(explicitFlavorMatch[1]).slice(0, 3)
      : '';

  const colorCode = colorKey
    ? COLORS[colorKey]
    : explicitColorMatch
      ? sanitizeSkuBlock(explicitColorMatch[1]).slice(0, 3)
      : '';

  // Quantidade / Medida base:
  // - "17 PECAS" -> "17P"
  // - "100UN" -> "100"
  // - "1UN" / "1 UNIDADE" -> "" (omitido!)
  // - "600ML 470G" -> "600" (prioriza volume principal sem sufixo ML)
  const piecesMatch = text.match(/(?:^| )(\d+)\s*(?:PECAS|PECA|PCS|PC)(?: |$)/);
  const unitsMatch = text.match(/(?:^| )(\d+)\s*(?:UNIDADES|UNIDADE|UND|UNID|UN)(?: |$)/);
  const volume = text.match(/(?:^| )(\d+)\s*ML(?: |$)/);
  const weightG = text.match(/(?:^| )(\d+)\s*(?:GR|G)(?: |$)/);
  const weightKg = text.match(/(?:^| )(\d+)\s*KG(?: |$)/);
  const inches = text.match(/(?:^| )(\d+)\s*(?:POL|POLEGADAS)(?: |$)/);
  const size = text.match(/(?:^| )(?:TAM(?:ANHO)? )?(GG|P|M|G)(?: |$)/);

  const piecesVal = piecesMatch?.[1] && Number(piecesMatch[1]) > 1 ? `${piecesMatch[1]}P` : '';
  const unitsVal = unitsMatch?.[1] && Number(unitsMatch[1]) > 1 ? unitsMatch[1] : '';
  const volVal = !pot && volume?.[1] ? volume[1] : '';
  const weightVal = !volVal
    ? (weightKg?.[1] ? weightKg[1] + 'KG' : (weightG?.[1] && Number(weightG[1]) > 1 ? weightG[1] + 'G' : ''))
    : '';
  const quantity = piecesVal || unitsVal || volVal || weightVal || '';

  // Palavras do produto: exclui cores, sabores, medidas e stop words
  const dynamicExcluded = new Set<string>();
  if (explicitFlavorMatch?.[1]) dynamicExcluded.add(explicitFlavorMatch[1]);
  if (explicitColorMatch?.[1]) dynamicExcluded.add(explicitColorMatch[1]);

  const words = text
    .split(/\s+/)
    .filter(w =>
      /^[A-Z]{2,}$/.test(w) &&
      !STOP_WORDS.has(w) &&
      !COLORS[w] &&
      !FLAVORS[w] &&
      !dynamicExcluded.has(w)
    );

  let product = '';
  let fixed = '';

  // Caso especial 1: Máscaras de personagem em EVA ou Rígida (ex: MASCARA INFANTIL EVA THOR -> MASCEVATHOR)
  if (words[0] === 'MASCARA' && (words[1] === 'EVA' || words[1] === 'RIGIDA' || words[1] === 'RIGIDO')) {
    const mat = words[1] === 'EVA' ? 'EVA' : 'RGD';
    const theme = words[2] ? abbreviateWord(words[2]) : '';
    product = 'MASC';
    fixed = mat + theme;
  } else if (words[0] === 'MASCARA' && words.includes('LED')) {
    // Caso especial 2: Máscara com LED sem marca (ex: MASCARA URSO TERROR PELUCIA LED MARROM 1UN -> GENMSKURSOLED)
    if (!brandCode) brandCode = 'GEN';
    const secondNoun = words.find(w => w !== 'MASCARA' && w !== 'LED');
    product = 'MSK' + (secondNoun ? abbreviateWord(secondNoun) : '');
    fixed = 'LED';
  } else if (words[0] === 'KIT' && words[1]) {
    // Caso especial 3: Kits (ex: KIT PARA CONFEITAR ... -> KTCONF)
    product = 'KT' + abbreviateWord(words[1]);
  } else if (hair) {
    product = 'TPC';
    fixed = /FLUORESCENTE|FLUO/.test(text) ? 'FLUO' : '';
  } else if (glove) {
    product = 'LUVNIT';
    fixed = colorCode || '';
  } else if (pot) {
    product = 'POTRET';
  } else if (words.length === 1) {
    product = abbreviateWord(words[0]);
  } else if (words.length >= 2) {
    // Se tem marca definida e a primeira palavra já é um substantivo forte (>= 5 letras, ex: TOUCA, DESMOLDANTE), usa 4 letras da palavra principal
    if (brandCode && words[0].length >= 5) {
      product = abbreviateWord(words[0]);
    } else {
      product = words.slice(0, 2).map(w => w.slice(0, 3)).join('');
    }
    if (/FLUORESCENTE|FLUO/.test(text)) fixed = 'FLUO';
  }

  // Variação: sabor e cor são sempre variação (exceto no caso da família de luva onde a cor fica no pai e o tamanho P/M/G/GG é a variação)
  let variation = '';
  if (glove) {
    variation = size?.[1] || flavorCode || '';
  } else if (pot && volume) {
    variation = volume[1];
  } else if (inches) {
    variation = inches[1] + 'POL' + (colorCode ? colorCode : '');
  } else if (flavorCode) {
    variation = flavorCode;
  } else if (colorCode) {
    variation = colorCode;
  } else if (size?.[1]) {
    variation = size[1];
  }

  return { brand: brandCode, product, fixed, quantity, variation };
}

export function generateSkuFromTitle(title: string, brand?: string, _model?: string): string {
  if (!title?.trim()) return '';
  const blocks = inferSkuBlocks(title, brand);
  try {
    const parent = generateParentSku(blocks);
    return blocks.variation ? generateChildSku(parent, blocks.variation) : parent;
  } catch {
    return '';
  }
}
