// Testes Unitários: Injetor de Coluna de Preço de Custo na Listagem de Produtos (produtos.php)
import assert from 'node:assert';
import {
  extractProductIdFromRow,
  formatCostValue
} from '../src/content-scripts/bling/product-list-cost-injector.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err?.stack || err?.message || err}`);
    process.exitCode = 1;
  }
}

export async function runProductListCostInjectorTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: INJETOR DE CUSTO NA LISTAGEM BLING');
  console.log('================================================================\n');

  // Helper para simular elementos HTMLElement com atributos e seletores
  function createMockRow(options: {
    attributes?: Record<string, string>;
    id?: string;
    checkboxValue?: string;
    editHref?: string;
  }): HTMLElement {
    const attrs = options.attributes || {};
    const mockEl: any = {
      id: options.id || '',
      getAttribute: (name: string) => attrs[name] || null,
      querySelector: (selector: string) => {
        if (selector.includes('input[type="checkbox"]') && options.checkboxValue) {
          return { value: options.checkboxValue };
        }
        if (selector.includes('a[href') && options.editHref) {
          return { href: options.editHref };
        }
        return null;
      }
    };
    return mockEl;
  }

  // 1. Extração via data-id direto
  await runTest('1. Extração: identifica ID via atributo data-id no tr', () => {
    const row = createMockRow({ attributes: { 'data-id': '16709078436' } });
    const id = extractProductIdFromRow(row);
    assert.strictEqual(id, '16709078436');
  });

  // 2. Extração via data-id-produto
  await runTest('2. Extração: identifica ID via data-id-produto', () => {
    const row = createMockRow({ attributes: { 'data-id-produto': '9988776655' } });
    const id = extractProductIdFromRow(row);
    assert.strictEqual(id, '9988776655');
  });

  // 3. Extração via ID do elemento tr (item-12345)
  await runTest('3. Extração: identifica ID a partir do id do elemento tr (item-12345)', () => {
    const row = createMockRow({ id: 'item-12345678' });
    const id = extractProductIdFromRow(row);
    assert.strictEqual(id, '12345678');
  });

  // 4. Extração via checkbox de seleção (name="idProduto[]")
  await runTest('4. Extração: identifica ID via checkbox de seleção de linha do Bling', () => {
    const row = createMockRow({ checkboxValue: '5544332211' });
    const id = extractProductIdFromRow(row);
    assert.strictEqual(id, '5544332211');
  });

  // 5. Extração via link de edição SPA (produtos.php#edit/12345)
  await runTest('5. Extração: identifica ID via link de edição em hash SPA (#edit/12345)', () => {
    const row = createMockRow({ editHref: 'https://www.bling.com.br/produtos.php#edit/88776655' });
    const id = extractProductIdFromRow(row);
    assert.strictEqual(id, '88776655');
  });

  // 6. Linha sem identificador válido
  await runTest('6. Extração: retorna null para linha sem identificador ou cabeçalho', () => {
    const row = createMockRow({});
    const id = extractProductIdFromRow(row);
    assert.strictEqual(id, null);
  });

  // 7. Formatação de valores de custo
  await runTest('7. Formatação: formata valores numéricos em BRL e valores vazios em hífen', () => {
    assert.strictEqual(formatCostValue(null), '-');
    assert.strictEqual(formatCostValue(undefined), '-');
    assert.strictEqual(formatCostValue(0), 'R$ 0,00');
    assert.strictEqual(formatCostValue(45.9), 'R$ 45,90');
    assert.strictEqual(formatCostValue(1250.75), 'R$ 1250,75');
  });

  // 8. MessageRouter: busca de lote de custos no modo mock
  await runTest('8. MessageRouter: handleBlingGetProductsCostList retorna custos determinísticos sem cache local', async () => {
    const router = new MessageRouter(undefined, { mockMode: true });

    let responseResult: any = null;
    await router.handleBlingGetProductsCostList(
      { productIds: ['101', '102', '103'] },
      (res) => { responseResult = res; }
    );

    assert.ok(responseResult);
    assert.strictEqual(responseResult.ok, true);
    assert.ok(responseResult.costs);
    assert.ok(typeof responseResult.costs['101'] === 'number');
    assert.ok(typeof responseResult.costs['102'] === 'number');
    assert.ok(typeof responseResult.costs['103'] === 'number');

    // Segunda chamada produz os mesmos valores sem depender de cache no background.
    let cachedResponse: any = null;
    await router.handleBlingGetProductsCostList(
      { productIds: ['101', '102'] },
      (res) => { cachedResponse = res; }
    );

    assert.ok(cachedResponse?.ok);
    assert.strictEqual(cachedResponse.costs['101'], responseResult.costs['101']);
    assert.strictEqual(cachedResponse.costs['102'], responseResult.costs['102']);
  });

  // 9. MessageRouter: descarta IDs inválidos e vazios
  await runTest('9. MessageRouter: filtra IDs maliciosos ou vazios', async () => {
    const router = new MessageRouter(undefined, { mockMode: true });

    let responseResult: any = null;
    await router.handleBlingGetProductsCostList(
      { productIds: ['', '   ', '<script>alert(1)</script>', 'valid_123'] },
      (res) => { responseResult = res; }
    );

    assert.ok(responseResult?.ok);
    assert.ok(responseResult.costs['valid_123'] !== undefined);
    assert.strictEqual(responseResult.costs[''], undefined);
    assert.strictEqual(responseResult.costs['<script>alert(1)</script>'], undefined);
  });

  await runTest('10. Corrida real: mudança de documento durante await descarta todos os custos', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const fakeGateway: any = {
      onAuthInvalidated: () => {},
      fetchBlingProductQuickView: async (id: string) => {
        await pending;
        return { productId: id, costPrice: 42, retrievedAt: new Date().toISOString() };
      }
    };
    const router = new MessageRouter(fakeGateway);
    await tabContextManager.registerOrUpdateTab(777, {
      platform: 'bling', pageType: 'product_list', pageInstanceId: 'list-A',
      url: 'https://www.bling.com.br/produtos.php#list'
    });

    let responseResult: any = null;
    const request = router.handleBlingGetProductsCostList(
      { productIds: ['101'] },
      (res) => { responseResult = res; },
      777,
      'list-A'
    );
    await Promise.resolve();
    await tabContextManager.registerOrUpdateTab(777, {
      pageType: 'product_form_edit', pageInstanceId: 'form-B',
      url: 'https://www.bling.com.br/produtos.php#edit/202', detectedProduct: { id: '202' }
    });
    release();
    await request;

    assert.strictEqual(responseResult?.ok, false);
    assert.strictEqual(responseResult?.stale, true);
    assert.deepStrictEqual(responseResult?.costs, {});
  });
}
