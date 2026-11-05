import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DokuLiveService, DokuStubService } from './doku.service';
import { DokuClient } from './doku.types';

@Global()
@Module({
  providers: [
    {
      provide: 'DokuClient',
      useFactory: (config: ConfigService): DokuClient =>
        config.get<string>('doku.mode') === 'test' ? new DokuStubService() : new DokuLiveService(config),
      inject: [ConfigService],
    },
  ],
  exports: ['DokuClient'],
})
export class DokuModule {}
