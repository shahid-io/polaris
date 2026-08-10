import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../analytics/analytics.service';
import type { Env } from '../config/env';

@Controller('api/health')
export class HealthController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * Liveness plus the two facts that matter when something looks wrong during a demo:
   * which provider mode is active, and whether credentials were actually loaded.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'polaris-api',
      providerMode: this.config.get('PROVIDER_MODE', { infer: true }),
      analytics: this.analytics.isConnected() ? 'connected' : 'disconnected',
      credentials: {
        serpapi: Boolean(this.config.get('SERPAPI_KEY', { infer: true })),
        duffel: Boolean(this.config.get('DUFFEL_ACCESS_TOKEN', { infer: true })),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
