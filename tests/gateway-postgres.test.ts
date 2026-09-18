// Suíte Oficial de Testes da Fase 4C.2A: Persistência Durável PostgreSQL do Gateway
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { getPool, closePool, setPool } from '../src/gateway/database/connection.ts';
import { GatewayMigrator, loadMigrationDefinitions, getMigrationSql } from '../src/gateway/database/migrator.ts';
import { PostgresGatewayRepository } from '../src/gateway/database/postgres-repository.ts';
import {
  generateOAuthState,
  generatePairingId,
  generatePairingSecret,
  generateGatewayRefreshToken,
  hashSecret
} from '../src/gateway/crypto/pairing-state.ts';
import type {
  BlingConnectionRecord,
  OAuthPairingRequestRecord,
  GatewaySessionRecord
} from '../src/gateway/types/contracts.ts';

const { Pool } = pg;

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

export async function runGatewayPostgresTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: GATEWAY POSTGRESQL DURABLE PERSISTENCE (FASE 4C.2A)');
  console.log('================================================================\n');

  const databaseUrl = process.env.DATABASE_URL?.trim() || 'postgresql://postgres:postgres@127.0.0.1:5432/paulifest_test';

  // Verificação estrita de conectividade: NÃO pular se o banco não estiver disponível
  let testPool: pg.Pool;
  try {
    testPool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 3000
    });
    const checkClient = await testPool.connect();
    await checkClient.query('SELECT 1 as alive');
    checkClient.release();
  } catch (err: any) {
    console.error('\n❌ ERRO FATAL: Banco de dados PostgreSQL real não está acessível no ambiente.');
    console.error('   A Fase 4C.2 exige execução obrigatória contra PostgreSQL real para validação transacional e concorrência.');
    console.error(`   Detalhe do erro: ${err.message}\n`);
    process.exitCode = 1;
    throw new Error(`PostgreSQL inacessível: ${err.message}`);
  }

  setPool(testPool);
  const migrator = new GatewayMigrator(testPool);
  const repo = new PostgresGatewayRepository(testPool);

  // Helper para limpar banco antes dos testes de migração
  async function dropAllGatewayTables() {
    await testPool.query(`
      DROP TABLE IF EXISTS gateway_refresh_tokens CASCADE;
      DROP TABLE IF EXISTS gateway_sessions CASCADE;
      DROP TABLE IF EXISTS gateway_pairings CASCADE;
      DROP TABLE IF EXISTS bling_connections CASCADE;
      DROP TABLE IF EXISTS gateway_migrations CASCADE;
      DROP TABLE IF EXISTS broken_table CASCADE;
    `);
  }

  try {
    // -------------------------------------------------------------------------
    // 1. Migrations, DDL e Validação de Constraints
    // -------------------------------------------------------------------------
    await runTest('1. Migration em banco limpo: executa DDL sequencial a partir de arquivos SQL versionados em disco e registra na tabela', async () => {
      await dropAllGatewayTables();

      const result = await migrator.runMigrations();
      assert.strictEqual(result.applied.length, 1, 'Deve aplicar exatamente 1 migration');
      assert.strictEqual(result.applied[0], '001_gateway_schema');

      // Valida existência das 4 tabelas e da tabela de controle
      const { rows } = await testPool.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('bling_connections', 'gateway_pairings', 'gateway_sessions', 'gateway_refresh_tokens', 'gateway_migrations')
      `);
      assert.strictEqual(rows.length, 5, 'Todas as 5 tabelas devem ter sido criadas no PostgreSQL');
    });

    await runTest('2. Migration idempotente: reaplicar não falha nem recria registros', async () => {
      const result = await migrator.runMigrations();
      assert.strictEqual(result.applied.length, 0, 'Nenhuma migration adicional deve ser aplicada');
      assert.ok(result.alreadyApplied.includes('001_gateway_schema'), 'Deve constar como já aplicada');

      const appliedList = await migrator.getAppliedMigrations();
      assert.strictEqual(appliedList.length, 1);
    });

    await runTest('3. Rollback de migration com erro: reverte DDL e não registra na tabela de controle', async () => {
      let threw = false;
      const invalidMigration = [
        {
          name: '999_invalid_migration',
          sql: 'CREATE TABLE broken_table (id INT; SINTAXE_INVALIDA);'
        }
      ];

      try {
        await migrator.runMigrations(invalidMigration);
      } catch (err: any) {
        threw = true;
        assert.ok(err.message.includes('MigrationError [999_invalid_migration]'), 'Mensagem de erro descritiva');
      }

      assert.strictEqual(threw, true, 'Deve lançar erro de sintaxe SQL');

      // Confirma que a tabela de migração NÃO registrou o nome com erro
      const applied = await migrator.getAppliedMigrations();
      assert.ok(!applied.includes('999_invalid_migration'), 'Migration com erro não pode ser registrada');

      // Confirma que a tabela quebrada não foi criada
      const { rows } = await testPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'broken_table'"
      );
      assert.strictEqual(rows.length, 0, 'Rollback da transação deve garantir que a tabela não existe');
    });

    await runTest('4. Concorrência de Migrations: duas instâncias simultâneas aplicam migrations sem colisão ou duplicação (Advisory Lock)', async () => {
      await dropAllGatewayTables();

      const migrator1 = new GatewayMigrator(testPool);
      const migrator2 = new GatewayMigrator(testPool);

      const [res1, res2] = await Promise.all([
        migrator1.runMigrations(),
        migrator2.runMigrations()
      ]);

      const totalApplied = res1.applied.length + res2.applied.length;
      assert.strictEqual(totalApplied, 1, 'Exatamente 1 instância deve aplicar a migração');

      // Ambas instâncias devem ter conhecimento da migração aplicada
      const appliedInDb = await migrator.getAppliedMigrations();
      assert.strictEqual(appliedInDb.length, 1);
      assert.strictEqual(appliedInDb[0], '001_gateway_schema');

      // Garante que a tabela não tem duplicação
      const { rows } = await testPool.query<{ count: string }>(
        "SELECT count(*) as count FROM gateway_migrations WHERE name = '001_gateway_schema'"
      );
      assert.strictEqual(parseInt(rows[0].count, 10), 1, 'Deve existir exatamente 1 registro da migração');
    });

    await runTest('5. Migrations: fonte única e canônica a partir de arquivos SQL versionados em disco', async () => {
      const defs = loadMigrationDefinitions();
      assert.ok(defs.length >= 1, 'Deve carregar pelo menos uma migration .sql');
      const schema001 = defs.find((d) => d.name === '001_gateway_schema');
      assert.ok(schema001, 'Deve encontrar 001_gateway_schema');

      const diskSql = fs.readFileSync(path.resolve('src/gateway/database/migrations/001_gateway_schema.sql'), 'utf8');
      assert.strictEqual(schema001.sql, diskSql, 'O SQL da migração deve ser idêntico ao arquivo em disco');
      assert.strictEqual(getMigrationSql('001_gateway_schema'), diskSql);
    });

    await runTest('6. Validação de status de conexão: constraint chk_bling_connection_status rejeita status inválido', async () => {
      let threw = false;
      try {
        await testPool.query(
          `INSERT INTO bling_connections (id, status, created_at, updated_at)
           VALUES ($1, 'status_invalido', NOW(), NOW())`,
          [`conn_invalid_${randomUUID()}`]
        );
      } catch (err: any) {
        threw = true;
        assert.ok(
          err.message.includes('chk_bling_connection_status') || err.message.includes('check constraint'),
          err.message
        );
      }
      assert.strictEqual(threw, true, 'Deve rejeitar status fora de (connected, requires_reauth, disconnected)');
    });

    // -------------------------------------------------------------------------
    // 2. Pareamentos OAuth (Create-Only) & Fases de Callback Desacopladas
    // -------------------------------------------------------------------------
    await runTest('7. Criação e persistência durável de pairing (CREATE-ONLY)', async () => {
      await repo.clearAll();

      const pairingId = generatePairingId();
      const clientSessionId = `cli_${randomUUID()}`;
      const state = generateOAuthState();
      const pairingSecret = generatePairingSecret();

      const pairingRecord: OAuthPairingRequestRecord = {
        pairingId,
        clientSessionId,
        stateHash: hashSecret(state),
        pairingSecretHash: hashSecret(pairingSecret),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      };

      await repo.savePairingRequest(pairingRecord);

      // Consulta por ID
      const byId = await repo.getPairingById(pairingId);
      assert.ok(byId, 'Deve encontrar pairing por pairingId');
      assert.strictEqual(byId?.clientSessionId, clientSessionId);
      assert.strictEqual(byId?.stateHash, pairingRecord.stateHash);
      assert.strictEqual(byId?.stateConsumedAt, null);
      assert.strictEqual(byId?.pairingConsumedAt, null);

      // Consulta por state_hash
      const byState = await repo.getPairingByStateHash(pairingRecord.stateHash);
      assert.ok(byState, 'Deve encontrar pairing por stateHash');
      assert.strictEqual(byState?.pairingId, pairingId);
    });

    await runTest('8. Recriação proibida de pairing: tentar recriar pairing existente falha e não reseta estado ou tentativas', async () => {
      const pairingId = generatePairingId();
      const stateHash = hashSecret(generateOAuthState());
      const secretHash = hashSecret(generatePairingSecret());

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_original',
        stateHash,
        pairingSecretHash: secretHash,
        attemptCount: 3,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Tentativa de recriar com mesmo pairing_id deve falhar
      let threw = false;
      try {
        await repo.savePairingRequest({
          pairingId,
          clientSessionId: 'session_attacker',
          stateHash: hashSecret('new_state'),
          pairingSecretHash: hashSecret('new_secret'),
          attemptCount: 0,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          createdAt: new Date().toISOString()
        });
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, true, 'Deve falhar ao tentar recriar pairing_id existente');

      // Verifica que o pairing original não foi resetado nem adulterado
      const original = await repo.getPairingById(pairingId);
      assert.strictEqual(original?.clientSessionId, 'session_original');
      assert.strictEqual(original?.attemptCount, 3);
    });

    await runTest('9. Consumo atômico de State (consumeOAuthState Fase A): single-use e sem criar conexão placeholder', async () => {
      const pairingId = generatePairingId();
      const state = generateOAuthState();
      const stateHash = hashSecret(state);

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_state_only',
        stateHash,
        pairingSecretHash: hashSecret(generatePairingSecret()),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Fase A: Consumo de State
      const consumeRes = await repo.consumeOAuthState(stateHash);
      assert.strictEqual(consumeRes.ok, true, 'Primeiro consumo de state deve ter sucesso');
      assert.strictEqual(consumeRes.pairingId, pairingId);
      assert.strictEqual(consumeRes.clientSessionId, 'session_state_only');
      assert.strictEqual(consumeRes.pairing?.pairingId, pairingId);
      assert.ok(consumeRes.pairing?.stateConsumedAt, 'stateConsumedAt deve estar preenchido');
      assert.strictEqual(consumeRes.pairing?.connectionId, null, 'Nenhuma conexão placeholder deve ser criada na Fase A');

      // Segundo consumo deve falhar (single-use)
      const secondRes = await repo.consumeOAuthState(stateHash);
      assert.strictEqual(secondRes.ok, false);
      assert.strictEqual(secondRes.error, 'STATE_ALREADY_CONSUMED');
    });

    await runTest('10. Concorrência de State: exatamente 1 de 2 chamadas simultâneas de consumeOAuthState vence', async () => {
      const state = generateOAuthState();
      const stateHash = hashSecret(state);

      await repo.savePairingRequest({
        pairingId: generatePairingId(),
        clientSessionId: 'session_concurrent_consume',
        stateHash,
        pairingSecretHash: hashSecret(generatePairingSecret()),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const [res1, res2] = await Promise.all([
        repo.consumeOAuthState(stateHash),
        repo.consumeOAuthState(stateHash)
      ]);

      const successes = [res1, res2].filter((r) => r.ok);
      const failures = [res1, res2].filter((r) => !r.ok);

      assert.strictEqual(successes.length, 1, 'Exatamente uma chamada concorrente deve vencer');
      assert.strictEqual(failures.length, 1, 'A outra chamada concorrente deve falhar');
      assert.strictEqual(failures[0].error, 'STATE_ALREADY_CONSUMED');
    });

    await runTest('11. State consumido continua consumido mesmo se nenhuma conexão for vinculada depois', async () => {
      const pairingId = generatePairingId();
      const state = generateOAuthState();
      const stateHash = hashSecret(state);

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_no_attach',
        stateHash,
        pairingSecretHash: hashSecret(generatePairingSecret()),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      await repo.consumeOAuthState(stateHash);

      // Consulta no banco: state_consumed_at continua preenchido e connection_id é nulo
      const inDb = await repo.getPairingById(pairingId);
      assert.ok(inDb?.stateConsumedAt);
      assert.strictEqual(inDb?.connectionId, null);

      // Reutilização continua estritamente proibida
      const retry = await repo.consumeOAuthState(stateHash);
      assert.strictEqual(retry.ok, false);
      assert.strictEqual(retry.error, 'STATE_ALREADY_CONSUMED');
    });

    await runTest('12. Vinculação posterior de conexão (attachConnectionToPairing Fase C): vincula connectionId sem alterar state_consumed_at', async () => {
      const pairingId = generatePairingId();
      const state = generateOAuthState();
      const stateHash = hashSecret(state);

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_fase_c',
        stateHash,
        pairingSecretHash: hashSecret(generatePairingSecret()),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Fase A
      const consumed = await repo.consumeOAuthState(stateHash);
      const originalConsumedAt = consumed.pairing?.stateConsumedAt;
      assert.ok(originalConsumedAt);

      // Fase C: cria conexão e vincula
      const connId = `conn_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_cipher',
        encryptedRefreshToken: 'refresh_cipher',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const attached = await repo.attachConnectionToPairing(pairingId, connId);
      assert.strictEqual(attached, true, 'Vinculação deve ter sucesso');

      // Verifica no banco
      const pairingAfter = await repo.getPairingById(pairingId);
      assert.strictEqual(pairingAfter?.connectionId, connId);
      assert.strictEqual(pairingAfter?.stateConsumedAt, originalConsumedAt, 'state_consumed_at não pode ter sido alterado');

      // Tentativa de vincular a pairing inexistente deve falhar
      const badAttach = await repo.attachConnectionToPairing('pairing_inexistente', connId);
      assert.strictEqual(badAttach, false);
    });

    // -------------------------------------------------------------------------
    // 3. Handshake de Pareamento e Sessão
    // -------------------------------------------------------------------------
    await runTest('13. Pairing single-use: primeiro handshake consome segredo; segundo é rejeitado', async () => {
      const pairingId = generatePairingId();
      const state = generateOAuthState();
      const pairingSecret = generatePairingSecret();
      const stateHash = hashSecret(state);
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_cipher',
        encryptedRefreshToken: 'refresh_cipher',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_pairing_single_use',
        stateHash,
        pairingSecretHash: hashSecret(pairingSecret),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      await repo.consumeOAuthState(stateHash);
      await repo.attachConnectionToPairing(pairingId, connId);

      // Primeiro handshake
      const first = await repo.verifyAndConsumePairing(pairingId, pairingSecret);
      assert.strictEqual(first.ok, true, 'Primeiro handshake com segredo válido deve suceder');
      assert.strictEqual(first.pairing?.connectionId, connId);

      // Segundo handshake (tentativa de reaproveitamento)
      const second = await repo.verifyAndConsumePairing(pairingId, pairingSecret);
      assert.strictEqual(second.ok, false);
      assert.strictEqual(second.error, 'PAIRING_ALREADY_CONSUMED');
    });

    await runTest('14. Concorrência de Pairing: exatamente 1 handshake concorrente emite sessão', async () => {
      const pairingId = generatePairingId();
      const state = generateOAuthState();
      const pairingSecret = generatePairingSecret();
      const stateHash = hashSecret(state);
      const connId = `conn_conc_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_cipher',
        encryptedRefreshToken: 'refresh_cipher',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_concurrent_pairing',
        stateHash,
        pairingSecretHash: hashSecret(pairingSecret),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      await repo.consumeOAuthState(stateHash);
      await repo.attachConnectionToPairing(pairingId, connId);

      const [res1, res2] = await Promise.all([
        repo.verifyAndConsumePairing(pairingId, pairingSecret),
        repo.verifyAndConsumePairing(pairingId, pairingSecret)
      ]);

      const successes = [res1, res2].filter((r) => r.ok);
      const failures = [res1, res2].filter((r) => !r.ok);

      assert.strictEqual(successes.length, 1, 'Exatamente uma chamada de handshake deve obter sucesso');
      assert.strictEqual(failures.length, 1, 'A outra chamada deve ser rejeitada');
      assert.strictEqual(failures[0].error, 'PAIRING_ALREADY_CONSUMED');
    });

    await runTest('15. Incremento de tentativa inválida: não bloqueia de imediato (Anti-DoS) e bloqueia após 5 falhas', async () => {
      const pairingId = generatePairingId();
      const state = generateOAuthState();
      const validSecret = generatePairingSecret();
      const stateHash = hashSecret(state);
      const connId = `conn_antidos_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_cipher',
        encryptedRefreshToken: 'refresh_cipher',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await repo.savePairingRequest({
        pairingId,
        clientSessionId: 'session_antidos',
        stateHash,
        pairingSecretHash: hashSecret(validSecret),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });

      await repo.consumeOAuthState(stateHash);
      await repo.attachConnectionToPairing(pairingId, connId);

      // 1ª tentativa errada
      const fail1 = await repo.verifyAndConsumePairing(pairingId, 'wrong_secret_1');
      assert.strictEqual(fail1.ok, false);
      assert.strictEqual(fail1.error, 'INVALID_PAIRING_SECRET');
      assert.strictEqual(fail1.remainingAttempts, 4);

      // 2ª tentativa errada
      const fail2 = await repo.verifyAndConsumePairing(pairingId, 'wrong_secret_2');
      assert.strictEqual(fail2.remainingAttempts, 3);

      // Tentativa correta ainda dentro do limite permitido
      const success = await repo.verifyAndConsumePairing(pairingId, validSecret);
      assert.strictEqual(success.ok, true, 'Segredo válido na 3ª tentativa deve suceder sem bloqueio prematuro');

      // Testa bloqueio total em novo pairing
      const doomedId = generatePairingId();
      const doomedStateHash = hashSecret(generateOAuthState());
      await repo.savePairingRequest({
        pairingId: doomedId,
        clientSessionId: 'session_doomed',
        stateHash: doomedStateHash,
        pairingSecretHash: hashSecret(validSecret),
        attemptCount: 0,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString()
      });
      await repo.consumeOAuthState(doomedStateHash);
      await repo.attachConnectionToPairing(doomedId, connId);

      for (let i = 0; i < 5; i++) {
        await repo.verifyAndConsumePairing(doomedId, `bad_${i}`);
      }

      // 6ª tentativa deve acusar esgotamento de tentativas
      const exhausted = await repo.verifyAndConsumePairing(doomedId, validSecret);
      assert.strictEqual(exhausted.ok, false);
      assert.strictEqual(exhausted.error, 'PAIRING_MAX_ATTEMPTS_EXCEEDED');
    });

    // -------------------------------------------------------------------------
    // 4. Sessões do Gateway, Fail-Closed em Colisões & Rotação
    // -------------------------------------------------------------------------
    await runTest('16. Criação de sessão do Gateway e GRT: falha fechado em caso de colisão de ID ou tokenHash', async () => {
      const connId = `conn_coll_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const sessionId = randomUUID();
      const familyId = randomUUID();
      const token = generateGatewayRefreshToken();
      const hash = hashSecret(token);

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_coll_test',
        tokenFamilyId: familyId,
        refreshTokenHash: hash,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Tentativa de reinserir mesma sessão com mesmo ID (deve falhar fechado com rollback)
      let threwSession = false;
      try {
        await repo.createGatewaySession({
          id: sessionId,
          connectionId: connId,
          clientSessionId: 'cli_coll_attacker',
          tokenFamilyId: randomUUID(),
          refreshTokenHash: hashSecret(generateGatewayRefreshToken()),
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString()
        });
      } catch {
        threwSession = true;
      }
      assert.strictEqual(threwSession, true, 'Colisão de session ID deve falhar fechado');

      // Tentativa de colisão de token_hash deve falhar e dar rollback completo
      let threwToken = false;
      const orphanSessionId = randomUUID();
      try {
        await repo.createGatewaySession({
          id: orphanSessionId,
          connectionId: connId,
          clientSessionId: 'cli_coll_token',
          tokenFamilyId: randomUUID(),
          refreshTokenHash: hash, // Colisão proposital com token existente
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: new Date().toISOString()
        });
      } catch {
        threwToken = true;
      }
      assert.strictEqual(threwToken, true, 'Colisão de token_hash deve falhar fechado');

      // Garante que o rollback impediu a criação da sessão órfã
      const { rows } = await testPool.query(
        'SELECT id FROM gateway_sessions WHERE id = $1',
        [orphanSessionId]
      );
      assert.strictEqual(rows.length, 0, 'Rollback deve garantir que sessão órfã não foi criada');
    });

    await runTest('17. Rotação atômica de GRT: marca token anterior como consumido e gera sucessor', async () => {
      const connId = `conn_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const sessionId = randomUUID();
      const familyId = randomUUID();
      const token1 = generateGatewayRefreshToken();
      const hash1 = hashSecret(token1);

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_session_rotation',
        tokenFamilyId: familyId,
        refreshTokenHash: hash1,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      const token2 = generateGatewayRefreshToken();
      const rotateRes = await repo.rotateGatewaySession(token1, token2, 14);
      assert.strictEqual(rotateRes.ok, true, 'Rotação deve ser concluída com sucesso');
      assert.strictEqual(rotateRes.newSession?.tokenFamilyId, familyId);
      assert.strictEqual(rotateRes.newSession?.refreshTokenHash, hashSecret(token2));

      // Verifica no PostgreSQL que o token1 está marcado com used_at
      const oldToken = await repo.getSessionByRefreshHash(hash1);
      assert.ok(oldToken?.usedAt, 'Token antigo deve possuir used_at preenchido');

      // Verifica que o novo token está ativo e não usado
      const newToken = await repo.getSessionByRefreshHash(hashSecret(token2));
      assert.ok(newToken, 'Novo token deve existir');
      assert.strictEqual(newToken?.usedAt, undefined);
      assert.strictEqual(newToken?.revokedAt, undefined);
    });

    await runTest('18. Reuse Detection: reutilização de token já usado revoga toda a família e a sessão', async () => {
      const connId = `conn_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const sessionId = randomUUID();
      const familyId = randomUUID();
      const tokenA = generateGatewayRefreshToken();
      const tokenB = generateGatewayRefreshToken();

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_session_reuse',
        tokenFamilyId: familyId,
        refreshTokenHash: hashSecret(tokenA),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Rotação legítima de A para B
      await repo.rotateGatewaySession(tokenA, tokenB);

      // Ataque de Replay: invasor tenta rotacionar novamente apresentando o token A
      const tokenC = generateGatewayRefreshToken();
      const attackRes = await repo.rotateGatewaySession(tokenA, tokenC);

      assert.strictEqual(attackRes.ok, false);
      assert.strictEqual(attackRes.error, 'TOKEN_REUSE_DETECTED');
      assert.strictEqual(attackRes.familyRevoked, true);

      // Validação no PostgreSQL: tanto A quanto B e a sessão agora estão revogados!
      const checkB = await repo.getSessionByRefreshHash(hashSecret(tokenB));
      assert.ok(checkB?.revokedAt, 'Token legítimo B deve ter sido revogado defensivamente');

      const { rows } = await testPool.query(
        'SELECT revoked_at FROM gateway_sessions WHERE id = $1',
        [sessionId]
      );
      assert.ok(rows[0].revoked_at, 'Sessão inteira deve ter sido revogada no banco');
    });

    await runTest('19. Revogação de família: invalida todos os tokens da cadeia', async () => {
      const familyId = randomUUID();
      const sessionId = randomUUID();
      const connId = `conn_${randomUUID()}`;

      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const token = generateGatewayRefreshToken();
      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_fam_revoke',
        tokenFamilyId: familyId,
        refreshTokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      await repo.revokeSessionFamily(familyId);

      const session = await repo.getSessionByRefreshHash(hashSecret(token));
      assert.ok(session?.revokedAt, 'Token deve constar como revogado');
    });

    // -------------------------------------------------------------------------
    // 5. Desconexão Segura e Purga Rigorosa de Credenciais
    // -------------------------------------------------------------------------
    await runTest('20. Disconnect rigoroso: purga tokens cifrados (NULL), IV, Tag, expires_at, limpa lease e revoga sessões e GRTs', async () => {
      const connId = `conn_disconnect_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_secret_acc',
        accessTokenIv: 'iv_acc',
        accessTokenTag: 'tag_acc',
        encryptedRefreshToken: 'cipher_secret_ref',
        refreshTokenIv: 'iv_ref',
        refreshTokenTag: 'tag_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        accountIdentifier: 'Empresa Teste LTDA',
        refreshLeaseOwner: 'worker_disc',
        refreshLeaseExpiresAt: new Date(Date.now() + 15000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const sessionId = randomUUID();
      const familyId = randomUUID();
      const token = generateGatewayRefreshToken();

      await repo.createGatewaySession({
        id: sessionId,
        connectionId: connId,
        clientSessionId: 'cli_disconnect',
        tokenFamilyId: familyId,
        refreshTokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: new Date().toISOString()
      });

      // Executa desconexão
      await repo.deleteConnection(connId);

      // Consulta direta via SQL na tabela bling_connections
      const { rows: connRows } = await testPool.query(
        'SELECT * FROM bling_connections WHERE id = $1',
        [connId]
      );
      assert.strictEqual(connRows.length, 1, 'Registro da conexão deve ser preservado para auditoria');
      const conn = connRows[0];

      assert.strictEqual(conn.status, 'disconnected');
      assert.strictEqual(conn.access_token_cipher, null, 'Ciphertext do access token deve ser NULL');
      assert.strictEqual(conn.access_token_iv, null, 'IV do access token deve ser NULL');
      assert.strictEqual(conn.access_token_tag, null, 'Tag do access token deve ser NULL');
      assert.strictEqual(conn.refresh_token_cipher, null, 'Ciphertext do refresh token deve ser NULL');
      assert.strictEqual(conn.refresh_token_iv, null, 'IV do refresh token deve ser NULL');
      assert.strictEqual(conn.refresh_token_tag, null, 'Tag do refresh token deve ser NULL');
      assert.strictEqual(conn.expires_at, null, 'Data de expiração deve ser NULL');
      assert.strictEqual(conn.refresh_lease_owner, null, 'Lease owner deve ser NULL');
      assert.strictEqual(conn.refresh_lease_expires_at, null, 'Lease expires_at deve ser NULL');
      assert.strictEqual(conn.account_identifier, 'Empresa Teste LTDA', 'Metadados não sensíveis permanecem');

      // Consulta direta nas sessões e refresh tokens
      const { rows: sessRows } = await testPool.query(
        'SELECT revoked_at FROM gateway_sessions WHERE connection_id = $1',
        [connId]
      );
      assert.strictEqual(sessRows.length, 1);
      assert.ok(sessRows[0].revoked_at, 'Sessão deve ter revoked_at preenchido');

      const { rows: grtRows } = await testPool.query(
        'SELECT revoked_at FROM gateway_refresh_tokens WHERE session_id = $1',
        [sessionId]
      );
      assert.strictEqual(grtRows.length, 1);
      assert.ok(grtRows[0].revoked_at, 'Refresh token deve ter revoked_at preenchido');
    });

    // -------------------------------------------------------------------------
    // 6. Persistência Durável Pós-Reinicialização do Pool
    // -------------------------------------------------------------------------
    await runTest('21. Persistência pós-restart: recriar pool e repositório não causa perda de dados', async () => {
      const connId = `conn_persist_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_to_survive_restart',
        encryptedRefreshToken: 'refresh_to_survive_restart',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Simula encerramento e nova instância conectando ao mesmo PostgreSQL
      const freshPool = new Pool({ connectionString: databaseUrl });
      const freshRepo = new PostgresGatewayRepository(freshPool);

      const recovered = await freshRepo.getConnection(connId);
      assert.ok(recovered, 'Conexão deve ser recuperada íntegra pelo novo pool');
      assert.strictEqual(recovered?.encryptedAccessToken, 'token_to_survive_restart');

      await freshPool.end();
    });

    // -------------------------------------------------------------------------
    // 7. Coordenação Distribuída do Refresh Bling (Lease/Claim)
    // -------------------------------------------------------------------------
    await runTest('22. Lease concorrente no refresh Bling: 5 requisições simultâneas, apenas 1 adquire', async () => {
      const connId = `conn_lease_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 5 workers disputam o lease simultaneamente
      const workers = ['worker_1', 'worker_2', 'worker_3', 'worker_4', 'worker_5'];
      const results = await Promise.all(
        workers.map((workerId) => repo.acquireRefreshLease(connId, workerId, 15000))
      );

      const winners = results.filter((r) => r.acquired);
      const losers = results.filter((r) => !r.acquired);

      assert.strictEqual(winners.length, 1, 'Exatamente 1 worker deve adquirir o lease');
      assert.strictEqual(losers.length, 4, 'Os outros 4 workers não devem adquirir o lease');

      const winningOwner = winners[0].currentOwner;
      assert.ok(winningOwner, 'Winner deve possuir ownerId definido');

      for (const loser of losers) {
        assert.strictEqual(loser.currentOwner, winningOwner);
        assert.strictEqual(loser.tokenVersion, 1);
      }
    });

    await runTest('23. Lease expirado: após tempo de concessão expirar, novo worker adquire o lease', async () => {
      const connId = `conn_lease_exp_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Concessão efêmera de apenas 60ms
      const first = await repo.acquireRefreshLease(connId, 'worker_old', 60);
      assert.strictEqual(first.acquired, true);

      // Aguarda 90ms para o lease expirar naturalmente
      await new Promise((resolve) => setTimeout(resolve, 90));

      // Worker novo tenta adquirir após expiração
      const second = await repo.acquireRefreshLease(connId, 'worker_new', 15000);
      assert.strictEqual(second.acquired, true, 'Novo worker deve conseguir adquirir após expiração');
      assert.strictEqual(second.currentOwner, 'worker_new');
    });

    await runTest('24. Token version e liberação de lease: incrementa versão ao concluir refresh', async () => {
      const connId = `conn_token_ver_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const acquire = await repo.acquireRefreshLease(connId, 'worker_refresher', 15000);
      assert.strictEqual(acquire.acquired, true);
      assert.strictEqual(acquire.tokenVersion, 1);

      // Worker conclui a troca de tokens sintética e libera o lease incrementando a versão
      const released = await repo.releaseRefreshLease(connId, 'worker_refresher', {
        incrementVersion: true
      });
      assert.strictEqual(released, true);

      // Verifica que a versão aumentou para 2 e o lease foi liberado
      const state = await repo.getRefreshLeaseState(connId);
      assert.strictEqual(state.isLeased, false);
      assert.strictEqual(state.leaseOwner, null);
      assert.strictEqual(state.tokenVersion, 2);

      const versionDirect = await repo.getConnectionTokenVersion(connId);
      assert.strictEqual(versionDirect, 2);
    });

    await runTest('25. Isolamento e proteção de lease: terceiro não consegue estender nem liberar lease alheio', async () => {
      const connId = `conn_lease_prot_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Worker legítimo adquire lease
      const acq = await repo.acquireRefreshLease(connId, 'worker_legit', 15000);
      assert.strictEqual(acq.acquired, true);

      // Terceiro tenta liberar o lease do worker legítimo
      const badRelease = await repo.releaseRefreshLease(connId, 'worker_attacker', {
        incrementVersion: true
      });
      assert.strictEqual(badRelease, false, 'Terceiro não pode liberar lease alheio');

      // Verifica que o lease continua intacto com o worker legítimo e token_version não foi incrementado
      const state = await repo.getRefreshLeaseState(connId);
      assert.strictEqual(state.isLeased, true);
      assert.strictEqual(state.leaseOwner, 'worker_legit');
      assert.strictEqual(state.tokenVersion, 1);

      // Terceiro tenta adquirir antes de expirar
      const badAcquire = await repo.acquireRefreshLease(connId, 'worker_attacker', 15000);
      assert.strictEqual(badAcquire.acquired, false, 'Terceiro não pode adquirir lease ativo');
      assert.strictEqual(badAcquire.currentOwner, 'worker_legit');
    });

    await runTest('26. Renovação de lease pelo mesmo proprietário: mesmo worker estende lease ativo com sucesso', async () => {
      const connId = `conn_lease_renew_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'cipher_acc',
        encryptedRefreshToken: 'cipher_ref',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Worker adquire lease inicial de 5s
      const first = await repo.acquireRefreshLease(connId, 'worker_same', 5000);
      assert.strictEqual(first.acquired, true);

      // Mesmo worker renova lease por 30s
      const renewed = await repo.acquireRefreshLease(connId, 'worker_same', 30000);
      assert.strictEqual(renewed.acquired, true, 'Mesmo worker deve conseguir estender seu lease ativo');
      assert.strictEqual(renewed.currentOwner, 'worker_same');

      // Worker libera lease com sucesso
      const released = await repo.releaseRefreshLease(connId, 'worker_same', { incrementVersion: true });
      assert.strictEqual(released, true);

      const finalState = await repo.getRefreshLeaseState(connId);
      assert.strictEqual(finalState.isLeased, false);
      assert.strictEqual(finalState.tokenVersion, 2);
    });

    await runTest('27. saveConnection não sobrescreve coordenação de refresh: preserva lease owner, expiry e token_version', async () => {
      const connId = `conn_preserve_${randomUUID()}`;
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_v1',
        encryptedRefreshToken: 'refresh_v1',
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Adquire lease e incrementa versão para 5
      await repo.acquireRefreshLease(connId, 'worker_active', 60000);
      await repo.releaseRefreshLease(connId, 'worker_active', { incrementVersion: true });
      await repo.acquireRefreshLease(connId, 'worker_active', 60000);
      await repo.releaseRefreshLease(connId, 'worker_active', { incrementVersion: true });
      await repo.acquireRefreshLease(connId, 'worker_active', 60000);
      await repo.releaseRefreshLease(connId, 'worker_active', { incrementVersion: true });
      await repo.acquireRefreshLease(connId, 'worker_active', 60000);
      await repo.releaseRefreshLease(connId, 'worker_active', { incrementVersion: true });

      // Worker adquire lease de 60s
      await repo.acquireRefreshLease(connId, 'worker_holder', 60000);

      const stateBefore = await repo.getRefreshLeaseState(connId);
      assert.strictEqual(stateBefore.isLeased, true);
      assert.strictEqual(stateBefore.leaseOwner, 'worker_holder');
      assert.strictEqual(stateBefore.tokenVersion, 5);

      // Executa saveConnection com payload genérico (ex: stale ou sem campos de lease)
      await repo.saveConnection({
        id: connId,
        status: 'connected',
        encryptedAccessToken: 'token_v2',
        encryptedRefreshToken: 'refresh_v2',
        tokenExpiresAt: new Date(Date.now() + 7200000).toISOString(),
        tokenVersion: 1,
        refreshLeaseOwner: null,
        refreshLeaseExpiresAt: null
      });

      // Confirma que lease ativo e token_version foram PRESERVADOS no banco
      const stateAfter = await repo.getRefreshLeaseState(connId);
      assert.strictEqual(stateAfter.isLeased, true, 'Lease ativo deve ser preservado');
      assert.strictEqual(stateAfter.leaseOwner, 'worker_holder', 'Owner deve ser preservado');
      assert.strictEqual(stateAfter.tokenVersion, 5, 'token_version não pode regredir via saveConnection genérico');

      const reloaded = await repo.getConnection(connId);
      assert.strictEqual(reloaded?.encryptedAccessToken, 'token_v2', 'Dados de token devem ser atualizados');
    });

    console.log('\n🎉 TODAS AS VALIDAÇÕES POSTGRESQL DA FASE 4C.2A PASSARAM COM ÊXITO!');
  } finally {
    await testPool.end();
  }
}

// Execução direta se invocado via CLI
if (process.argv[1]?.endsWith('gateway-postgres.test.ts') || process.argv[1]?.endsWith('gateway-postgres.test.mjs')) {
  runGatewayPostgresTests().catch((err) => {
    console.error('Falha fatal na suíte PostgreSQL:', err);
    process.exit(1);
  });
}
