import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PermissionsService } from './permissions.service';

class UpsertRuleDto {
  @IsString()
  toolName!: string;

  @IsString()
  mode!: string;

  @IsOptional()
  @IsString()
  conversationId?: string | null;
}

@UseGuards(JwtAuthGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.service.list(user.id, conversationId ?? null);
  }

  @Get('all')
  listAll(@CurrentUser() user: AuthUser) {
    return this.service.listAllForUser(user.id);
  }

  @Post()
  upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertRuleDto) {
    return this.service.upsert(user.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id);
  }
}
