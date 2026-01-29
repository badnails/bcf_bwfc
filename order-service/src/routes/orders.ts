import { Hono } from 'hono';
import { sql } from '../db';
import { generateOrderId } from '../helpers/order-helpers';
import { callInventoryDeduct } from '../helpers/inventory-client';

const orders = new Hono();

// POST /api/orders - Place a new order
orders.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { product_id, quantity, idempotency_key } = body;

    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
    const correlationId = c.req.header('X-Correlation-ID') || crypto.randomUUID();

    // Validation
    if (!product_id || !quantity || quantity <= 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } }, 400);
    }

    // If idempotency key provided, check if order exists
    if (idempotency_key) {
      const existingOrder = await sql`
        SELECT * FROM orders WHERE order_id = ${idempotency_key}
      `;

      if (existingOrder.length > 0) {
        const order = existingOrder[0];
        return c.json({
          order_id: order.order_id,
          status: order.status,
          product_id: order.product_id,
          quantity: order.quantity,
          message: order.status === 'confirmed' ? 'Order placed and fulfilled' : order.error_message,
          timestamp: order.created_at,
        });
      }
    }

    // Generate new order ID
    const orderId = generateOrderId();

    // Call inventory service to deduct stock
    const inventoryResult = await callInventoryDeduct(orderId, product_id, quantity, {
      'x-request-id': requestId,
      'x-correlation-id': correlationId,
    });

    if (inventoryResult.success) {
      // Order confirmed - save to database
      await sql`
        INSERT INTO orders (order_id, product_id, quantity, status, request_id, correlation_id)
        VALUES (${orderId}, ${product_id}, ${quantity}, 'confirmed', ${requestId}, ${correlationId})
      `;

      return c.json({
        order_id: orderId,
        status: 'confirmed',
        product_id,
        quantity,
        message: 'Order placed and fulfilled',
        timestamp: new Date().toISOString(),
      });
    } else {
      // Order failed
      const errorMessage = inventoryResult.error === 'INVENTORY_SERVICE_TIMEOUT' 
        ? 'Could not confirm inventory availability. Retry with the order ID.'
        : typeof inventoryResult.error === 'string' 
          ? inventoryResult.error 
          : inventoryResult.error?.message || 'Insufficient inventory';

      await sql`
        INSERT INTO orders (order_id, product_id, quantity, status, error_message, request_id, correlation_id)
        VALUES (${orderId}, ${product_id}, ${quantity}, 'failed', ${errorMessage}, ${requestId}, ${correlationId})
      `;

      if (inventoryResult.error === 'INVENTORY_SERVICE_TIMEOUT') {
        return c.json({
          order_id: orderId,
          status: 'failed',
          error: {
            code: 'INVENTORY_SERVICE_TIMEOUT',
            message: errorMessage,
            timestamp: new Date().toISOString(),
          },
        }, 503);
      }

      return c.json({
        order_id: orderId,
        status: 'failed',
        product_id,
        quantity,
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    console.error('Error placing order:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /api/orders - Get all order history
orders.get('/', async (c) => {
  try {
    const status = c.req.query('status') || 'all';
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    let ordersList;
    if (status === 'all') {
      ordersList = await sql`
        SELECT order_id, product_id, quantity, status, created_at as placed_at, error_message
        FROM orders
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      ordersList = await sql`
        SELECT order_id, product_id, quantity, status, created_at as placed_at, error_message
        FROM orders
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const totalResult = await sql`SELECT COUNT(*) as count FROM orders`;
    const total = parseInt(totalResult[0].count);

    return c.json({
      orders: ordersList,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('Error fetching orders:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /api/orders/:order_id - Get specific order details
orders.get('/:order_id', async (c) => {
  try {
    const orderId = c.req.param('order_id');

    const ordersList = await sql`
      SELECT order_id, user_id, product_id, quantity, status, created_at as placed_at, error_message
      FROM orders
      WHERE order_id = ${orderId}
    `;

    if (ordersList.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Order not found' } }, 404);
    }

    return c.json(ordersList[0]);
  } catch (error: any) {
    console.error('Error fetching order:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

export default orders;
