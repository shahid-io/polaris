import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { HealthController } from './health/health.controller';
import { AirportsController } from './airports/airports.controller';
import { ProvidersController } from './providers/providers.controller';
import { ProvidersModule } from './providers/providers.module';
import { SearchModule } from './search/search.module';
import { CacheModule } from './cache/cache.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { validateEnv } from './config/env';

/**
 * Load the root .env before the module decorators below are evaluated.
 *
 * ConfigModule also reads this file, but it does so during application bootstrap — after
 * the @Module metadata here has already been constructed. AnalyticsModule.forRoot needs
 * the connection string at metadata-construction time to decide whether to wire Mongoose
 * at all, which is earlier than ConfigService can answer. Node's built-in loadEnvFile
 * covers that gap without adding a dependency.
 */
try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // No .env file is a supported way to run: every value has a default, and the optional
  // credentials simply stay absent.
}

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
    AnalyticsModule.forRoot(process.env.MONGODB_URI),
    ProvidersModule.forRoot(),
    SearchModule,
  ],
  controllers: [HealthController, ProvidersController, AirportsController],
})
export class AppModule {}
