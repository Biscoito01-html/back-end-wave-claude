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
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
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

class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
  @IsOptional() @IsString() name?: string | null;
  @IsOptional() @IsIn(['user', 'admin']) role?: 'user' | 'admin';
}

class UpdateUserDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() name?: string | null;
  @IsOptional() @IsString() password?: string | null;
  @IsOptional() @IsIn(['user', 'admin']) role?: 'user' | 'admin';
}

class CreateApiKeyDto {
  @IsString() label!: string;
  @IsString() apiKey!: string;
  @IsOptional() @IsString() assignedUserId?: string | null;
  @IsOptional() @IsString() preferredModelId?: string | null;
}

class UpdateApiKeyDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() apiKey?: string | null;
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

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser({
      email: dto.email,
      password: dto.password,
      name: dto.name ?? null,
      role: dto.role,
    });
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(id, {
      email: dto.email,
      name: dto.name,
      password: dto.password ?? null,
      role: dto.role,
    });
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.adminService.deleteUser(id, actor.id);
  }

  @Patch('users/:id/role')
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return this.adminService.updateUserRole(id, dto.role);
  }

  // ── API Keys ───────────────────────────────────────────────────────
  @Get('api-keys')
  listApiKeys() { return this.adminService.listApiKeys(); }

  @Post('api-keys')
  createApiKey(@Body() dto: CreateApiKeyDto) {
    return this.adminService.createApiKey(dto.label, dto.apiKey, {
      assignedUserId: dto.assignedUserId ?? null,
      preferredModelId: dto.preferredModelId ?? null,
    });
  }

  @Patch('api-keys/:id')
  updateApiKey(@Param('id') id: string, @Body() dto: UpdateApiKeyDto) {
    return this.adminService.updateApiKey(id, {
      label: dto.label,
      plainKey: dto.apiKey ?? null,
    });
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
