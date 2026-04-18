import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ChatStreamDto } from './dto/chat-stream.dto';

/**
 * Aceita subpath relativo dentro do workspace do usuario. Rejeita:
 *  - strings com segmento `..`
 *  - caminhos absolutos (Unix `/` ou Windows `C:\` / `\\server`)
 *
 * Retorna a string normalizada (trim) ou null.
 */
function sanitizeWorkspaceSubpath(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  ) {
    throw new BadRequestException(
      'Caminho absoluto nao permitido. Use um subpath relativo ao seu workspace.',
    );
  }

  const segments = trimmed.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    throw new BadRequestException(
      'Segmento ".." nao permitido no caminho do workspace.',
    );
  }

  return trimmed;
}

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  model?: string | null;

  @IsOptional()
  @IsString()
  systemPrompt?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTools?: string[] | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxTurns?: number | null;

  @IsOptional()
  @IsString()
  workingDirectory?: string | null;

  @IsOptional()
  @IsBoolean()
  manualToolApproval?: boolean;
}

class ToolApprovalDto {
  @IsString()
  promptId!: string;

  @IsBoolean()
  approved!: boolean;
}

class RewindDto {
  @IsString()
  fromMessageId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  async getConversations(@CurrentUser() user: AuthUser) {
    return this.chatService.listConversations(user.id);
  }

  @Post('conversations')
  async createConversation(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chatService.createConversation(user.id, dto);
  }

  @Patch('conversations/:id')
  async updateConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.chatService.updateConversation(user.id, conversationId, dto);
  }

  @Delete('conversations/:id')
  async deleteConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.deleteConversation(user.id, conversationId);
  }

  @Get('conversations/:id/settings')
  async getConversationSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.getConversationSettings(user.id, conversationId);
  }

  @Patch('conversations/:id/settings')
  async updateConversationSettings(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    const safeDto = {
      ...dto,
      ...('workingDirectory' in dto
        ? { workingDirectory: sanitizeWorkspaceSubpath(dto.workingDirectory) }
        : {}),
    };
    return this.chatService.updateConversationSettings(
      user.id,
      conversationId,
      safeDto,
    );
  }

  @Get('conversations/:id/export')
  async exportConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Query('format') formatRaw: string,
    @Res() res: Response,
  ) {
    const format: 'markdown' | 'json' = formatRaw === 'json' ? 'json' : 'markdown';
    const result = await this.chatService.exportConversation(
      user.id,
      conversationId,
      format,
    );
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.send(result.content);
  }

  @Post('conversations/:id/compact')
  async compactConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.compactConversation(user.id, conversationId);
  }

  @Post('conversations/:id/rewind')
  async rewindConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body() dto: RewindDto,
  ) {
    return this.chatService.rewindConversation(
      user.id,
      conversationId,
      dto.fromMessageId,
    );
  }

  @Post('conversations/:id/tool-approval')
  async replyToolApproval(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body() dto: ToolApprovalDto,
  ) {
    return this.chatService.replyToolApproval(
      user.id,
      conversationId,
      dto.promptId,
      dto.approved,
    );
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.listMessages(user.id, conversationId);
  }

  @Post('conversations/:id/messages')
  async createMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') conversationId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chatService.createMessage(user.id, conversationId, dto);
  }

  @Get('me/usage')
  async getMyUsage(@CurrentUser() user: AuthUser) {
    return this.chatService.getMyTokenUsage(user.id);
  }

  @Get('models')
  async getModels() {
    return this.chatService.getAvailableModels();
  }

  @Get('tools')
  async getTools() {
    return this.chatService.getAvailableTools();
  }

  @Post('chat/stream')
  async streamChat(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChatStreamDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const safeWorkingDirectory = sanitizeWorkspaceSubpath(
      dto.workingDirectory ?? null,
    );

    let streamedText = '';
    const cleanup = await this.chatService.streamAssistantReply({
      user,
      conversationId: dto.sessionId,
      message: dto.message,
      attachments: dto.attachments,
      mode: dto.mode ?? 'agent',
      workingDirectory: safeWorkingDirectory ?? undefined,
      model: dto.model,
      systemPrompt: dto.systemPrompt,
      allowedTools: dto.allowedTools,
      maxTurns: dto.maxTurns,
      onStream: {
        onToken: (chunk: string) => {
          streamedText += chunk;
          res.write(`event: token\n`);
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        },
        onHtmlPreview: (html: string, filePath: string) => {
          res.write(`event: html_preview\n`);
          res.write(`data: ${JSON.stringify({ html, file_path: filePath })}\n\n`);
        },
        onToolStart: ({ toolName, argumentsJson, toolUseId }) => {
          res.write(`event: tool_start\n`);
          res.write(
            `data: ${JSON.stringify({
              tool_name: toolName,
              arguments_json: argumentsJson,
              tool_use_id: toolUseId,
            })}\n\n`,
          );
        },
        onToolResult: ({ toolName, toolUseId, output, isError }) => {
          res.write(`event: tool_result\n`);
          res.write(
            `data: ${JSON.stringify({
              tool_name: toolName,
              tool_use_id: toolUseId,
              output,
              is_error: isError,
            })}\n\n`,
          );
        },
        onActionRequired: ({ promptId, toolName, argumentsJson }) => {
          res.write(`event: action_required\n`);
          res.write(
            `data: ${JSON.stringify({
              prompt_id: promptId,
              tool_name: toolName,
              arguments_json: argumentsJson,
            })}\n\n`,
          );
        },
        onDone: async ({ fullText, promptTokens, completionTokens }) => {
          const finalText = (fullText || streamedText).trim();

          if (promptTokens > 0 || completionTokens > 0) {
            await this.chatService.recordTokenUsage({
              userId: user.id,
              conversationId: dto.sessionId,
              promptTokens,
              completionTokens,
              model: dto.model ?? null,
            }).catch(() => { /* não bloquear a resposta se falhar */ });
          }

          res.write(`event: done\n`);
          res.write(
            `data: ${JSON.stringify({
              full_text: finalText,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            })}\n\n`,
          );
          res.end();
        },
        onError: (message: string) => {
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ message })}\n\n`);
          res.end();
        },
      },
    });

    res.on('close', () => {
      cleanup?.();
    });
  }
}
