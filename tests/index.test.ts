import { runLivePricingTests } from './ml-live-pricing.test.ts';
import { runMlIntegrationTests } from './mercadolivre-integration.test.ts';
import { runUnificationTests } from './unification.test.ts';
import { runProductWorkspaceTests } from './product-workspace.test.ts';
import { runCatalogWorkflowTests } from './catalog-workflow.test.ts';
import { runSellerWorkflowTests } from './seller-workflow.test.ts';
import { runEanGeneratorTests } from './ean-generator.test.ts';
import { runImportContextRaceTests } from './import-context-race.test.ts';
import { runQuickViewCorrectionTests } from './quick-view-corrections.test.ts';
// Test Runner Principal para todas as Suítes de Testes do Copilot
import { runPricingTests } from './pricing-and-ean.test.ts';
import { runIdentificationTests } from './ai-identification.test.ts';
import { runBlingMapperTests } from './bling-mapper.test.ts';
import { runBlingReconciliationTests } from './bling-reconciliation.test.ts';
import { runSchemaMigrationTests } from './schema-migration.test.ts';
import { runTabContextManagerTests } from './tab-context-manager.test.ts';
import { runSpaDetectorTests } from './spa-detector.test.ts';
import { runMessageRouterTests } from './message-router.test.ts';
import { runGatewaySecurityTests } from './gateway-security.test.ts';
import { runGatewayPostgresTests } from './gateway-postgres.test.ts';
import { runGatewayOAuthRealTests } from './gateway-oauth-real.test.ts';
import { runGatewayProductReadTests } from './gateway-product-read.test.ts';
import { runExtensionProductIntegrationTests } from './extension-product-integration.test.ts';
import { runGatewayAuthOrchestrationTests } from './gateway-auth-orchestration.test.ts';
import { runBlingConnectionUxTests } from './bling-connection-ux.test.ts';
import { runQuickViewAndStockTests } from './quick-view-and-stock.test.ts';
import { runProductListCostInjectorTests } from './product-list-cost-injector.test.ts';
import { runSkuGeneratorTests } from './sku-generator.test.ts';
import { runBlingProductUpdateTests } from './bling-product-update.test.ts';

interface SuiteDefinition {
  name: string;
  phase: string;
  fn: () => Promise<void> | void;
}

const SUITES: SuiteDefinition[] = [
  { name: 'Precificação ML conectada', phase: 'ML', fn: runLivePricingTests },
  { name: 'Mercado Livre: OAuth, publicação e concorrência PostgreSQL', phase: 'ML', fn: runMlIntegrationTests },
  { name: 'Unificação: conteúdo, kits, mercado e publicação', phase: 'Unificação', fn: runUnificationTests },
  { name: 'Biblioteca e continuidade do produto', phase: 'Workspace', fn: runProductWorkspaceTests },
  { name: 'SKU pai/filho, descrição e NCM', phase: 'Catálogo', fn: runCatalogWorkflowTests },
  { name: 'IA e cadastro novo', phase: 'Fluxo seller', fn: runSellerWorkflowTests },
  { name: 'Geração EAN-13 interno', phase: 'Identificação', fn: runEanGeneratorTests },
  { name: 'Motor de Precificação e EAN-13', phase: 'Fase 2', fn: runPricingTests },
  { name: 'Auditoria de IA e Identificação', phase: 'Fase 3', fn: runIdentificationTests },
  { name: 'Mapper Bling', phase: 'Fase 4A', fn: runBlingMapperTests },
  { name: 'Reconciliação Bling', phase: 'Fase 4A', fn: runBlingReconciliationTests },
  { name: 'Migração de Schema & Storage', phase: 'Fase 4A', fn: runSchemaMigrationTests },
  { name: 'TabContextManager', phase: 'Fase 4B', fn: runTabContextManagerTests },
  { name: 'SPA Detector Bling', phase: 'Fase 4B', fn: runSpaDetectorTests },
  { name: 'MessageRouter & Mock 4A', phase: 'Fase 4B', fn: runMessageRouterTests },
  { name: 'Injetor de Custo na Listagem Bling', phase: 'Fase 4D.3', fn: runProductListCostInjectorTests },
  { name: 'Gerador de SKU', phase: 'Fase 4D.3', fn: runSkuGeneratorTests },
  { name: 'Atualização Segura de Produto Bling', phase: 'Base funcional', fn: runBlingProductUpdateTests },
  { name: 'Gateway Security Foundation', phase: 'Fase 4C.1', fn: runGatewaySecurityTests },
  { name: 'Gateway PostgreSQL Durable Persistence', phase: 'Fase 4C.2A', fn: runGatewayPostgresTests },
  { name: 'Gateway Bling Real OAuth2 Integration', phase: 'Fase 4C.2B', fn: runGatewayOAuthRealTests },
  { name: 'Gateway Bling Product Read Endpoint', phase: 'Fase 4C.3', fn: runGatewayProductReadTests },
  { name: 'Extension Real Product Integration & SSOT', phase: 'Fase 4C.3', fn: runExtensionProductIntegrationTests },
  { name: 'Gateway Auth Orchestration & Storage Migration', phase: 'Fase 4C.4A', fn: runGatewayAuthOrchestrationTests },
  { name: 'Bling Connection UX — Sidebar, Dock & Arquitetura', phase: 'Fase 4C.4B', fn: runBlingConnectionUxTests },
  { name: 'Importação: barreiras de contexto', phase: 'Fase 4D.2', fn: runImportContextRaceTests },
  { name: 'Patch corretivo Quick View', phase: 'Fase 4D.2', fn: runQuickViewCorrectionTests },
  { name: 'Quick View, Estoque Real e Cache', phase: 'Fase 4D.2', fn: runQuickViewAndStockTests }
];

async function main() {
  console.log('🚀 INICIANDO TESTES DO PAULIFEST SELLER COPILOT...\n');
  // Todas as suítes de integração compartilham este destino descartável.
  const database = new URL(process.env.DATABASE_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:5432/paulifest_test');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) || database.pathname !== '/paulifest_test') {
    throw new Error('Testes destrutivos exigem banco local descartável paulifest_test.');
  }

  let totalPass = 0;
  let totalFail = 0;
  const suiteStats: { phase: string; name: string; count: number }[] = [];

  // Intercepta console.log para contagem precisa e auditável de testes individuais
  const originalLog = console.log;
  const originalError = console.error;

  let currentSuiteCount = 0;

  console.log = (...args: any[]) => {
    const text = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
    if (text.includes('✓ PASS:')) {
      currentSuiteCount++;
      totalPass++;
    }
    originalLog.apply(console, args);
  };

  console.error = (...args: any[]) => {
    const text = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
    if (text.includes('✗ FAIL:')) {
      totalFail++;
    }
    originalError.apply(console, args);
  };

  try {
    for (const suite of SUITES) {
      currentSuiteCount = 0;
      try {
        await suite.fn();
      } catch (error) {
        console.error(`  ✗ FAIL: Suíte ${suite.name} interrompida: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      suiteStats.push({
        phase: suite.phase,
        name: suite.name,
        count: currentSuiteCount
      });
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  console.log('\n================================================================');
  console.log('       RELATÓRIO CONSOLIDADO DE EXECUÇÃO DE TESTES (E2E)');
  console.log('================================================================');
  for (const s of suiteStats) {
    console.log(`  • [${s.phase}] ${s.name.padEnd(42, ' ')} : ${s.count.toString().padStart(2, ' ')} testes`);
  }
  console.log('----------------------------------------------------------------');
  console.log(`  TOTAL GERAL EXECUTADO: ${totalPass} testes aprovados`);
  if (totalFail > 0) {
    console.log(`  TOTAL DE FALHAS:       ${totalFail} testes falhados`);
  }
  console.log('================================================================\n');

  if (process.exitCode || totalFail > 0) {
    console.error('❌ Falha detectada em uma ou mais suítes.');
    process.exit(1);
  } else {
    console.log('🎉 TODAS AS SUÍTES PASSARAM COM ÊXITO!');
    process.exit(0);
  }
}

main();
