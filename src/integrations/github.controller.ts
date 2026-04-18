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
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { GithubService } from './github.service';

class ConnectGithubDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

@UseGuards(JwtAuthGuard)
@Controller('integrations/github')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.github.getStatus(user.id);
  }

  @Post('connect')
  connect(@CurrentUser() user: AuthUser, @Body() dto: ConnectGithubDto) {
    return this.github.connect(user.id, dto.token);
  }

  @Delete('connect')
  async disconnect(@CurrentUser() user: AuthUser) {
    await this.github.disconnect(user.id);
    return { ok: true };
  }

  @Get('repos')
  listRepos(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.github.listRepos(
      user.id,
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 30,
    );
  }

  @Get('repos/:owner/:repo/contents')
  getRootContents(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('ref') ref?: string,
  ) {
    return this.github.getRepoContents(user.id, owner, repo, '', ref);
  }

  @Get('repos/:owner/:repo/contents/*')
  getContents(
    @CurrentUser() user: AuthUser,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('0') innerPath: string,
    @Query('ref') ref?: string,
  ) {
    return this.github.getRepoContents(user.id, owner, repo, innerPath ?? '', ref);
  }
}
