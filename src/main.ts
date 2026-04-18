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
  app.useStaticAssets(uploadDir, { prefix: '/uploads' });

  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:8080';
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });
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
  console.log(`[Backend] Rodando na porta ${port} | CORS: ${frontendUrl}`);
}
bootstrap();
