import { Global, Module, type DynamicModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SearchEvent, SearchEventSchema } from './search-event.schema';

/**
 * Search analytics.
 *
 * A dynamic module because analytics is optional. With no `MONGODB_URI` configured the
 * module registers the service without a model, every method degrades to a no-op, and the
 * application starts and serves searches exactly as before. That is what keeps `pnpm dev`
 * working on a clean checkout with nothing else running.
 *
 * Mongoose is configured to fail fast rather than buffer: by default a query issued while
 * disconnected waits indefinitely, which would turn "Mongo is not running" into "the
 * search hangs" — the opposite of degrading gracefully.
 */
@Global()
@Module({})
export class AnalyticsModule {
  /**
   * @param uri - MongoDB connection string. Omit to disable analytics entirely.
   * @returns A dynamic module exporting {@link AnalyticsService}.
   */
  static forRoot(uri?: string): DynamicModule {
    if (!uri) {
      return {
        module: AnalyticsModule,
        controllers: [AnalyticsController],
        providers: [AnalyticsService],
        exports: [AnalyticsService],
      };
    }

    return {
      module: AnalyticsModule,
      imports: [
        MongooseModule.forRoot(uri, {
          // Fail fast instead of queueing operations against a dead connection.
          bufferCommands: false,
          serverSelectionTimeoutMS: 2000,
          connectionFactory: (connection) => {
            connection.on('error', () => {
              // Swallowed deliberately: AnalyticsService reports connection state, and an
              // unhandled driver error would take the process down over telemetry.
            });
            return connection;
          },
        }),
        MongooseModule.forFeature([{ name: SearchEvent.name, schema: SearchEventSchema }]),
      ],
      controllers: [AnalyticsController],
      providers: [AnalyticsService],
      exports: [AnalyticsService],
    };
  }
}
