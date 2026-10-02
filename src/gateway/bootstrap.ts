import { MobileCatalog } from './mobile/catalog.ts';
import { BlingOAuthClient } from './integrations/bling/bling-oauth-client.ts';
import { BlingTokenManager } from './integrations/bling/bling-token-manager.ts';
import { BlingProductClient } from './integrations/bling/bling-product-client.ts';
import { MlService, loadMlConfig } from './integrations/mercadolivre/ml-service.ts';
import type { Pool } from 'pg';
import { loadGatewayConfig, type GatewayConfig } from './config.ts';
import { closePool, getPool } from './database/connection.ts';
import { runGatewayMigrations } from './database/migrator.ts';
import { PostgresGatewayRepository } from './database/postgres-repository.ts';
import { GatewayApp } from './http/app.ts';
import { gatewayLogger } from './security/logger.ts';

export interface GatewayRuntime {
  app: GatewayApp;
  config: GatewayConfig;
  pool: Pool;
  port: number;
  close: () => Promise<void>;
}

/**
 * Inicializa o Gateway operacional com persistência PostgreSQL obrigatória.
 * O servidor público nunca utiliza o repositório em memória: ele existe apenas
 * para testes que injetam explicitamente suas dependências em GatewayApp.
 */
export async function startGateway(
  env: Record<string, string | undefined> = process.env
): Promise<GatewayRuntime> {
  const config = loadGatewayConfig(env);
  const mlConfig = loadMlConfig(env);

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL é obrigatória para iniciar o Gateway operacional.');
  }

  const pool = getPool({
    connectionString: config.databaseUrl,
    sslCaPath: config.databaseSslCaPath
  });
  let app: GatewayApp | undefined;

  try {
    await pool.query('SELECT 1');
    const migrationResult = await runGatewayMigrations(pool);
    gatewayLogger.info(
      `Migrações verificadas: ${migrationResult.applied.length} aplicada(s), ${migrationResult.alreadyApplied.length} já existente(s).`
    );

    const repository = new PostgresGatewayRepository(pool);
    const oauthClient = new BlingOAuthClient({clientId:config.blingClientId,clientSecret:config.blingClientSecret,redirectUri:config.blingRedirectUri,baseUrl:config.blingBaseUrl,authUrl:config.blingAuthUrl,timeoutMs:config.blingTimeoutMs});
    const tokenManager = new BlingTokenManager({repository,oauthClient,encryptionKey:config.encryptionKey});
    const productClient = new BlingProductClient({baseUrl:config.blingBaseUrl,timeoutMs:config.blingTimeoutMs});
    app = new GatewayApp({
      oauthClient, tokenManager, productClient,
      mobileCatalog: new MobileCatalog(pool,config,tokenManager,productClient),
      config,
      repository,
      mlService: mlConfig ? new MlService(pool, mlConfig, config.encryptionKey) : undefined,
      healthCheck: async () => {
        const result = await pool.query('SELECT 1 AS alive');
        return result.rows[0]?.alive === 1;
      }
    });
    const port = await app.listen(config.port);
    let closed = false;

    return {
      app,
      config,
      pool,
      port,
      close: async () => {
        if (closed) return;
        closed = true;
        await app?.close();
        await closePool();
      }
    };
  } catch (error) {
    if (app) await app.close().catch(() => undefined);
    await closePool().catch(() => undefined);
    throw error;
  }
}
