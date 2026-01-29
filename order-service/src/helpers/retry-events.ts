import { getRedisClient } from './redis-client';
import { config } from '../config';

export interface RetryEvent {
  order_id: string;
  product_id: string;
  quantity: number;
  attempt: number;
  max_attempts: number;
  scheduled_at: number; // Unix timestamp in ms
}

const RETRY_QUEUE_KEY = 'order:retry:queue';

export async function publishRetryEvent(event: Omit<RetryEvent, 'scheduled_at'>): Promise<void> {
  try {
    const redis = await getRedisClient();
    
    // Calculate exponential backoff delay: 5s, 10s, 20s, 40s, 80s
    const delayMs = config.worker.initialRetryDelayMs * Math.pow(2, event.attempt);
    const scheduledAt = Date.now() + delayMs;

    const retryEvent: RetryEvent = {
      ...event,
      scheduled_at: scheduledAt,
    };

    // Add to sorted set with scheduled time as score
    await redis.zAdd(RETRY_QUEUE_KEY, {
      score: scheduledAt,
      value: JSON.stringify(retryEvent),
    });

    console.log(`Published retry event for order ${event.order_id}, attempt ${event.attempt + 1}/${event.max_attempts}, scheduled in ${delayMs}ms`);
  } catch (error) {
    console.error('Failed to publish retry event:', error);
    // Don't throw - we don't want to fail the order creation if Redis is down
  }
}

export async function consumeRetryEvents(): Promise<RetryEvent[]> {
  try {
    const redis = await getRedisClient();
    const now = Date.now();

    // Get events that are ready to process (score <= now)
    const events = await redis.zRangeByScore(RETRY_QUEUE_KEY, 0, now);

    if (events.length === 0) {
      return [];
    }

    // Remove processed events from the queue
    await redis.zRemRangeByScore(RETRY_QUEUE_KEY, 0, now);

    return events.map((event) => JSON.parse(event));
  } catch (error) {
    console.error('Failed to consume retry events:', error);
    return [];
  }
}
