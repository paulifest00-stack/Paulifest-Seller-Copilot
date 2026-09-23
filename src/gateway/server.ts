import { startGateway, type GatewayRuntime } from './bootstrap.ts';
import { gatewayLogger } from './security/logger.ts';

let runtime: GatewayRuntime | undefined;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  gatewayLogger.info(`Encerrando Gateway após ${signal}.`);

  try {
    await runtime?.close();
    process.exitCode = 0;
  } catch (error) {
    gatewayLogger.error('Falha ao encerrar o Gateway com segurança.', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  runtime = await startGateway();
  gatewayLogger.info(`Gateway operacional iniciado na porta ${runtime.port}.`);
} catch (error) {
  gatewayLogger.error('Não foi possível iniciar o Gateway.', error);
  process.exitCode = 1;
}
