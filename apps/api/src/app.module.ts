import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { validateEnv } from './config/env';

/**
 * Root module.
 *
 * Phase 2 adds ProvidersModule.forRoot(mode), SearchModule and CacheModule here.
 * Kept intentionally thin — the search orchestration lives in its own module rather
 * than accreting at the root.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env, so api and web share one file rather than drifting apart.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
