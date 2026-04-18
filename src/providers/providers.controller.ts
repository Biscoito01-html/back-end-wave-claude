import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ProvidersService } from './providers.service';

class CreateProfileDto {
  @IsString()
  name!: string;

  @IsString()
  provider!: string;

  @IsString()
  apiKey!: string;

  @IsOptional()
  @IsString()
  baseUrl?: string | null;

  @IsOptional()
  @IsString()
  defaultModel?: string | null;

  @IsOptional()
  @IsObject()
  extraHeaders?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  apiKey?: string | null;

  @IsOptional()
  @IsString()
  baseUrl?: string | null;

  @IsOptional()
  @IsString()
  defaultModel?: string | null;

  @IsOptional()
  @IsObject()
  extraHeaders?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('providers')
export class ProvidersController {
  constructor(private readonly service: ProvidersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProfileDto) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
