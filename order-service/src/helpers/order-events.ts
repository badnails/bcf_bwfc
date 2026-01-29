import { getRedisClient } from './redis-client';

export interface OrderStatusEvent {
  order_id: string;
  status: 'confirmed' | 'failed';
  error_message?: string;
  timestamp: string;
}

const ORDER_STATUS_CHANNEL = 'order:status';

/**
 * Publish order status change event to Redis pub/sub
 * Notifies all SSE listeners about the status change
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

    // Publish to channel specific to this order
    const channel = `${ORDER_STATUS_CHANNEL}:${orderId}`;
    await redis.publish(channel, JSON.stringify(event));

    console.log(`📢 Published status change for order ${orderId}: ${status}`);
  } catch (error) {
    console.error('Failed to publish order status change:', error);
    // Don't throw - we don't want to fail the order update if Redis is down
  }
}

/**
 * Subscribe to order status changes for a specific order
 * Used by SSE endpoint to stream updates to clients
 */
export async function subscribeToOrderStatus(
  orderId: string,
  callback: (event: OrderStatusEvent) => void
): Promise<() => Promise<void>> {
  const redis = await getRedisClient();
  const subscriber = redis.duplicate();
  await subscriber.connect();

  const channel = `${ORDER_STATUS_CHANNEL}:${orderId}`;

  await subscriber.subscribe(channel, (message) => {
    try {
      const event = JSON.parse(message) as OrderStatusEvent;
      callback(event);
    } catch (error) {
      console.error('Failed to parse order status event:', error);
    }
  });

  console.log(`👂 Subscribed to order status updates: ${orderId}`);

  // Return cleanup function
  return async () => {
    await subscriber.unsubscribe(channel);
    await subscriber.quit();
    console.log(`🔇 Unsubscribed from order status updates: ${orderId}`);
  };
}
