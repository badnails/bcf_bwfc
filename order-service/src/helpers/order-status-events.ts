import { getRedisClient } from './redis-client';

export interface OrderStatusEvent {
  order_id: string;
  status: 'confirmed' | 'failed';
  error_message?: string;
  timestamp: string;
}

const ORDER_STATUS_CHANNEL_PREFIX = 'order:status:';

/**
 * Publish order status change event to Redis pub/sub
 */
export async function publishOrderStatusChange(
  orderId: string,
  status: 'confirmed' | 'failed',
  errorMessage?: string
): Promise<void> {
  try {
    const redis = await getRedisClient();
    
    const event: OrderStatusEvent = {
      order_id: orderId,
      status,
      error_message: errorMessage,
      timestamp: new Date().toISOString(),
    };

    const channel = `${ORDER_STATUS_CHANNEL_PREFIX}${orderId}`;
    await redis.publish(channel, JSON.stringify(event));

    console.log(`📢 Published status change for order ${orderId}: ${status}`);
  } catch (error) {
    console.error('Failed to publish order status change:', error);
    // Don't throw - we don't want to fail the order update if Redis pub/sub fails
  }
}

/**
 * Subscribe to order status changes for a specific order
 * Returns an async iterator that yields status events
 */
export async function subscribeToOrderStatus(
  orderId: string,
  onMessage: (event: OrderStatusEvent) => void,
  onError?: (error: Error) => void
): Promise<() => Promise<void>> {
  const redis = await getRedisClient();
  const subscriber = redis.duplicate();
  
  await subscriber.connect();

  const channel = `${ORDER_STATUS_CHANNEL_PREFIX}${orderId}`;

  await subscriber.subscribe(channel, (message) => {
    try {
      const event: OrderStatusEvent = JSON.parse(message);
      onMessage(event);
    } catch (error) {
      console.error('Failed to parse order status event:', error);
      if (onError) {
        onError(error as Error);
      }
    }
  });

  console.log(`👂 Subscribed to status updates for order ${orderId}`);

  // Return cleanup function
  return async () => {
    await subscriber.unsubscribe(channel);
    await subscriber.quit();
    console.log(`👋 Unsubscribed from order ${orderId}`);
  };
}
