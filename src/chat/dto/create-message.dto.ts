import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;

  @IsOptional()
  attachments?: unknown;

  @IsOptional()
  @IsInt()
  tokensUsed?: number;
}
