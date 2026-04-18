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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<{ access_token: string }> {
    const disabled = (
      this.configService.get<string>('DISABLE_PUBLIC_REGISTER') ?? ''
    )
      .toLowerCase()
      .trim();
    // #region agent log
    fetch('http://127.0.0.1:7663/ingest/53ec07ba-5f17-47c7-8ec5-3fd963c44b2a',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abb1f'},body:JSON.stringify({sessionId:'3abb1f',hypothesisId:'H5',location:'auth.controller.ts:register',message:'register attempt',data:{disabledRaw:disabled,willBlock:disabled==='true'||disabled==='1'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7663/ingest/53ec07ba-5f17-47c7-8ec5-3fd963c44b2a',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'3abb1f'},body:JSON.stringify({sessionId:'3abb1f',hypothesisId:'H4',location:'auth.controller.ts:login',message:'login attempt reached handler (not throttled)',data:{emailHash:dto?.email?String(dto.email).length:0},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return this.authService.login(dto);
  }
}
