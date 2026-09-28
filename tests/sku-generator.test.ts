import assert from 'node:assert';
import { generateParentSku, generateSkuFromTitle, inferSkuBlocks } from '../src/core/engines/identification/sku-generator.ts';

async function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err?.stack || err?.message || err}`);
    process.exitCode = 1;
  }
}

export async function runSkuGeneratorTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: GERADOR DE SKU');
  console.log('================================================================\n');

  await runTest('1. Mesmo produto gera sempre o mesmo SKU', () => {
    const input = 'Furadeira de Impacto Bosch GSB 13 RE 750W 127V';
    assert.strictEqual(generateSkuFromTitle(input, 'Bosch', 'GSB 13 RE'), generateSkuFromTitle(input, 'Bosch', 'GSB 13 RE'));
  });

  await runTest('2. Nome vazio não fabrica identidade de produto', () => {
    assert.strictEqual(generateSkuFromTitle(''), '');
    assert.strictEqual(generateSkuFromTitle('   '), '');
  });

  await runTest('3. SKU remove acentos, pontuação e respeita o limite', () => {
    const sku = generateSkuFromTitle('Câmera Wi-Fi Externa 2K, Branca! 220V', 'Intelbras');
    assert.match(sku, /^[A-Z0-9-]+$/);
    assert.ok(sku.length <= 20);
  });

  await runTest('4. Medida base é opcional (não força 1UN) e sabores/cores viram variação (-VAR)', () => {
    // Sabor vira variação e não entra como bloco do produto; sem medida base forçada
    assert.strictEqual(generateSkuFromTitle('Bala Freegells Morango'), 'FREBALA-MOR');
    assert.strictEqual(generateSkuFromTitle('Bala Freegells Uva 1un'), 'FREBALA-UVA');
    // Cor vira variação e não exige 1UN
    assert.strictEqual(generateSkuFromTitle('Vela Popper Azul'), 'POPVELA-AZ');
    assert.strictEqual(generateSkuFromTitle('Balão Pic Pic Dourado 1 unidade'), 'PPBALAO-DOU');
  });

  await runTest('5. Padrões reais do catálogo Bling (máscaras, kits, peças, volumes e 1UN ignorado)', () => {
    assert.strictEqual(generateSkuFromTitle('MASCARA INFANTIL EVA THOR'), 'MASCEVATHOR');
    assert.strictEqual(generateSkuFromTitle('MASCARA INFANTIL RIGIDA THOR'), 'MASCRGDTHOR');
    assert.strictEqual(generateSkuFromTitle('MASCARA INFANTIL EVA HOMEM DE FERRO'), 'MASCEVAHMFRO');
    assert.strictEqual(generateSkuFromTitle('MASCARA INFANTIL RIGIDA HOMEM DE FERRO'), 'MASCRGDHMFRO');
    assert.strictEqual(generateSkuFromTitle('MASCARA INFANTIL EVA HULK'), 'MASCEVAHULK');
    assert.strictEqual(generateSkuFromTitle('MASCARA INFANTIL EVA BATMAN'), 'MASCEVABATM');
    assert.strictEqual(generateSkuFromTitle('KIT PARA CONFEITAR E DECORAR BOLOS CASA IN KICHEN 17 PECAS'), 'CIKKTCONF17P');
    assert.strictEqual(generateSkuFromTitle('DESMOLDANTE SPRAY NORCAU PURATOS 600ML 470G'), 'PURDESM600');

    // Para itens com cor no título, o SKU pai é BPTOUC100 / GENMSKURSOLED e a variação guarda a cor (BR / MR)
    const toucaBlocks = inferSkuBlocks('TOUCA DESCARTAVEL BOMPACK 100UN BRANCA');
    assert.strictEqual(generateParentSku(toucaBlocks), 'BPTOUC100');
    assert.strictEqual(toucaBlocks.variation, 'BR');

    const ursoBlocks = inferSkuBlocks('MASCARA URSO TERROR PELUCIA LED MARROM 1UN');
    assert.strictEqual(generateParentSku(ursoBlocks), 'GENMSKURSOLED');
    assert.strictEqual(ursoBlocks.quantity, '');
    assert.strictEqual(ursoBlocks.variation, 'MR');
  });
}
