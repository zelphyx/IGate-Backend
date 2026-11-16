import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BelibayarLiveService, BelibayarStubService } from './belibayar.service';
import { BelibayarClient } from './belibayar.types';

@Global()
@Module({
  providers: [
    {
      provide: 'BelibayarClient',
      useFactory: (config: ConfigService): BelibayarClient => {
        const mode = config.get<string>('belibayar.mode');
        return mode === 'test' ? new BelibayarStubService() : new BelibayarLiveService(config);
      },
      inject: [ConfigService],
    },
    {
      provide: 'DokuClient',
      useExisting: 'BelibayarClient',
    },
  ],
  exports: ['BelibayarClient', 'DokuClient'],
})
export class BelibayarModule {}

