import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * Como microservico atras do gateway `api-control-panel-core`, este
 * controller nao deveria mais emitir JWTs proprios. Mantemos as rotas
 * por compatibilidade/dev local, mas protegidas atras da flag
 * ENABLE_LOCAL_AUTH. Em producao essa flag deve ficar desligada para
 * centralizar autenticacao no gateway.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private ensureLocalAuthEnabled(): void {
    const raw = (
      this.configService.get<string>('ENABLE_LOCAL_AUTH') ?? ''
    )
      .toLowerCase()
      .trim();
    const enabled = raw === 'true' || raw === '1';
    if (!enabled) {
      throw new ForbiddenException(
        'Autenticacao local desabilitada. Use o gateway para obter um token.',
      );
    }
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<{ access_token: string }> {
    this.ensureLocalAuthEnabled();
    const disabled = (
      this.configService.get<string>('DISABLE_PUBLIC_REGISTER') ?? ''
    )
      .toLowerCase()
      .trim();
    if (disabled === 'true' || disabled === '1') {
      throw new ForbiddenException(
        'Registro publico desabilitado. Peca para um administrador criar sua conta.',
      );
    }
    return this.authService.register(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<{ access_token: string }> {
    this.ensureLocalAuthEnabled();
    return this.authService.login(dto);
  }
}
