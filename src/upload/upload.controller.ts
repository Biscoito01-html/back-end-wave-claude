import {
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/xml',
  'application/xml',
  'text/html',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
]);

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

function resolveUploadDir(configService: ConfigService): string {
  const configured = configService.get<string>('UPLOAD_DIR');
  if (configured) return configured;
  return join(process.cwd(), 'uploads');
}

@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly configService: ConfigService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = join(process.cwd(), 'uploads');
          if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
          cb(null, uploadDir);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Tipo de arquivo não suportado: ${file.mimetype}`,
            ),
            false,
          );
        }
      },
    }),
  )
  uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
  ): {
    files: Array<{ name: string; storedName: string; url: string; type: string; mimeType: string; size: number }>;
  } {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo recebido.');
    }

    const backendUrl =
      this.configService.get<string>('BACKEND_URL') ?? 'http://localhost:3002';

    return {
      files: files.map((f) => ({
        name: f.originalname,
        storedName: f.filename,
        url: `${backendUrl}/uploads/${f.filename}`,
        type: this.resolveType(f.mimetype),
        mimeType: f.mimetype,
        size: f.size,
      })),
    };
  }

  private resolveType(
    mime: string,
  ): 'image' | 'document' | 'audio' {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }
}
