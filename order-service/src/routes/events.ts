import { Hono } from 'hono';
import { subscribeToOrderStatus } from '../helpers/order-events';
import { sql } from '../db';

const events = new Hono();

// GET /api/orders/:order_id/events - Server-Sent Events endpoint for order status updates
events.get('/:order_id/events', async (c) => {
  const orderId = c.req.param('order_id');

  // Verify order exists
  const orderResult = await sql`
    SELECT order_id, status FROM orders WHERE order_id = ${orderId}
  `;

  if (orderResult.length === 0) {
    return c.json({ error: 'Order not found' }, 404);
  }

  const order = orderResult[0];

  // If order is already resolved, return immediately
  if (order.status !== 'undecided') {
    return c.json({ 
      status: order.status,
      message: 'Order already resolved'
    });
  }

  // Set up SSE headers
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection message
      const initialMessage = `data: ${JSON.stringify({ 
        type: 'connected',
        order_id: orderId,
        message: 'Listening for status updates...'
      })}\n\n`;
      controller.enqueue(encoder.encode(initialMessage));

      // Subscribe to order status updates
      const unsubscribe = await subscribeToOrderStatus(orderId, (event) => {
        // Send the status update to the client with proper event type
        const message = `event: status_update\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(message));

        // Close the connection after sending the update
        controller.close();
      });

      // Set up cleanup on connection close
      c.req.raw.signal.addEventListener('abort', async () => {
        await unsubscribe();
        controller.close();
      });

      // Set timeout to close connection after 60 seconds if no update
      setTimeout(async () => {
        await unsubscribe();
        const timeoutMessage = `data: ${JSON.stringify({
          type: 'timeout',
          message: 'No update received within timeout period'
        })}\n\n`;
        controller.enqueue(encoder.encode(timeoutMessage));
        controller.close();
      }, 60000); // 60 second timeout
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

export default events;
