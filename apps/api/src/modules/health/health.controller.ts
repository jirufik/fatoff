import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/public.decorator';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health(): { status: 'ok'; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
