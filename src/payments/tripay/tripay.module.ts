import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TripayLiveService, TripayStubService } from './tripay.service';
import { TripayClient } from './tripay.types';

@Global()
@Module({
  providers: [
    {
      provide: 'TripayClient',
      useFactory: (config: ConfigService): TripayClient =>
        config.get<string>('tripay.mode') === 'test' ? new TripayStubService() : new TripayLiveService(config),
      inject: [ConfigService],
    },
  ],
  exports: ['TripayClient'],
})
export class TripayModule {}
