import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';

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
 * apenas valida e faz JIT provisioning do usuario correspondente.
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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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

    // 1) Caminho feliz: ja foi JIT-provisionado.
    let user = await this.prisma.user.findUnique({
      where: { externalId: payload.sub },
    });

    // 2) Usuario legado sem externalId mas com mesmo email.
    if (!user && hasEmail) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: { externalId: payload.sub, role: roleFromPayload },
        });
      }
    }

    // 3) JIT: cria novo.
    if (!user) {
      if (!hasEmail) {
        // Sem email nao da para criar um user consistente (unique constraint).
        throw new UnauthorizedException('Payload sem email para JIT');
      }
      user = await this.prisma.user.create({
        data: {
          externalId: payload.sub,
          email,
          passwordHash: null,
          role: roleFromPayload,
        },
      });
    } else if (
      hasEmail &&
      (user.email !== email || user.role !== roleFromPayload)
    ) {
      // Mantem email e role sincronizados com o gateway a cada login.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { email, role: roleFromPayload },
      });
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role === 'admin' ? 'admin' : 'user',
    };
  }
}
