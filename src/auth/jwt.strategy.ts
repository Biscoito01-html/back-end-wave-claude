import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';

/**
 * Cookies aceitos para compatibilidade entre fluxos:
 * - `accessToken`: padrão atual do gateway;
 * - `auth_token`: chave legacy usada pelo front no localStorage;
 * - aliases adicionais para cenários de proxy/rewrite em produção.
 */
const JWT_COOKIE_CANDIDATES = [
  'accessToken',
  'auth_token',
  'token',
  'jwt',
] as const;

function parseCookieHeader(rawCookieHeader?: string): Record<string, string> {
  if (!rawCookieHeader || rawCookieHeader.trim().length === 0) {
    return {};
  }

  const parsed: Record<string, string> = {};
  for (const part of rawCookieHeader.split(';')) {
    const [name, ...valueParts] = part.split('=');
    if (!name) continue;
    const cookieName = name.trim();
    if (!cookieName) continue;
    const rawValue = valueParts.join('=').trim();
    if (!rawValue) continue;
    try {
      parsed[cookieName] = decodeURIComponent(rawValue);
    } catch {
      parsed[cookieName] = rawValue;
    }
  }
  return parsed;
}

function jwtFromAccessCookie(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined;
  const signedCookies = req?.signedCookies as Record<string, string> | undefined;
  const headerCookies = parseCookieHeader(req?.headers?.cookie);

  let raw: string | undefined;
  for (const cookieName of JWT_COOKIE_CANDIDATES) {
    const plainCookie = cookies?.[cookieName];
    if (typeof plainCookie === 'string' && plainCookie.trim().length > 0) {
      raw = plainCookie;
      break;
    }

    const signedCookie = signedCookies?.[cookieName];
    if (typeof signedCookie === 'string' && signedCookie.trim().length > 0) {
      raw = signedCookie;
      break;
    }

    const headerCookie = headerCookies[cookieName];
    if (typeof headerCookie === 'string' && headerCookie.trim().length > 0) {
      raw = headerCookie;
      break;
    }
  }

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;
}

/**
 * Payload emitido pelo gateway `api-control-panel-core`. O `sub` e o uuid
 * primario do usuario la. `roles` e opcional — quando presente e incluir
 * 'admin', aqui viramos o role para 'admin'.
 */
interface GatewayJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  roles?: string[];
  type?: string;
}

/**
 * Estrategia JWT compartilhada com o gateway. O OpenClaude agora e um
 * microservico: nao emite mais JWT proprio (excepto quando ENABLE_LOCAL_AUTH),
 * apenas valida a assinatura/expiracao do JWT e resolve o `sub` (id do usuario
 * no gateway) para o usuario local (JIT quando necessario).
 *
 * O token pode vir em:
 * - `Authorization: Bearer <jwt>` (ex.: front com token no localStorage), ou
 * - cookie HttpOnly (`accessToken`, `auth_token`, `token`, `jwt`)
 *   (ex.: login Google / refresh no gateway),
 *   desde que `cookie-parser` esteja ativo em `main.ts`.
 *
 * Ordem de resolucao do usuario:
 *  1. Por `externalId = payload.sub` — caminho feliz apos o primeiro login.
 *  2. Por `email` — caso o banco tenha usuario "legado" sem externalId ainda.
 *     Atualizamos o externalId para fechar o link.
 *  3. Cria novo usuario local com externalId + email (sem senha).
 *
 * Isso evita conflito no unique de `email` quando um user pre-existente
 * no banco do OpenClaude faz seu primeiro login vindo do gateway.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        jwtFromAccessCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: GatewayJwtPayload): Promise<AuthUser> {
    // Se vier `type` e for diferente de 'access', rejeita. Gateway pode
    // emitir refresh tokens assinados com outro secret, mas por seguranca
    // bloqueamos tipos nao-access caso ele use o mesmo secret no futuro.
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Token invalido');
    }
    if (!payload?.sub) {
      throw new UnauthorizedException('Payload sem sub');
    }

    const email = (payload.email ?? '').trim().toLowerCase();
    const hasEmail = email.length > 0;

    const roleFromPayload: AuthUser['role'] =
      payload.role === 'admin' || payload.roles?.includes('admin')
        ? 'admin'
        : 'user';

    const user = await this.resolveOrProvisionUser({
      externalId: payload.sub,
      email,
      hasEmail,
      roleFromPayload,
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role === 'admin' ? 'admin' : 'user',
    };
  }

  /**
   * Resolve o usuario local correspondente ao payload do gateway, criando
   * sob demanda (JIT) quando necessario.
   *
   * Protegido contra race conditions (P2002 no unique de `email` ou
   * `external_id`) quando duas requisicoes do mesmo login recem-chegado
   * acontecem em paralelo — cenario comum na primeira carga da UI.
   * Em caso de conflito, re-consultamos o banco para retornar o registro
   * "vencedor" da corrida, evitando 500 Internal Server Error.
   */
  private async resolveOrProvisionUser(input: {
    externalId: string;
    email: string;
    hasEmail: boolean;
    roleFromPayload: AuthUser['role'];
  }) {
    const { externalId, email, hasEmail, roleFromPayload } = input;

    // 1) Caminho feliz: ja foi JIT-provisionado.
    let user = await this.prisma.user.findUnique({
      where: { externalId },
    });

    // 2) Usuario legado sem externalId mas com mesmo email.
    if (!user && hasEmail) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        try {
          user = await this.prisma.user.update({
            where: { id: byEmail.id },
            data: { externalId, role: roleFromPayload },
          });
        } catch (err) {
          // Outra request paralela ja atribuiu externalId (ou ao mesmo,
          // ou houve colisao com outro sub). Tenta localizar de novo.
          if (this.isUniqueConstraintViolation(err)) {
            user =
              (await this.prisma.user.findUnique({
                where: { externalId },
              })) ??
              (await this.prisma.user.findUnique({ where: { email } }));
          } else {
            throw err;
          }
        }
      }
    }

    // 3) JIT: cria novo.
    if (!user) {
      if (!hasEmail) {
        // Sem email nao da para criar um user consistente (unique constraint).
        throw new UnauthorizedException('Payload sem email para JIT');
      }
      try {
        user = await this.prisma.user.create({
          data: {
            externalId,
            email,
            passwordHash: null,
            role: roleFromPayload,
          },
        });
      } catch (err) {
        // Race condition: outra request paralela criou o usuario primeiro
        // (via externalId OU email). Recuperamos o registro vencedor.
        if (this.isUniqueConstraintViolation(err)) {
          user =
            (await this.prisma.user.findUnique({
              where: { externalId },
            })) ??
            (hasEmail
              ? await this.prisma.user.findUnique({ where: { email } })
              : null);

          if (!user) {
            // Situacao realmente inesperada: houve P2002 mas nenhum
            // registro foi encontrado depois. Melhor falhar explicitamente
            // do que propagar um 500 generico.
            throw new UnauthorizedException(
              'Falha ao provisionar usuario (conflito de unicidade irrecuperavel)',
            );
          }

          // Se encontramos pelo email mas o externalId esta vazio/diferente,
          // tenta atualizar. Se falhar de novo, segue em frente com o que
          // temos — o proximo login resolve.
          if (!user.externalId || user.externalId !== externalId) {
            try {
              user = await this.prisma.user.update({
                where: { id: user.id },
                data: { externalId, role: roleFromPayload },
              });
            } catch (updateErr) {
              if (!this.isUniqueConstraintViolation(updateErr)) {
                throw updateErr;
              }
            }
          }
        } else {
          throw err;
        }
      }
    } else if (
      hasEmail &&
      (user.email !== email || user.role !== roleFromPayload)
    ) {
      // Mantem email e role sincronizados com o gateway a cada login.
      try {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { email, role: roleFromPayload },
        });
      } catch (err) {
        // Se outra request paralela alterou o email para algo que colide,
        // preferimos manter o registro anterior em memoria a propagar 500.
        if (!this.isUniqueConstraintViolation(err)) {
          throw err;
        }
      }
    }

    return user;
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }
}
