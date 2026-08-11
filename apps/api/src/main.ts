import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // bufferLogs holds every startup message until this is called. Without it the buffer is
  // never drained and the process runs completely silently, including the errors you most
  // need when something fails to start.
  app.flushLogs();

  const config = app.get(ConfigService<Env, true>);

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.get('API_CORS_ORIGIN', { infer: true }) });
  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Polaris API listening on http://localhost:${port}`);
  logger.log(`Provider mode: ${config.get('PROVIDER_MODE', { infer: true })}`);
}

void bootstrap();
