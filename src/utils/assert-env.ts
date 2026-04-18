import { isAbsolute } from 'path';

const PLACEHOLDER_JWT = 'sua_chave_jwt_secreta_aqui';
const PLACEHOLDER_ENCRYPTION = 'default-dev-secret-change-this!!';

export interface EnvCheckResult {
  errors: string[];
  warnings: string[];
}

/**
 * Valida as variaveis de ambiente obrigatorias. Em qualquer ambiente exige
 * JWT_SECRET, ENCRYPTION_SECRET e DATABASE_URL validos. Em producao adiciona
 * checagens extras (HTTPS, WORKSPACES_ROOT absoluto, Bun em localhost,
 * registro publico desativado).
 *
 * Retorna a lista de erros e avisos sem matar o processo, para facilitar
 * testes unitarios. O caller (main.ts) decide se aborta.
 */
export function checkEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): EnvCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === 'production';

  const jwt = env.JWT_SECRET ?? '';
  if (!jwt) {
    errors.push('JWT_SECRET ausente.');
  } else if (jwt.length < 32) {
    errors.push(
      `JWT_SECRET deve ter pelo menos 32 caracteres (atual: ${jwt.length}).`,
    );
  } else if (jwt === PLACEHOLDER_JWT) {
    errors.push(
      'JWT_SECRET esta com o valor placeholder do .env.example. Gere um secret real.',
    );
  }

  const enc = env.ENCRYPTION_SECRET ?? '';
  if (!enc) {
    errors.push('ENCRYPTION_SECRET ausente.');
  } else if (enc.length !== 32) {
    errors.push(
      `ENCRYPTION_SECRET deve ter exatamente 32 caracteres (atual: ${enc.length}).`,
    );
  } else if (enc === PLACEHOLDER_ENCRYPTION) {
    errors.push(
      'ENCRYPTION_SECRET esta com o valor default inseguro. Gere um secret real de 32 chars.',
    );
  }

  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL ausente.');
  }

  if (isProd) {
    const frontendUrl = env.FRONTEND_URL ?? '';
    if (!frontendUrl) {
      errors.push('FRONTEND_URL ausente em producao.');
    } else if (frontendUrl.startsWith('http://')) {
      warnings.push(
        `FRONTEND_URL esta sem TLS (${frontendUrl}). Recomendado usar https:// em producao.`,
      );
    }

    const workspacesRoot = env.WORKSPACES_ROOT ?? '';
    if (!workspacesRoot) {
      errors.push(
        'WORKSPACES_ROOT obrigatorio em producao (aponte para volume persistente).',
      );
    } else if (!isAbsolute(workspacesRoot)) {
      errors.push(
        `WORKSPACES_ROOT deve ser um caminho absoluto em producao (atual: ${workspacesRoot}).`,
      );
    }

    const bunHost = env.OPENCLAUDE_HTTP_HOST ?? '127.0.0.1';
    if (bunHost !== '127.0.0.1' && bunHost !== 'localhost') {
      errors.push(
        `OPENCLAUDE_HTTP_HOST deve ser 127.0.0.1 em producao (atual: ${bunHost}). O Bun nao pode ser exposto na rede.`,
      );
    }

    const disableRegister = (env.DISABLE_PUBLIC_REGISTER ?? '').toLowerCase();
    if (disableRegister !== 'true') {
      warnings.push(
        'DISABLE_PUBLIC_REGISTER nao esta ligado. Qualquer um com acesso a URL pode se registrar. Recomendado "true" em producao.',
      );
    }
  }

  return { errors, warnings };
}

/**
 * Valida env e aborta o processo em caso de erros. Warnings sao apenas
 * impressos.
 */
export function assertEnvironmentReady(): void {
  const { errors, warnings } = checkEnvironment(process.env);

  for (const w of warnings) console.warn(`[STARTUP WARN] ${w}`);

  if (errors.length > 0) {
    console.error(
      '\n[STARTUP ERROR] Ambiente invalido. Corrija antes de iniciar:',
    );
    for (const e of errors) console.error(`  - ${e}`);
    console.error('');
    process.exit(1);
  }
}
