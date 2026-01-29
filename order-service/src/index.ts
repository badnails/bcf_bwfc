import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';

const app = new Hono();

// Database connection
const sql = postgres({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'order_db',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Inventory service URL
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001';
const INVENTORY_TIMEOUT_MS = parseInt(process.env.INVENTORY_TIMEOUT_MS || '3000');

// Middleware
app.use('/*', cors());

// Helper: Generate order ID
function generateOrderId(): string {
  return `ORD-${crypto.randomUUID()}`;
}

// Helper: Call inventory service with timeout
async function callInventoryDeduct(orderId: string, productId: string, quantity: number, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INVENTORY_TIMEOUT_MS);

  try {
    const response = await fetch(`${INVENTORY_SERVICE_URL}/internal/inventory/deduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': headers['x-request-id'] || crypto.randomUUID(),
        'X-Correlation-ID': headers['x-correlation-id'] || crypto.randomUUID(),
      },
      body: JSON.stringify({ order_id: orderId, product_id: productId, quantity }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || error };
    }

    return { success: true, data: await response.json() };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: 'INVENTORY_SERVICE_TIMEOUT' };
    }
    return { success: false, error: error.message };
  }
}

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

// POST /api/orders - Place a new order
app.post('/api/orders', async (c) => {
  try {
    const body = await c.req.json();
    const { user_id, product_id, quantity, idempotency_key } = body;

    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
    const correlationId = c.req.header('X-Correlation-ID') || crypto.randomUUID();

    // Validation
    if (!user_id || !product_id || !quantity || quantity <= 0) {
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
        INSERT INTO orders (order_id, user_id, product_id, quantity, status, request_id, correlation_id)
        VALUES (${orderId}, ${user_id}, ${product_id}, ${quantity}, 'confirmed', ${requestId}, ${correlationId})
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
        INSERT INTO orders (order_id, user_id, product_id, quantity, status, error_message, request_id, correlation_id)
        VALUES (${orderId}, ${user_id}, ${product_id}, ${quantity}, 'failed', ${errorMessage}, ${requestId}, ${correlationId})
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

// GET /api/orders - Get user's order history
app.get('/api/orders', async (c) => {
  try {
    const userId = c.req.query('user_id');
    const status = c.req.query('status') || 'all';
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    if (!userId) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'user_id is required' } }, 400);
    }

    let orders;
    if (status === 'all') {
      orders = await sql`
        SELECT order_id, product_id, quantity, status, created_at as placed_at, error_message
        FROM orders
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      orders = await sql`
        SELECT order_id, product_id, quantity, status, created_at as placed_at, error_message
        FROM orders
        WHERE user_id = ${userId} AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const totalResult = await sql`SELECT COUNT(*) as count FROM orders WHERE user_id = ${userId}`;
    const total = parseInt(totalResult[0].count);

    return c.json({
      orders,
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
app.get('/api/orders/:order_id', async (c) => {
  try {
    const orderId = c.req.param('order_id');

    const orders = await sql`
      SELECT order_id, user_id, product_id, quantity, status, created_at as placed_at, error_message
      FROM orders
      WHERE order_id = ${orderId}
    `;

    if (orders.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Order not found' } }, 404);
    }

    return c.json(orders[0]);
  } catch (error: any) {
    console.error('Error fetching order:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// ============================================================================
// INTERNAL/ADMIN ENDPOINTS
// ============================================================================

// GET /internal/orders/stats - Get order statistics
app.get('/internal/orders/stats', async (c) => {
  try {
    const from = c.req.query('from');
    const to = c.req.query('to');

    let stats;
    if (from && to) {
      stats = await sql`
        SELECT
          COUNT(*) as total_orders,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_orders,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_orders
        FROM orders
        WHERE created_at BETWEEN ${from} AND ${to}
      `;
    } else {
      stats = await sql`
        SELECT
          COUNT(*) as total_orders,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_orders,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_orders
        FROM orders
      `;
    }

    return c.json({
      total_orders: parseInt(stats[0].total_orders),
      confirmed_orders: parseInt(stats[0].confirmed_orders),
      failed_orders: parseInt(stats[0].failed_orders),
      pending_orders: 0,
      average_processing_time_ms: 0,
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /health - Health check
app.get('/health', async (c) => {
  try {
    // Check database
    await sql`SELECT 1`;
    let dbStatus = 'healthy';

    // Check inventory service
    let inventoryStatus = 'healthy';
    try {
      const response = await fetch(`${INVENTORY_SERVICE_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) {
        inventoryStatus = 'unhealthy';
      }
    } catch {
      inventoryStatus = 'unhealthy';
    }

    const overallStatus = dbStatus === 'healthy' && inventoryStatus === 'healthy' ? 'healthy' : 'degraded';

    return c.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      dependencies: {
        inventory_service: inventoryStatus,
        database: dbStatus,
      },
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      dependencies: {
        inventory_service: 'unknown',
        database: 'unhealthy',
      },
    }, 503);
  }
});

// Start server
const port = parseInt(process.env.PORT || '3000');
console.log(`Order Service running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
