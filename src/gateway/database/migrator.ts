// Runner Transacional e Idempotente de Migrations do Gateway (Fase 4C.2A)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { getClient, getPool } from './connection.ts';
import { gatewayLogger } from '../security/logger.ts';

export interface MigrationDefinition {
  name: string;
  sql: string;
}

/**
 * Localiza o diretório canônico de arquivos .sql de migração.
 * Suporta execução em desenvolvimento (src/) e em distribuição (dist-gateway/).
 */
export function getMigrationsDirectory(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidateCurrent = join(currentDir, 'migrations');
  if (existsSync(candidateCurrent)) {
    return candidateCurrent;
  }
  const candidateSrc = resolve(process.cwd(), 'src/gateway/database/migrations');
  if (existsSync(candidateSrc)) {
    return candidateSrc;
  }
  throw new Error(`Diretório de migrations do Gateway não encontrado em: ${candidateCurrent} ou ${candidateSrc}`);
}

/**
 * Carrega dinamicamente as migrações a partir dos arquivos .sql em disco.
 * Esta é a única fonte canônica de schema e DDL do Gateway.
 */
export function loadMigrationDefinitions(migrationsDir: string = getMigrationsDirectory()): MigrationDefinition[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((file) => {
    const name = file.replace(/\.sql$/, '');
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    return { name, sql };
  });
}

/**
 * Obtém o SQL canônico de uma migration pelo nome diretamente do arquivo em disco.
 */
export function getMigrationSql(name: string, migrationsDir: string = getMigrationsDirectory()): string {
  const filePath = join(migrationsDir, `${name}.sql`);
  if (!existsSync(filePath)) {
    throw new Error(`Arquivo de migração não encontrado: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

export class GatewayMigrator {
  private pool?: Pool;

  constructor(pool?: Pool) {
    this.pool = pool;
  }

  private async acquireClient(): Promise<PoolClient> {
    if (this.pool) {
      return this.pool.connect();
    }
    return getClient();
  }

  /**
   * Executa todas as migrations pendentes dentro de advisory lock distribuído.
   */
  async runMigrations(customMigrations?: MigrationDefinition[]): Promise<{
    applied: string[];
    alreadyApplied: string[];
  }> {
    const client = await this.acquireClient();
    const migrationsToRun = customMigrations || loadMigrationDefinitions();
    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    try {
      // 1. Adquire Advisory Lock consultivo exclusivo para impedir corrida entre réplicas
      await client.query("SELECT pg_advisory_lock(hashtext('gateway_migrations_lock'))");

      // 2. Garante a existência da tabela de controle de migrations
      await client.query(`
        CREATE TABLE IF NOT EXISTS gateway_migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 3. Lê migrations já aplicadas
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM gateway_migrations ORDER BY id ASC'
      );
      const appliedSet = new Set(rows.map((r) => r.name));
      alreadyApplied.push(...rows.map((r) => r.name));

      // 4. Executa cada migration pendente em sua própria transação ACID
      for (const migration of migrationsToRun) {
        if (appliedSet.has(migration.name)) {
          continue;
        }

        gatewayLogger.info(`Aplicando migração do Gateway: ${migration.name}...`);

        try {
          await client.query('BEGIN');
          await client.query(migration.sql);
          await client.query('INSERT INTO gateway_migrations (name) VALUES ($1)', [migration.name]);
          await client.query('COMMIT');
          applied.push(migration.name);
          gatewayLogger.info(`Migração ${migration.name} aplicada com sucesso.`);
        } catch (err: any) {
          await client.query('ROLLBACK');
          gatewayLogger.error(`Falha ao aplicar migração ${migration.name}. Rollback executado:`, err.message);
          throw new Error(`MigrationError [${migration.name}]: ${err.message}`);
        }
      }

      return { applied, alreadyApplied };
    } finally {
      try {
        // Libera imediatamente o advisory lock para não travar conexões subsequentes
        await client.query("SELECT pg_advisory_unlock(hashtext('gateway_migrations_lock'))");
      } catch (unlockErr: any) {
        gatewayLogger.error('Erro ao liberar advisory lock de migrations:', unlockErr.message);
      }
      client.release();
    }
  }

  /**
   * Consulta as migrations registradas na tabela do banco.
   */
  async getAppliedMigrations(): Promise<string[]> {
    const client = await this.acquireClient();
    try {
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM gateway_migrations ORDER BY id ASC'
      );
      return rows.map((r) => r.name);
    } catch {
      return [];
    } finally {
      client.release();
    }
  }
}

export async function runGatewayMigrations(pool?: Pool): Promise<{
  applied: string[];
  alreadyApplied: string[];
}> {
  const migrator = new GatewayMigrator(pool || getPool());
  return migrator.runMigrations();
}
