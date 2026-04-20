import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Throttler com tracker por-usuario quando o request traz um JWT valido.
 *
 * Objetivo: evitar que varios usuarios compartilhem o mesmo balde de rate
 * limit quando o app roda atras de proxy/CDN (EasyPanel, Cloudflare, etc.)
 * -- nesses cenarios, o IP visto pelo Nest eh o do edge, igual para todo
 * mundo, e 100 req/min se esgota rapido com multiplos admins logados.
 *
 * Estrategia:
 *   - Se houver Authorization: Bearer <jwt> no request, decodifica o payload
 *     (sem validar assinatura -- isso eh responsabilidade do JwtAuthGuard
 *     nos controllers) e usa `user:<sub>` como tracker.
 *   - Caso contrario (rotas publicas, JWT invalido, etc.), cai no tracker
 *     padrao do ThrottlerGuard, que eh o IP.
 *
 * Seguranca: se alguem forjar um sub, ainda precisa passar pelo JwtAuthGuard
 * para acessar as rotas protegidas; o unico efeito colateral seria consumir
 * o balde daquele user forjado -- o que nao afeta ninguem alem do proprio
 * atacante.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      const parts = token.split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
          );
          if (payload && typeof payload.sub === 'string' && payload.sub) {
            return `user:${payload.sub}`;
          }
        } catch {
          // fall through para tracker por IP
        }
      }
    }
    return super.getTracker(req);
  }
}
