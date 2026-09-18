// Suíte de Testes da Fase 4C.1: Gateway Security Foundation
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { encryptAesGcm, decryptAesGcm } from '../src/gateway/crypto/aes-gcm.ts';
import {
  generateOAuthState,
  generatePairingSecret,
  generatePairingId,
  generateGatewayRefreshToken,
  hashSecret,
  constantTimeCompare,
  createGatewaySessionToken,
  verifyGatewaySessionToken
} from '../src/gateway/crypto/pairing-state.ts';
import { InMemoryGatewayRepository, MemoryGatewayRepository } from '../src/gateway/database/repository.ts';
import { sanitizeForLogs } from '../src/gateway/security/logger.ts';
import { MemoryRateLimiter } from '../src/gateway/security/rate-limiter.ts';
import { GatewayApp } from '../src/gateway/http/app.ts';
import { loadGatewayConfig } from '../src/gateway/config.ts';

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

export async function runGatewaySecurityTests() {
  console.log('\n================================================================');
  console.log('   SUÍTE DE TESTES: GATEWAY SECURITY FOUNDATION (FASE 4C.1)');
  console.log('================================================================\n');

  const testKey = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

  // ---------------------------------------------------------------------------
  // 1. Módulo AES-256-GCM
  // ---------------------------------------------------------------------------
  await runTest('1. AES-GCM: cifra e decifra mantendo integridade e keyVersion', () => {
    const secretData = 'super_secret_bling_refresh_token_xyz123';
    const encrypted = encryptAesGcm(secretData, testKey, 2);

    assert.ok(encrypted.ciphertext, 'Deve gerar ciphertext em base64');
    assert.ok(encrypted.iv, 'Deve gerar IV em base64');
    assert.ok(encrypted.authTag, 'Deve gerar Auth Tag em base64');
    assert.strictEqual(encrypted.keyVersion, 2, 'Deve registrar a keyVersion correta');

    const decrypted = decryptAesGcm(encrypted, testKey);
    assert.strictEqual(decrypted, secretData, 'Dado decifrado deve ser idêntico ao original');
  });

  await runTest('2. AES-GCM: falha se o ciphertext for adulterado em 1 bit', () => {
    const secretData = 'token_to_tamper';
    const encrypted = encryptAesGcm(secretData, testKey, 1);

    // Altera 1 caractere no ciphertext
    const rawCipherBuf = Buffer.from(encrypted.ciphertext, 'base64');
    rawCipherBuf[0] ^= 0x01; // flip 1 bit
    const tamperedPayload = {
      ...encrypted,
      ciphertext: rawCipherBuf.toString('base64')
    };

    assert.throws(
      () => decryptAesGcm(tamperedPayload, testKey),
      /Falha na autenticação criptográfica AES-GCM/
    );
  });

  await runTest('3. AES-GCM: falha se a Auth Tag for adulterada', () => {
    const secretData = 'token_with_invalid_tag';
    const encrypted = encryptAesGcm(secretData, testKey, 1);

    const rawTagBuf = Buffer.from(encrypted.authTag, 'base64');
    rawTagBuf[0] ^= 0xff; // adultera tag
    const tamperedPayload = {
      ...encrypted,
      authTag: rawTagBuf.toString('base64')
    };

    assert.throws(
      () => decryptAesGcm(tamperedPayload, testKey),
      /Falha na autenticação criptográfica AES-GCM/
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Entropia Criptográfica, Hashes e Timing-Safe Compare
  // ---------------------------------------------------------------------------
  await runTest('4. Entropia e Não-Repetição: states e pairing secrets possuem 256 bits e são únicos', () => {
    const states = new Set<string>();
    const secrets = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const state = generateOAuthState();
      const secret = generatePairingSecret();

      assert.strictEqual(state.length, 64, 'State deve ter 64 caracteres hex (32 bytes = 256 bits)');
      assert.strictEqual(secret.length, 64, 'Secret deve ter 64 caracteres hex (32 bytes = 256 bits)');

      assert.ok(!states.has(state), 'State não pode se repetir');
      assert.ok(!secrets.has(secret), 'Secret não pode se repetir');

      states.add(state);
      secrets.add(secret);
    }
  });

  await runTest('5. Timing-Safe Comparison: valida igualdade e rejeita diferenças com segurança', () => {
    const a = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const b = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const c = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a09';

    assert.strictEqual(constantTimeCompare(a, b), true);
    assert.strictEqual(constantTimeCompare(a, c), false);
    assert.strictEqual(constantTimeCompare(a, 'curto'), false);
  });

  // ---------------------------------------------------------------------------
  // 3. Guardrail 1: Pareamento Efêmero One-Time & Proteção contra DoS
  // ---------------------------------------------------------------------------
  await runTest('6. Guardrail 1: pairingSecret é salvo apenas como hash SHA-256 (nunca em plaintext)', async () => {
    const repo = new MemoryGatewayRepository();
    const pairingId = generatePairingId();
    const pairingSecret = generatePairingSecret();
    const hash = hashSecret(pairingSecret);

    await repo.savePairingRequest({
      pairingId,
      clientSessionId: 'test_session_123',
      pairingSecretHash: hash,
      stateHash: 'state_hash_abc',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // Inspeciona diretamente o repositório
    const rawPairing = await (repo as any).pairings.get(pairingId);
    assert.strictEqual(rawPairing.pairingSecretHash, hash);
    assert.strictEqual((rawPairing as any).pairingSecret, undefined, 'pairingSecret NÃO pode existir no banco');
  });

  await runTest('7. Guardrail 1: tentativa com segredo inválido NÃO destrói o pairing imediatamente (Anti-DoS)', async () => {
    const repo = new MemoryGatewayRepository();
    const pairingId = generatePairingId();
    const realSecret = generatePairingSecret();
    const wrongSecret = 'wrong_secret_1234567890abcdef1234567890abcdef1234567890abcdef12345678';

    await repo.savePairingRequest({
      pairingId,
      clientSessionId: 'session_dos_test',
      pairingSecretHash: hashSecret(realSecret),
      stateHash: 'state_123',
      connectionId: 'conn_test_999',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // 1ª tentativa com segredo errado
    const attempt1 = await repo.verifyAndConsumePairing(pairingId, wrongSecret);
    assert.strictEqual(attempt1.ok, false);
    assert.strictEqual(attempt1.error, 'INVALID_PAIRING_SECRET');
    assert.strictEqual(attempt1.remainingAttempts, 4);

    // Confirma que o pairing NÃO foi consumido nem destruído
    const checkPairing = await (repo as any).pairings.get(pairingId);
    assert.strictEqual(checkPairing.consumed, false, 'Pairing ainda deve estar disponível para o cliente legítimo');
    assert.strictEqual(checkPairing.failedAttempts, 1);

    // Agora o cliente legítimo apresenta o segredo CORRETO
    const attemptLegit = await repo.verifyAndConsumePairing(pairingId, realSecret);
    assert.strictEqual(attemptLegit.ok, true, 'Cliente legítimo deve conseguir consumir mesmo após falha avulsa');
    assert.strictEqual(attemptLegit.pairing?.consumed, true);
  });

  await runTest('8. Guardrail 1: esgotamento de tentativas consecutivas bloqueia o pairing', async () => {
    const repo = new MemoryGatewayRepository();
    const pairingId = generatePairingId();
    const realSecret = generatePairingSecret();
    const wrongSecret = 'attacker_guess';

    await repo.savePairingRequest({
      pairingId,
      clientSessionId: 'session_bruteforce_test',
      pairingSecretHash: hashSecret(realSecret),
      stateHash: 'state_123',
      connectionId: 'conn_test',
      failedAttempts: 0,
      maxAttempts: 3,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // 3 tentativas falhas
    await repo.verifyAndConsumePairing(pairingId, wrongSecret);
    await repo.verifyAndConsumePairing(pairingId, wrongSecret);
    const att3 = await repo.verifyAndConsumePairing(pairingId, wrongSecret);
    assert.strictEqual(att3.remainingAttempts, 0);

    // 4ª tentativa é bloqueada por max attempts
    const att4 = await repo.verifyAndConsumePairing(pairingId, realSecret);
    assert.strictEqual(att4.ok, false);
    assert.strictEqual(att4.error, 'PAIRING_MAX_ATTEMPTS_EXCEEDED');
  });

  await runTest('9. Pareamento Expirado e Reutilizado são Rejeitados', async () => {
    const repo = new MemoryGatewayRepository();
    const pairingId = generatePairingId();
    const secret = generatePairingSecret();

    // 1. Expirado
    await repo.savePairingRequest({
      pairingId,
      clientSessionId: 'session_expired',
      pairingSecretHash: hashSecret(secret),
      stateHash: 'state_123',
      connectionId: 'conn_1',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expirou há 1s
      createdAt: new Date(Date.now() - 60000).toISOString()
    });

    const expResult = await repo.verifyAndConsumePairing(pairingId, secret);
    assert.strictEqual(expResult.ok, false);
    assert.strictEqual(expResult.error, 'PAIRING_EXPIRED');

    // 2. Reutilizado após sucesso
    const pairingId2 = generatePairingId();
    const secret2 = generatePairingSecret();

    await repo.savePairingRequest({
      pairingId: pairingId2,
      clientSessionId: 'session_single_use',
      pairingSecretHash: hashSecret(secret2),
      stateHash: 'state_456',
      connectionId: 'conn_2',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    const firstUse = await repo.verifyAndConsumePairing(pairingId2, secret2);
    assert.strictEqual(firstUse.ok, true);

    const secondUse = await repo.verifyAndConsumePairing(pairingId2, secret2);
    assert.strictEqual(secondUse.ok, false);
    assert.strictEqual(secondUse.error, 'PAIRING_ALREADY_CONSUMED');
  });

  // ---------------------------------------------------------------------------
  // 4. Guardrail 2: Rotação de Gateway Refresh Token e Detecção de Reuse
  // ---------------------------------------------------------------------------
  await runTest('10. Guardrail 2: renovação normal rotaciona o token e invalida o anterior', async () => {
    const repo = new MemoryGatewayRepository();
    const token1 = generateGatewayRefreshToken();
    const token2 = generateGatewayRefreshToken();
    const familyId = 'family_alpha';

    await repo.createGatewaySession({
      id: 'sess_1',
      connectionId: 'conn_100',
      tokenFamilyId: familyId,
      refreshTokenHash: hashSecret(token1),
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // Rotaciona de token1 para token2
    const rotateResult = await repo.rotateGatewaySession(token1, token2);
    assert.strictEqual(rotateResult.ok, true);
    assert.ok(rotateResult.newSession);
    assert.strictEqual(rotateResult.newSession?.tokenFamilyId, familyId);
    assert.strictEqual(rotateResult.newSession?.refreshTokenHash, hashSecret(token2));

    // Sessão antiga deve estar marcada com usedAt
    const oldSession = await repo.getSessionByRefreshHash(hashSecret(token1));
    assert.ok(oldSession?.usedAt);
    assert.strictEqual(oldSession?.replacedByHash, hashSecret(token2));
  });

  await runTest('11. Guardrail 2: Reuse Detection revoga imediatamente toda a família de sessões', async () => {
    const repo = new MemoryGatewayRepository();
    const token1 = generateGatewayRefreshToken();
    const token2 = generateGatewayRefreshToken();
    const token3 = generateGatewayRefreshToken();
    const familyId = 'family_compromised';

    await repo.createGatewaySession({
      id: 'sess_orig',
      connectionId: 'conn_200',
      tokenFamilyId: familyId,
      refreshTokenHash: hashSecret(token1),
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // Primeira rotação legítima: token1 -> token2
    const r1 = await repo.rotateGatewaySession(token1, token2);
    assert.strictEqual(r1.ok, true);

    // ATACANTE tenta reutilizar token1 (que já foi substituído!)
    const maliciousReuse = await repo.rotateGatewaySession(token1, token3);
    assert.strictEqual(maliciousReuse.ok, false);
    assert.strictEqual(maliciousReuse.error, 'TOKEN_REUSE_DETECTED');
    assert.strictEqual(maliciousReuse.familyRevoked, true);

    // Confirma que a sessão legítima token2 agora TAMBÉM foi revogada
    const legitSession = await repo.getSessionByRefreshHash(hashSecret(token2));
    assert.ok(legitSession?.revokedAt, 'Toda a família de tokens deve estar revogada');
  });

  // ---------------------------------------------------------------------------
  // 5. Sanitização de Logs e Rate Limiting
  // ---------------------------------------------------------------------------
  await runTest('12. Sanitização de Logs: credenciais, tokens e segredos são ofuscados', () => {
    const sensitivePayload = {
      client_secret: 'bling_secret_12345',
      access_token: 'bling_jwt_access_token_9999',
      refresh_token: 'bling_refresh_token_8888',
      pairingSecret: 'pairing_secret_secret_7777',
      normalField: 'dado_publico_do_produto',
      headers: {
        authorization: 'Bearer secret_jwt_token_abc.def.ghi'
      }
    };

    const sanitized: any = sanitizeForLogs(sensitivePayload);

    assert.strictEqual(sanitized.client_secret, '[REDACTED]');
    assert.strictEqual(sanitized.access_token, '[REDACTED]');
    assert.strictEqual(sanitized.refresh_token, '[REDACTED]');
    assert.strictEqual(sanitized.pairingSecret, '[REDACTED]');
    assert.strictEqual(sanitized.normalField, 'dado_publico_do_produto');
    assert.strictEqual(sanitized.headers.authorization, '[REDACTED]');
  });

  await runTest('13. Rate Limiter: bloqueia excesso de requisições na janela deslizante', () => {
    const limiter = new MemoryRateLimiter(3, 60); // 3 req por minuto

    const r1 = limiter.check('192.168.1.1');
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r1.remaining, 2);

    const r2 = limiter.check('192.168.1.1');
    assert.strictEqual(r2.allowed, true);

    const r3 = limiter.check('192.168.1.1');
    assert.strictEqual(r3.allowed, true);
    assert.strictEqual(r3.remaining, 0);

    const r4 = limiter.check('192.168.1.1');
    assert.strictEqual(r4.allowed, false, '4ª requisição deve ser bloqueada');
    assert.ok(r4.resetInMs > 0);

    // Outro IP não é afetado
    const otherIp = limiter.check('10.0.0.1');
    assert.strictEqual(otherIp.allowed, true);
  });

  // ---------------------------------------------------------------------------
  // 6. Sessão GST (JWT Curto)
  // ---------------------------------------------------------------------------
  await runTest('14. Gateway Session Token (GST): emite e valida token de 2h, rejeitando assinatura adulterada', () => {
    const jwtSecret = 'test_secret_for_jwt_signing_min_32_characters_long';
    const claims = { connectionId: 'conn_123', clientSessionId: 'csid_456' };

    const token = createGatewaySessionToken(claims, jwtSecret, 7200);
    const verified = verifyGatewaySessionToken(token, jwtSecret);

    assert.strictEqual(verified.valid, true);
    assert.strictEqual(verified.claims?.connectionId, 'conn_123');
    assert.strictEqual(verified.claims?.clientSessionId, 'csid_456');

    // Chave errada
    const wrongKeyCheck = verifyGatewaySessionToken(token, 'different_secret_key_long_enough_123456');
    assert.strictEqual(wrongKeyCheck.valid, false);
    assert.strictEqual(wrongKeyCheck.error, 'Assinatura do token inválida.');
  });

  // ---------------------------------------------------------------------------
  // 7. Guardrail 4: Limpeza Automática
  // ---------------------------------------------------------------------------
  await runTest('15. Guardrail 4: rotina de limpeza expurga pairings e sessões expiradas', async () => {
    const repo = new InMemoryGatewayRepository();

    // Pairing expirado
    await repo.savePairingRequest({
      pairingId: 'p_expired',
      clientSessionId: 'csid_1',
      pairingSecretHash: 'hash',
      stateHash: 'state',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() - 5000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // Pairing ativo
    await repo.savePairingRequest({
      pairingId: 'p_active',
      clientSessionId: 'csid_2',
      pairingSecretHash: 'hash',
      stateHash: 'state2',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    const cleanup = await repo.cleanupExpired();
    assert.strictEqual(cleanup.pairingsRemoved, 1);

    const checkExpired = await (repo as any).pairings.get('p_expired');
    const checkActive = await (repo as any).pairings.get('p_active');
    assert.strictEqual(checkExpired, undefined);
    assert.ok(checkActive);
  });

  // ---------------------------------------------------------------------------
  // 8. Concorrência e Race Conditions (Guardrails de Produção)
  // ---------------------------------------------------------------------------
  await runTest('16. Concorrência: dois callbacks concorrentes com o mesmo state — exatamente um vence', async () => {
    const repo = new InMemoryGatewayRepository();
    const state = generateOAuthState();
    const stateHash = hashSecret(state);
    const pairingId = generatePairingId();

    await repo.savePairingRequest({
      pairingId,
      clientSessionId: 'session_race_state',
      pairingSecretHash: hashSecret(generatePairingSecret()),
      stateHash,
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // Simula duas requisições simultâneas de callback com o mesmo state
    const [res1, res2] = await Promise.all([
      repo.verifyAndAttachConnectionToPairing(stateHash, 'conn_alpha'),
      repo.verifyAndAttachConnectionToPairing(stateHash, 'conn_beta')
    ]);

    const successes = [res1, res2].filter((r) => r.ok);
    const failures = [res1, res2].filter((r) => !r.ok);

    assert.strictEqual(successes.length, 1, 'Exatamente uma chamada concorrente deve ser bem-sucedida');
    assert.strictEqual(failures.length, 1, 'A segunda chamada concorrente deve falhar');
    assert.strictEqual(failures[0].error, 'STATE_NOT_FOUND', 'O state já foi consumido e não existe mais');

    // Confirma que a conexão vencedora ficou vinculada e o stateHash foi invalidado
    const checkPairing = await (repo as any).pairings.get(pairingId);
    assert.ok(checkPairing.connectionId === 'conn_alpha' || checkPairing.connectionId === 'conn_beta');
    assert.strictEqual(checkPairing.stateHash, '', 'stateHash deve estar vazio para impedir replay');
  });

  await runTest('17. Concorrência: dois handshakes concorrentes com o mesmo pairingSecret — apenas um emite sessão', async () => {
    const repo = new InMemoryGatewayRepository();
    const pairingId = generatePairingId();
    const secret = generatePairingSecret();

    await repo.savePairingRequest({
      pairingId,
      clientSessionId: 'session_race_handshake',
      pairingSecretHash: hashSecret(secret),
      stateHash: '', // Já consumido no callback
      connectionId: 'conn_ready_for_session',
      failedAttempts: 0,
      maxAttempts: 5,
      consumed: false,
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      createdAt: new Date().toISOString()
    });

    // Simula dois handshakes simultâneos
    const [h1, h2] = await Promise.all([
      repo.verifyAndConsumePairing(pairingId, secret),
      repo.verifyAndConsumePairing(pairingId, secret)
    ]);

    const successes = [h1, h2].filter((h) => h.ok);
    const failures = [h1, h2].filter((h) => !h.ok);

    assert.strictEqual(successes.length, 1, 'Apenas um handshake concorrente pode emitir sessão');
    assert.strictEqual(failures.length, 1, 'O segundo handshake deve ser rejeitado');
    assert.strictEqual(failures[0].error, 'PAIRING_ALREADY_CONSUMED');
  });

  // ---------------------------------------------------------------------------
  // 9. Casos Extremos de Criptografia e JWT
  // ---------------------------------------------------------------------------
  await runTest('18. AES-GCM: tentativa de decifrar com IV adulterado falha na autenticação', () => {
    const secretData = 'confidential_bling_payload';
    const encrypted = encryptAesGcm(secretData, testKey, 1);

    const rawIv = Buffer.from(encrypted.iv, 'base64');
    rawIv[0] ^= 0x01; // corrompe 1 bit do IV
    const tamperedIvPayload = {
      ...encrypted,
      iv: rawIv.toString('base64')
    };

    assert.throws(
      () => decryptAesGcm(tamperedIvPayload, testKey),
      /Falha na autenticação criptográfica AES-GCM/
    );
  });

  await runTest('19. GST (JWT): token com timestamp expirado é estritamente rejeitado', () => {
    const jwtSecret = 'test_secret_for_jwt_signing_min_32_characters_long';
    const claims = { connectionId: 'conn_exp_1', clientSessionId: 'csid_exp_2' };

    // Emite token expirado (30 segundos no passado)
    const expiredToken = createGatewaySessionToken(claims, jwtSecret, -30);
    const result = verifyGatewaySessionToken(expiredToken, jwtSecret);

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Token de sessão expirado.');
  });

  await runTest('20. GST (JWT): algoritmo inesperado ou adulterado (alg: none / RS256) é rejeitado', () => {
    const jwtSecret = 'test_secret_for_jwt_signing_min_32_characters_long';
    
    // 1. Header com alg: "none"
    const b64HeaderNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const b64Payload = Buffer.from(JSON.stringify({ sub: 'c1', csid: 's1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const tokenNone = `${b64HeaderNone}.${b64Payload}.`;

    const resNone = verifyGatewaySessionToken(tokenNone, jwtSecret);
    assert.strictEqual(resNone.valid, false);
    assert.strictEqual(resNone.error, 'Algoritmo ou tipo de token não suportado.');

    // 2. Header com alg: "RS256"
    const b64HeaderRs = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const tokenRs = `${b64HeaderRs}.${b64Payload}.fake_sig`;

    const resRs = verifyGatewaySessionToken(tokenRs, jwtSecret);
    assert.strictEqual(resRs.valid, false);
    assert.strictEqual(resRs.error, 'Algoritmo ou tipo de token não suportado.');
  });

  await runTest('21. GST (JWT): validação de issuer e estrutura mínima de claims', () => {
    const jwtSecret = 'test_secret_for_jwt_signing_min_32_characters_long';
    const claims = { connectionId: 'conn_val_1', clientSessionId: 'csid_val_2' };

    // 1. Token válido
    const validToken = createGatewaySessionToken(claims, jwtSecret, 3600);
    const resValid = verifyGatewaySessionToken(validToken, jwtSecret);
    assert.strictEqual(resValid.valid, true);

    // 2. Token com issuer incorreto
    const b64Header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const b64PayloadBadIss = Buffer.from(JSON.stringify({
      sub: 'conn_1',
      csid: 'csid_1',
      iat: now,
      exp: now + 3600,
      iss: 'malicious-issuer-gateway'
    })).toString('base64url');

    const sigBadIss = createHmac('sha256', jwtSecret)
      .update(`${b64Header}.${b64PayloadBadIss}`)
      .digest('base64url');
    const tokenBadIss = `${b64Header}.${b64PayloadBadIss}.${sigBadIss}`;

    const resBadIss = verifyGatewaySessionToken(tokenBadIss, jwtSecret);
    assert.strictEqual(resBadIss.valid, false);
    assert.strictEqual(resBadIss.error, 'Issuer do token inválido.');

    // 3. Token com claim sub (connectionId) ausente
    const b64PayloadNoSub = Buffer.from(JSON.stringify({
      csid: 'csid_1',
      iat: now,
      exp: now + 3600,
      iss: 'paulifest-integration-gateway'
    })).toString('base64url');

    const sigNoSub = createHmac('sha256', jwtSecret)
      .update(`${b64Header}.${b64PayloadNoSub}`)
      .digest('base64url');
    const tokenNoSub = `${b64Header}.${b64PayloadNoSub}.${sigNoSub}`;

    const resNoSub = verifyGatewaySessionToken(tokenNoSub, jwtSecret);
    assert.strictEqual(resNoSub.valid, false);
    assert.strictEqual(resNoSub.error, 'Claim sub (connectionId) ausente ou inválida.');
  });

  await runTest('22. Configuração de Desenvolvimento: exige configuração explícita e rejeita inicialização sem secrets', () => {
    // Em ambiente development, não pode haver inicialização silenciosa com secrets fake conhecidos
    assert.throws(
      () => loadGatewayConfig({ NODE_ENV: 'development' }),
      /Configuração de desenvolvimento incompleta/
    );

    // Em ambiente de teste (NODE_ENV === 'test'), inicializa com defaults determinísticos de teste
    const testConfig = loadGatewayConfig({ NODE_ENV: 'test' });
    assert.strictEqual(testConfig.environment, 'test');
    assert.ok(testConfig.encryptionKey.length === 32);
    assert.ok(testConfig.jwtSecret.length >= 32);
  });

  // ---------------------------------------------------------------------------
  // 10. Gate Estático de Isolamento do Código-Fonte (100% Independente de build)
  // ---------------------------------------------------------------------------
  await runTest('23. Gate Estático: nenhum módulo da extensão importa src/gateway/**', () => {
    const forbiddenPatterns = [
      /from\s+['"][^'"]*\/gateway\//,
      /from\s+['"][^'"]*\/gateway['"]/,
      /import\s+['"][^'"]*\/gateway\//,
      /import\(['"][^'"]*\/gateway\//
    ];

    const dirsToCheck = [
      resolve(process.cwd(), 'src/background'),
      resolve(process.cwd(), 'src/content-scripts'),
      resolve(process.cwd(), 'src/sidepanel'),
      resolve(process.cwd(), 'src/shared'),
      resolve(process.cwd(), 'src/domain')
    ];

    function checkDir(dir: string) {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          checkDir(fullPath);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
          const content = readFileSync(fullPath, 'utf8');
          for (const pattern of forbiddenPatterns) {
            assert.ok(
              !pattern.test(content),
              `Violação de Isolamento detectada no arquivo da extensão: ${entry} importa gateway!`
            );
          }
        }
      }
    }

    for (const d of dirsToCheck) {
      checkDir(d);
    }
  });
}
