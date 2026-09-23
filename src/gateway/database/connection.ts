// Gerenciador de Conexão e Pool PostgreSQL do Gateway (Fase 4C.2A)
import pg from 'pg';
import type { PoolClient, QueryResult } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gatewayLogger } from '../security/logger.ts';

const { Pool } = pg;

let globalPool: pg.Pool | null = null;

export interface DatabasePoolOptions {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  sslCaPath?: string;
}

function removeConnectionStringSslOptions(connectionString: string): string {
  const parsed = new URL(connectionString);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

/**
 * Obtém ou inicializa o pool PostgreSQL do Gateway.
 * A inicialização é estritamente lazy para garantir que testes unitários e
 * componentes que não usam banco de dados não falhem caso DATABASE_URL não esteja definida.
 */
export function getPool(options: DatabasePoolOptions = {}): pg.Pool {
  if (globalPool) {
    return globalPool;
  }

  const connectionString = options.connectionString || process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL não configurada. Defina a variável de ambiente DATABASE_URL para utilizar a persistência PostgreSQL.'
    );
  }

  const ssl = options.sslCaPath
    ? {
        ca: readFileSync(resolve(options.sslCaPath), 'utf8'),
        rejectUnauthorized: true
      }
    : undefined;

  globalPool = new Pool({
    connectionString: ssl ? removeConnectionStringSslOptions(connectionString) : connectionString,
    ssl,
    max: options.max || 10,
    idleTimeoutMillis: options.idleTimeoutMillis || 10000,
    connectionTimeoutMillis: options.connectionTimeoutMillis || 5000
  });

  globalPool.on('error', (err) => {
    gatewayLogger.error('Erro inesperado no pool de conexões PostgreSQL:', err.message);
  });

  return globalPool;
}

/**
 * Permite injetar explicitamente uma instância de pool (essencial para isolamento em testes).
 */
export function setPool(pool: pg.Pool | null): void {
  globalPool = pool;
}

/**
 * Executa uma query SQL direta no pool.
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPool();
  return pool.query<T>(text, params);
}

/**
 * Adquire um cliente dedicado do pool.
 * Lembre-se sempre de chamar client.release() em bloco finally.
 */
export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

/**
 * Executa uma operação encapsulada em transação ACID curta.
 * Garante COMMIT automático no sucesso e ROLLBACK completo em caso de erro,
 * sempre liberando o cliente de volta ao pool no bloco finally.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  clientOrOptions?: PoolClient
): Promise<T> {
  const client = clientOrOptions || (await getClient());
  const isManagedClient = !clientOrOptions;

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr: any) {
      gatewayLogger.error('Erro ao executar rollback da transação:', rollbackErr.message);
    }
    throw err;
  } finally {
    if (isManagedClient) {
      client.release();
    }
  }
}

/**
 * Encerra graciosamente o pool de conexões.
 */
export async function closePool(): Promise<void> {
  if (globalPool) {
    await globalPool.end();
    globalPool = null;
  }
}

/**
 * Verifica se a conexão com o banco de dados está ativa e respondendo (SELECT 1).
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as alive');
    return result.rows[0]?.alive === 1;
  } catch {
    return false;
  }
}
