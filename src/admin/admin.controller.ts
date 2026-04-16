import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { AdminService } from './admin.service';

class UpdateGlobalSettingsDto {
  @IsOptional() @IsString() model?: string | null;
  @IsOptional() @IsString() systemPrompt?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) allowedTools?: string[] | null;
  @IsOptional() @IsInt() @Min(1) @Max(200) maxTurns?: number | null;
  @IsOptional() @IsString() workingDirectory?: string | null;
}

class UpdateUserRoleDto {
  @IsIn(['user', 'admin']) role!: 'user' | 'admin';
}

class CreateApiKeyDto {
  @IsString() label!: string;
  @IsString() apiKey!: string;
}

class AssignApiKeyDto {
  @IsOptional() @IsString() userId?: string | null;
}

class SetApiKeyModelDto {
  @IsOptional() @IsString() modelId?: string | null;
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Global settings ────────────────────────────────────────────────
  @Get('settings')
  getGlobalSettings() { return this.adminService.getGlobalSettings(); }

  @Patch('settings')
  updateGlobalSettings(@Body() dto: UpdateGlobalSettingsDto) {
    return this.adminService.updateGlobalSettings(dto);
  }

  // ── Users ──────────────────────────────────────────────────────────
  @Get('users')
  listUsers() { return this.adminService.listUsers(); }

  @Patch('users/:id/role')
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(id, dto.role);
  }

  // ── API Keys ───────────────────────────────────────────────────────
  @Get('api-keys')
  listApiKeys() { return this.adminService.listApiKeys(); }

  @Post('api-keys')
  createApiKey(@Body() dto: CreateApiKeyDto) {
    return this.adminService.createApiKey(dto.label, dto.apiKey);
  }

  @Delete('api-keys/:id')
  deleteApiKey(@Param('id') id: string) {
    return this.adminService.deleteApiKey(id);
  }

  @Patch('api-keys/:id/assign')
  assignApiKey(@Param('id') id: string, @Body() dto: AssignApiKeyDto) {
    return this.adminService.assignApiKey(id, dto.userId ?? null);
  }

  @Patch('api-keys/:id/model')
  setApiKeyModel(@Param('id') id: string, @Body() dto: SetApiKeyModelDto) {
    return this.adminService.setApiKeyModel(id, dto.modelId ?? null);
  }

  // ── OpenRouter Models ─────────────────────────────────────────────
  @Get('models/openrouter')
  fetchOpenRouterModels(@Query('supported_parameters') supportedParameters?: string) {
    return this.adminService.fetchOpenRouterModels({ supportedParameters });
  }

  // ── Token Usage ───────────────────────────────────────────────────
  @Get('usage')
  listUsageByUser() {
    return this.adminService.listUsageByUser();
  }

  @Get('usage/:userId')
  getUserUsageHistory(@Param('userId') userId: string) {
    return this.adminService.getUserUsageHistory(userId);
  }
}
