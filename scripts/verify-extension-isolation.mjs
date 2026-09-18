// Script de Verificação de Isolamento da Extensão (Fase 4C.1)
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DIST_DIR = resolve(process.cwd(), 'dist');

if (!existsSync(DIST_DIR)) {
  console.error('❌ ERRO: O diretório dist/ não existe. Execute o build da extensão primeiro.');
  process.exit(1);
}

const FORBIDDEN_TOKENS = [
  'BLING_CLIENT_SECRET',
  'GATEWAY_ENCRYPTION_KEY',
  'GATEWAY_JWT_SECRET',
  'InMemoryGatewayRepository',
  'GATEWAY_SCHEMA_SQL',
  'loadGatewayConfig',
  'createDecipheriv',
  'node:crypto',
  'node:http',
  'node:fs'
];

let scannedFiles = 0;
let violationsFound = 0;

function scanDirectory(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      scanDirectory(fullPath);
    } else if (/\.(js|html|css|json)$/i.test(entry)) {
      scannedFiles++;
      const content = readFileSync(fullPath, 'utf8');

      for (const token of FORBIDDEN_TOKENS) {
        if (content.includes(token)) {
          console.error(`❌ VIOLAÇÃO DE ISOLAMENTO em ${entry}: contém o token confidencial/backend "${token}".`);
          violationsFound++;
        }
      }
    }
  }
}

console.log('🔍 Iniciando verificação estática de isolamento do bundle em dist/...');
scanDirectory(DIST_DIR);

if (scannedFiles === 0) {
  console.error('❌ ERRO: Nenhum arquivo foi encontrado no diretório dist/. O build pode ter falhado.');
  process.exit(1);
}

if (violationsFound > 0) {
  console.error(`❌ FALHA: Foram detectadas ${violationsFound} violações de isolamento no bundle da extensão.`);
  process.exit(1);
}

console.log(`✓ SUCESSO: ${scannedFiles} arquivos em dist/ verificados. Zero vazamento de segredos ou código backend.`);
process.exit(0);
