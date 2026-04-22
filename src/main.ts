import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { assertEnvironmentReady } from './utils/assert-env';

async function bootstrap() {
  assertEnvironmentReady();

  const uploadDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Desabilita ETag global do Express. Para APIs JSON autenticadas o ETag
  // so causa problema: o browser envia If-None-Match, o servidor responde
  // 304 sem body, e o fetch do front trata como erro (response.ok = false).
  // Sintoma classico: endpoints como /me/usage retornando "zerados" no
  // painel mesmo com dados no banco.
  app.disable('etag');
  // x-powered-by: Express deixa vazar "Express" em todo response header.
  // Nao tem uso pratico e e informacao a menos pra quem esta fuzzando a API.
  app.disable('x-powered-by');

  // Prefixo global: este backend roda atras do api-control-panel-core, que
  // nao reescreve path. Requests chegam como /wave-claude/<rota>. Para os
  // controllers continuarem declarando @Controller('conversations') etc.,
  // aplicamos o prefix aqui.
  app.setGlobalPrefix('wave-claude');

  // Estaticos de upload precisam casar com o prefix global para que URLs
  // como /wave-claude/uploads/<arquivo> continuem servindo a partir do
  // gateway (que preserva o path inteiro).
  app.useStaticAssets(uploadDir, { prefix: '/wave-claude/uploads' });

  // CORS: este servico so recebe requests server-to-server vindas do
  // gateway. Nao ha browser chamando direto, entao nao habilitamos CORS.
  // Defesa em profundidade mesmo com o dominio publico no EasyPanel.

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const port = process.env.PORT ?? '3002';
  await app.listen(port);
  console.log(`[Backend] Rodando na porta ${port} | prefix: /wave-claude`);
}
bootstrap();
