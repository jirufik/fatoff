import { Global, Module } from '@nestjs/common';

import { CryptoService } from '../../common/crypto.service';
import { YazioService } from './yazio.service';

@Global()
@Module({
  providers: [CryptoService, YazioService],
  exports: [CryptoService, YazioService],
})
export class YazioModule {}
