import { checkEnvironment } from './assert-env';

let failures = 0;
function expect(label: string, cond: boolean, detail?: string) {
  const ok = cond ? 'OK  ' : 'FAIL';
  if (!cond) failures++;
  console.log(`[${ok}] ${label}${detail ? ' -- ' + detail : ''}`);
}

// --- Cenario 1: env totalmente vazia (dev) ---
const r1 = checkEnvironment({});
expect('env vazia acusa JWT_SECRET', r1.errors.some(e => e.includes('JWT_SECRET')));
expect('env vazia acusa ENCRYPTION_SECRET', r1.errors.some(e => e.includes('ENCRYPTION_SECRET')));
expect('env vazia acusa DATABASE_URL', r1.errors.some(e => e.includes('DATABASE_URL')));

// --- Cenario 2: valores placeholder ---
const r2 = checkEnvironment({
  JWT_SECRET: 'sua_chave_jwt_secreta_aqui',
  ENCRYPTION_SECRET: 'default-dev-secret-change-this!!',
  DATABASE_URL: 'postgresql://x:y@z/db',
});
// Placeholder JWT (25 chars) cai primeiro na validacao de tamanho.
expect('placeholder JWT rejeitado (por tamanho ou literal)', r2.errors.some(e => e.includes('JWT_SECRET')));
expect('placeholder ENCRYPTION rejeitado', r2.errors.some(e => e.includes('ENCRYPTION_SECRET esta com o valor default')));

// Placeholder JWT com 32+ chars deve ser pego pelo literal check.
const r2b = checkEnvironment({
  JWT_SECRET: 'sua_chave_jwt_secreta_aqui' + 'x'.repeat(10),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
});
// Esse JWT nao e igual ao placeholder, so para garantir que a validacao literal
// nao esta bloqueando secrets reais por acidente:
expect('JWT real com 32+ chars passa', r2b.errors.length === 0, `erros: ${r2b.errors.join(' | ')}`);

// --- Cenario 3: JWT curto, ENC errado ---
const r3 = checkEnvironment({
  JWT_SECRET: 'curto',
  ENCRYPTION_SECRET: 'nao-tem-32',
  DATABASE_URL: 'postgresql://x',
});
expect('JWT curto rejeitado', r3.errors.some(e => e.includes('pelo menos 32')));
expect('ENC tamanho errado rejeitado', r3.errors.some(e => e.includes('exatamente 32')));

// --- Cenario 4: dev minimamente valido ---
const r4 = checkEnvironment({
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
});
expect('dev minimamente valido passa', r4.errors.length === 0, `erros: ${r4.errors.join(' | ')}`);

// --- Cenario 5: prod sem extras (falha) ---
const r5 = checkEnvironment({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
});
expect('prod sem FRONTEND_URL erra', r5.errors.some(e => e.includes('FRONTEND_URL')));
expect('prod sem WORKSPACES_ROOT erra', r5.errors.some(e => e.includes('WORKSPACES_ROOT')));

// --- Cenario 6: prod com Bun em 0.0.0.0 (falha) ---
const r6 = checkEnvironment({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
  FRONTEND_URL: 'https://app.example.com',
  WORKSPACES_ROOT: '/var/openclaude/workspaces',
  OPENCLAUDE_HTTP_HOST: '0.0.0.0',
  DISABLE_PUBLIC_REGISTER: 'true',
});
expect('prod recusa Bun em 0.0.0.0', r6.errors.some(e => e.includes('OPENCLAUDE_HTTP_HOST')));

// --- Cenario 7: prod com WORKSPACES_ROOT relativo (falha) ---
const r7 = checkEnvironment({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
  FRONTEND_URL: 'https://app.example.com',
  WORKSPACES_ROOT: './workspaces',
  OPENCLAUDE_HTTP_HOST: '127.0.0.1',
  DISABLE_PUBLIC_REGISTER: 'true',
});
expect('prod exige WORKSPACES_ROOT absoluto', r7.errors.some(e => e.includes('caminho absoluto')));

// --- Cenario 8: prod totalmente correto ---
const r8 = checkEnvironment({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
  FRONTEND_URL: 'https://app.example.com',
  WORKSPACES_ROOT: '/var/openclaude/workspaces',
  OPENCLAUDE_HTTP_HOST: '127.0.0.1',
  DISABLE_PUBLIC_REGISTER: 'true',
});
expect('prod totalmente correto passa sem erros', r8.errors.length === 0, `erros: ${r8.errors.join(' | ')}`);
expect('prod totalmente correto sem warnings', r8.warnings.length === 0, `warnings: ${r8.warnings.join(' | ')}`);

// --- Cenario 9: prod com http:// emite warning mas nao erro ---
const r9 = checkEnvironment({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
  FRONTEND_URL: 'http://app.example.com',
  WORKSPACES_ROOT: '/var/openclaude/workspaces',
  OPENCLAUDE_HTTP_HOST: '127.0.0.1',
  DISABLE_PUBLIC_REGISTER: 'true',
});
expect('prod com http:// nao bloqueia', r9.errors.length === 0);
expect('prod com http:// emite warning', r9.warnings.some(w => w.includes('sem TLS')));

// --- Cenario 10: prod sem DISABLE_PUBLIC_REGISTER emite warning ---
const r10 = checkEnvironment({
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  ENCRYPTION_SECRET: 'a'.repeat(32),
  DATABASE_URL: 'postgresql://x',
  FRONTEND_URL: 'https://app.example.com',
  WORKSPACES_ROOT: '/var/openclaude/workspaces',
  OPENCLAUDE_HTTP_HOST: '127.0.0.1',
});
expect('prod sem DISABLE_PUBLIC_REGISTER warning', r10.warnings.some(w => w.includes('DISABLE_PUBLIC_REGISTER')));

console.log('');
if (failures > 0) {
  console.error(`[SMOKE] ${failures} falhas.`);
  process.exit(1);
}
console.log('[SMOKE] Todos os cenarios de assert-env passaram.');
