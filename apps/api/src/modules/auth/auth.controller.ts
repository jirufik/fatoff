import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { AuthService, SESSION_COOKIE } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // перебор пароля должен упираться в лимит, а не в скорость сети
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): { ok: true } {
    const { token, maxAgeMs } = this.auth.login(dto.password);
    res.cookie(SESSION_COOKIE, token, { ...this.auth.cookieOptions, maxAge: maxAgeMs });
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    res.clearCookie(SESSION_COOKIE, this.auth.cookieOptions);
    return { ok: true };
  }

  /**
   * Проверка сессии. Закрыта стражем, поэтому 401 здесь — обычный ответ
   * «не залогинен», а не сбой.
   */
  @Get('session')
  session(): { ok: true } {
    return { ok: true };
  }
}
