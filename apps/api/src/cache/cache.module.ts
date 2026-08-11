import { Global, Module } from '@nestjs/common';
import { CACHE_STORE, InMemoryCacheStore } from './cache.store';

/**
 * Provides the cache.
 *
 * Global because caching is cross-cutting rather than owned by any one feature. Swapping
 * in Redis means changing `useFactory` here and nothing else, every consumer depends on
 * the CacheStore interface, not on this implementation.
 */
@Global()
@Module({
  providers: [{ provide: CACHE_STORE, useFactory: () => new InMemoryCacheStore() }],
  exports: [CACHE_STORE],
})
export class CacheModule {}
