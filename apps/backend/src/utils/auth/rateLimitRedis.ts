/**
 * Shared Redis client + rate-limit store factory.
 *
 * v1.70 — addresses issue #6 (in-memory rate limiter bypassable in
 * multi-instance deployments). The pre-built limiters in
 * `rateLimit.ts` (loginLimiter, registerLimiter, etc.) all call
 * `getRedisRateLimitStore()` at module load. When REDIS_TCP_URL is
 * set, the returned store is a `rate-limit-redis` RedisStore backed
 * by a fresh `ioredis` connection. When unset, `undefined` is returned
 * and express-rate-limit falls back to its in-memory Map — which
 * keeps dev / test environments working without Redis.
 *
 * Connection handling mirrors `utils/jobs/documentQueue.ts`:
 *  - URL parsing handles rediss:// (Upstash) → enable TLS
 *  - Uses REDIS_TCP_URL env var (consistent with BullMQ usage)
 *  - maxRetriesPerRequest: null (required by rate-limit-redis)
 *
 * Note: a fresh IORedis is created per call. That's intentional —
 * rate-limit-redis manages its own connection internally; we just
 * need a client that responds to the redis-compatible command API.
 * The cost is one extra TCP connection per process, which is
 * negligible compared to the BullMQ + Upstash REST clients we
 * already open.
 */

import IORedis from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Store } from 'express-rate-limit';
import { logger } from '../http/logger.js';
import { loadConfig } from '../../config/loader.js';

let _client: IORedis | null = null;
let _clientInitialized = false;
let useLocalFallback = false;

function buildLocalClient(): IORedis | null {
  const localUrlExplicit = !!process.env.REDIS_LOCAL_TCP_URL;
  if (!localUrlExplicit) {
    return null;
  }
  const localUrl = process.env.REDIS_LOCAL_TCP_URL;
  const localClient = new IORedis(localUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  localClient.on('error', (err) => {
    // Suppress local connection errors
  });
  return localClient;
}

function buildRedisClient(): IORedis | null {
  if (process.env.REDIS_DISABLED === 'true') {
    return null;
  }
  const config = loadConfig();
  const url = config.redis.tcpUrl || process.env.REDIS_TCP_URL;
  const hasRemoteUrl = url && url !== '#' && url.trim() !== '';
  const localUrlExplicit = !!process.env.REDIS_LOCAL_TCP_URL;
  
  // Only enable Redis if explicitly configured or local fallback is explicitly set
  if (!hasRemoteUrl && !localUrlExplicit) {
    return null;
  }
  
  if (useLocalFallback || !hasRemoteUrl) {
    return buildLocalClient();
  }
  
  try {
    const u = new URL(url);
    const client = new IORedis({
      host: u.hostname,
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      username: u.username || undefined,
      maxRetriesPerRequest: null as unknown as number,
      ...(url.startsWith('rediss://') ? { tls: {} as Record<string, unknown> } : {}),
      lazyConnect: true,
    });
    client.on('error', (err) => {
      logger.warn(`[rateLimitRedis] Connection error on remote: ${err.message}. Falling back to local Redis.`);
      if (!useLocalFallback) {
        useLocalFallback = true;
        if (_client === client) {
          _client = buildLocalClient();
        }
      }
    });
    return client;
  } catch (err) {
    logger.warn(`[rateLimitRedis] Failed to parse remote URL: ${(err as Error).message}. Falling back to local.`);
    return buildLocalClient();
  }
}

function getRedisClient(): IORedis | null {
  if (_clientInitialized) return _client;
  _clientInitialized = true;
  _client = buildRedisClient();
  if (_client) {
    logger.info('[rateLimitRedis] Using Redis-backed rate limiter stores (shared connection)');
  }
  return _client;
}

function getFailSafeReply(args: string[]): RedisReply {
  const cmd = args[0]?.toUpperCase();
  if (cmd === 'SCRIPT') {
    return 'failsafe_sha';
  }
  if (cmd === 'EVALSHA' || cmd === 'EVAL') {
    // Return [ totalHits, timeToExpire ]
    // We simulate 1 hit and 60,000 milliseconds remaining (60 seconds)
    return [1, 60000] as unknown as RedisReply;
  }
  return 'OK' as unknown as RedisReply;
}

/**
 * Returns a new RedisStore instance with a unique prefix when REDIS_TCP_URL is set,
 * or undefined to signal express-rate-limit to use its default in-memory Map.
 */
export function getRedisRateLimitStore(prefix: string): Store | undefined {
  const client = getRedisClient();
  if (!client) return undefined;
  try {
    return new RedisStore({
      // sendCommand is the bridge rate-limit-redis uses to talk to
      // any Redis-compatible client. The signature expects
      // Promise<RedisReply>; cast the ioredis return value through unknown.
      sendCommand: async (...args: string[]): Promise<RedisReply> => {
        let activeClient = _client || getRedisClient();
        if (!activeClient) {
          return getFailSafeReply(args);
        }
        try {
          return await (activeClient.call(...(args as [string, ...string[]])) as unknown as Promise<RedisReply>);
        } catch (err) {
          const msg = (err as Error).message || '';
          const lowerMsg = msg.toLowerCase();
          if (
            lowerMsg.includes('rate limit') ||
            lowerMsg.includes('quota') ||
            lowerMsg.includes('forbidden') ||
            lowerMsg.includes('unauthorized') ||
            lowerMsg.includes('limit exceeded') ||
            lowerMsg.includes('max requests')
          ) {
            if (!useLocalFallback) {
              logger.warn(`[rateLimitRedis] Upstash Redis error detected in command: ${msg}. Switching to local Redis fallback.`);
              useLocalFallback = true;
              activeClient = buildLocalClient();
              _client = activeClient;
            }
            try {
              return await (activeClient.call(...(args as [string, ...string[]])) as unknown as Promise<RedisReply>);
            } catch (fallbackErr) {
              logger.error(`[rateLimitRedis] Fallback Redis command also failed: ${(fallbackErr as Error).message}. Using fail-safe mock response.`);
              return getFailSafeReply(args);
            }
          }
          logger.error(`[rateLimitRedis] Redis command failed: ${msg}. Using fail-safe mock response.`);
          return getFailSafeReply(args);
        }
      },
      prefix: `rl:${prefix}:`,  // unique namespace in Redis per limiter
    });
  } catch (err) {
    logger.warn(`[rateLimitRedis] Failed to construct RedisStore for prefix ${prefix}, falling back to in-memory: ${(err as Error).message}`);
    return undefined;
  }
}