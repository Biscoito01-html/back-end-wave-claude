import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentDto {
  @IsString()
  name!: string;

  /** Filename as stored on disk (UUID + ext) */
  @IsString()
  storedName!: string;

  /** Public URL */
  @IsString()
  url!: string;

  @IsIn(['image', 'document', 'audio'])
  type!: 'image' | 'document' | 'audio';

  @IsString()
  mimeType!: string;
}

export class ChatStreamDto {
  @IsString()
  sessionId!: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsIn(['agent', 'plan'])
  mode?: 'agent' | 'plan';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsString()
  workingDirectory?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTools?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxTurns?: number;
}
