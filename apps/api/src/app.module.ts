import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { ProvidersController } from './providers/providers.controller';
import { ProvidersModule } from './providers/providers.module';
import { SearchModule } from './search/search.module';
import { CacheModule } from './cache/cache.module';
import { validateEnv } from './config/env';

/**
 * Root module.
 *
 * Deliberately thin: it wires modules together and owns no business logic. Search
 * orchestration lives in its own module rather than accreting here, which is what keeps
 * the orchestrator testable in isolation.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Root .env, so api and web share one file rather than drifting apart.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    CacheModule,
    ProvidersModule.forRoot(),
    SearchModule,
  ],
  controllers: [HealthController, ProvidersController],
})
export class AppModule {}
