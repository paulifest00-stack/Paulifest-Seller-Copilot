import assert from 'node:assert';
import { 
  classifyBlingUrl, 
  detectBlingScreenContext,
  isBlingDomain,
  isValidProductId
} from '../src/content-scripts/bling/dom-identifier.ts';
import { BlingShadowUi } from '../src/content-scripts/bling/shadow-ui.ts';

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

export async function runSpaDetectorTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: SPA DETECTOR BLING (FASE 4B)');
  console.log('================================================================\n');

  // 1. Classificação de Listagem
  await runTest('1. Listagem de Produtos: identifica rota /produtos como product_list', () => {
    const res1 = classifyBlingUrl('https://www.bling.com.br/produtos');
    assert.strictEqual(res1.pageType, 'product_list');
    assert.strictEqual(res1.detectedId, undefined);

    const res2 = classifyBlingUrl('https://www.bling.com.br/produtos/lista');
    assert.strictEqual(res2.pageType, 'product_list');
  });

  // 2. Classificação de Edição via Path
  await runTest('2. Edição de Produto: identifica rota /produtos/editar/:id como product_form_edit com ID extraído', () => {
    const res = classifyBlingUrl('https://www.bling.com.br/produtos/editar/998877');
    assert.strictEqual(res.pageType, 'product_form_edit');
    assert.strictEqual(res.detectedId, '998877');
  });

  // 3. Classificação de Novo Produto (Regra 6: Nunca inventar ID)
  await runTest('3. Novo Produto: identifica /produtos/novo como product_form_new sem inventar ID', () => {
    const res = classifyBlingUrl('https://www.bling.com.br/produtos/novo');
    assert.strictEqual(res.pageType, 'product_form_new');
    assert.strictEqual(res.detectedId, undefined, 'Jamais deve inventar ID para produto novo');

    const context = detectBlingScreenContext('https://www.bling.com.br/produtos/novo');
    assert.strictEqual(context.pageType, 'product_form_new');
    assert.strictEqual(context.detectedProduct?.id, undefined);
  });

  // 4. Classificação de Outras Telas
  await runTest('4. Outras Telas: rotas não relacionadas retornam "other" para dock oculto', () => {
    const res1 = classifyBlingUrl('https://www.bling.com.br/pedidos/vendas');
    assert.strictEqual(res1.pageType, 'other');

    const res2 = classifyBlingUrl('https://www.bling.com.br/financeiro/contas');
    assert.strictEqual(res2.pageType, 'other');
  });

  // 5. Edição via Query Parameters
  await runTest('5. Query Parameters: identifica ?id=554433 ou ?idProduto=554433 como product_form_edit', () => {
    const res = classifyBlingUrl('https://www.bling.com.br/cadastros.produtos.php?id=554433');
    assert.strictEqual(res.pageType, 'product_form_edit');
    assert.strictEqual(res.detectedId, '554433');
  });

  // 6. Robustez com URLs Inválidas ou Truncadas
  await runTest('6. Robustez: lida com URLs vazias ou malformadas sem lançar exceção', () => {
    const res1 = classifyBlingUrl('');
    assert.strictEqual(res1.pageType, 'other');

    const res2 = classifyBlingUrl('não-é-uma-url');
    assert.strictEqual(res2.pageType, 'other');
  });

  // 7. Prioridade da URL sobre o DOM (Regra 2)
  await runTest('7. Prioridade de ID: ID da URL tem prioridade sobre atributos de DOM', () => {
    const fakeDoc = {
      querySelector: (selector: string) => {
        if (selector.includes('id')) return { value: 'ID_DO_DOM_777' };
        if (selector.includes('codigo')) return { value: 'SKU_VISUAL_ABC' };
        return null;
      }
    };

    const context = detectBlingScreenContext(
      'https://www.bling.com.br/produtos/editar/ID_DA_URL_111',
      fakeDoc
    );

    // O ID da URL deve prevalecer rigorosamente sobre o do DOM
    assert.strictEqual(context.detectedProduct?.id, 'ID_DA_URL_111');
    // O SKU do DOM entra apenas como contexto de navegação
    assert.strictEqual(context.detectedProduct?.sku, 'SKU_VISUAL_ABC');
  });

  // 8. Validação Estrita de Domínio (Requisito 6)
  await runTest('8. Validação Estrita de Domínio (Requisito 6): rejeita domínios maliciosos ou parciais', () => {
    assert.strictEqual(isBlingDomain('bling.com.br'), true);
    assert.strictEqual(isBlingDomain('www.bling.com.br'), true);
    assert.strictEqual(isBlingDomain('app.bling.com.br'), true);
    assert.strictEqual(isBlingDomain('beta.bling.com.br'), true);
    assert.strictEqual(isBlingDomain('evil-bling.com.br'), false);
    assert.strictEqual(isBlingDomain('notbling.com.br'), false);
    assert.strictEqual(isBlingDomain('bling.com.br.attacker.com'), false);
    assert.strictEqual(isBlingDomain('https://evil-bling.com.br/produtos'), false);
    assert.strictEqual(isBlingDomain('https://attacker.com?ref=bling.com.br'), false);

    assert.strictEqual(classifyBlingUrl('https://evil-bling.com.br/produtos/editar/100').pageType, 'other');
    assert.strictEqual(classifyBlingUrl('https://attacker.com?ref=bling.com.br').pageType, 'other');
  });

  // 9. Formato Restritivo de ID (Requisito 5)
  await runTest('9. Formato Restritivo de ID (Requisito 5): rejeita query params e IDs com HTML, scripts ou caracteres especiais', () => {
    assert.strictEqual(isValidProductId('123456'), true);
    assert.strictEqual(isValidProductId('PROD_ABC-123'), true);
    assert.strictEqual(isValidProductId('<script>alert(1)</script>'), false);
    assert.strictEqual(isValidProductId('123"onmouseover="alert(1)'), false);
    assert.strictEqual(isValidProductId('123<img src=x>'), false);
    assert.strictEqual(isValidProductId('   '), false);
    assert.strictEqual(isValidProductId(''), false);

    // Query params com injeção HTML não são aceitos como detectedId
    const resXss1 = classifyBlingUrl('https://www.bling.com.br/cadastros.produtos.php?id=<script>alert(1)</script>');
    assert.strictEqual(resXss1.detectedId, undefined, 'Não deve extrair ID com tag script');

    const resXss2 = classifyBlingUrl('https://www.bling.com.br/cadastros.produtos.php?id=100"onerror="alert(1)');
    assert.strictEqual(resXss2.detectedId, undefined, 'Não deve extrair ID com aspas/atributos HTML');

    const resValid = classifyBlingUrl('https://www.bling.com.br/cadastros.produtos.php?id=889977');
    assert.strictEqual(resValid.detectedId, '889977');
  });

  // 10. Sanitização do Shadow DOM e Renderização Segura (Requisito 5)
  await runTest('10. Sanitização do Shadow DOM (Requisito 5): tags HTML são renderizadas como texto via textContent sem criar nós de markup', () => {
    const elementsById = new Map<string, any>();
    
    function createMockElement(tag: string) {
      const el: any = {
        tagName: tag.toUpperCase(),
        children: [] as any[],
        textContent: '',
        className: '',
        disabled: false,
        appendChild(child: any) {
          el.children.push(child);
          return child;
        },
        replaceChildren(...newChildren: any[]) {
          el.children = [...newChildren];
        },
        addEventListener() {}
      };
      return el;
    }

    const mockShadowRoot: any = {
      innerHTML: '',
      getElementById(id: string) {
        return elementsById.get(id) || null;
      }
    };

    const hostDiv: any = {
      id: 'paulifest-seller-copilot-host',
      attachShadow: () => mockShadowRoot,
      shadowRoot: mockShadowRoot,
      parentElement: { removeChild: () => {} }
    };

    (globalThis as any).document = {
      body: { appendChild: () => {} },
      getElementById: (id: string) => (id === 'paulifest-seller-copilot-host' ? hostDiv : null),
      createElement: (tag: string) => createMockElement(tag)
    };

    elementsById.set('dock-root', createMockElement('div'));
    elementsById.set('feedback-container', createMockElement('div'));
    elementsById.set('product-info-container', createMockElement('div'));
    elementsById.set('tooltip-container', createMockElement('div'));
    elementsById.set('btn-open-copilot', createMockElement('button'));
    elementsById.set('btn-prepare-ml', createMockElement('button'));

    const ui = new BlingShadowUi({ onAction: () => {} });
    ui.mount();

    ui.update(
      {
        dockVisible: true,
        canImport: true,
        isSimulatedMock: true,
        actionFeedback: {
          type: 'success',
          message: '<img src=x onerror=alert(1)> Sucesso seguro!'
        }
      },
      'product_form_edit',
      { id: '<script>alert("xss")</script>' }
    );

    const feedbackContainer = elementsById.get('feedback-container');
    assert.strictEqual(feedbackContainer.children.length, 1);
    const feedbackBadge = feedbackContainer.children[0];
    assert.strictEqual(feedbackBadge.textContent, '<img src=x onerror=alert(1)> Sucesso seguro!');
    assert.strictEqual(feedbackBadge.children.length, 0, 'Nenhum nó img ou elemento HTML deve ter sido instanciado');

    const productInfo = elementsById.get('product-info-container');
    assert.strictEqual(productInfo.children.length, 1);
    const labelSpan = productInfo.children[0];
    assert.strictEqual(labelSpan.children.length, 1);
    const tagSpan = labelSpan.children[0];
    assert.strictEqual(tagSpan.textContent, '#<script>alert("xss")</script>');
    assert.strictEqual(tagSpan.children.length, 0, 'Nenhum nó script deve ter sido instanciado');
  });
}

