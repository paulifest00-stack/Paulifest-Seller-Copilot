// Test Runner Principal para todas as Suítes de Testes do Copilot
import { runPricingTests } from './pricing-and-ean.test.ts';
import { runIdentificationTests } from './ai-identification.test.ts';
import { runBlingMapperTests } from './bling-mapper.test.ts';
import { runBlingReconciliationTests } from './bling-reconciliation.test.ts';
import { runSchemaMigrationTests } from './schema-migration.test.ts';

async function main() {
  console.log('🚀 INICIANDO TESTES DO PAULIFEST SELLER COPILOT...');
  await runPricingTests();
  await runIdentificationTests();
  await runBlingMapperTests();
  await runBlingReconciliationTests();
  await runSchemaMigrationTests();

  if (process.exitCode) {
    console.error('❌ Falha detectada em uma ou mais suítes.');
    process.exit(1);
  } else {
    console.log('🎉 TODAS AS SUÍTES PASSARAM COM ÊXITO!');
  }
}

main();
