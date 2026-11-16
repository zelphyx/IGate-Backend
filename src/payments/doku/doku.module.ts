import { Global, Module } from '@nestjs/common';
import { BelibayarModule } from '../belibayar/belibayar.module';

@Global()
@Module({
  imports: [BelibayarModule],
  exports: [BelibayarModule],
})
export class DokuModule {}
