import { Hono } from 'hono';
import { cors } from 'hono/cors';
import postgres from 'postgres';

const app = new Hono();

// Database connection
const sql = postgres({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'inventory_db',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Gremlin latency simulation
let gremlinEnabled = false;
let requestCounter = 0;

// Middleware
app.use('/*', cors());

// Gremlin latency middleware - simulates delays in a predictable pattern
app.use('/internal/inventory/deduct', async (c, next) => {
  if (gremlinEnabled) {
    requestCounter++;
    // Every 3rd request gets delayed (predictable, deterministic pattern)
    if (requestCounter % 3 === 0) {
      console.log(`[GREMLIN] Delaying request #${requestCounter} by 5 seconds`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  await next();
});

// ============================================================================
// PUBLIC ENDPOINTS
// ============================================================================

// GET /api/inventory - Get all products
app.get('/api/inventory', async (c) => {
  try {
    const inStockOnly = c.req.query('in_stock_only') === 'true';
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');

    let products;
    if (inStockOnly) {
      products = await sql`
        SELECT product_id, name, stock_level, stock_level as available_stock, last_updated
        FROM products
        WHERE stock_level > 0
        ORDER BY name
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      products = await sql`
        SELECT product_id, name, stock_level, stock_level as available_stock, last_updated
        FROM products
        ORDER BY name
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const totalResult = await sql`SELECT COUNT(*) as count FROM products`;
    const total = parseInt(totalResult[0].count);

    return c.json({
      products: products.map(p => ({
        ...p,
        reserved_stock: 0, // We don't use reservation anymore
      })),
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('Error fetching inventory:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /api/inventory/:product_id - Get specific product
app.get('/api/inventory/:product_id', async (c) => {
  try {
    const productId = c.req.param('product_id');

    const products = await sql`
      SELECT product_id, name, stock_level, stock_level as available_stock, last_updated
      FROM products
      WHERE product_id = ${productId}
    `;

    if (products.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404);
    }

    return c.json({
      ...products[0],
      reserved_stock: 0,
    });
  } catch (error: any) {
    console.error('Error fetching product:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// POST /api/inventory/check - Check stock availability
app.post('/api/inventory/check', async (c) => {
  try {
    const body = await c.req.json();
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } }, 400);
    }

    const results = [];
    let allAvailable = true;

    for (const item of items) {
      const products = await sql`
        SELECT stock_level FROM products WHERE product_id = ${item.product_id}
      `;

      if (products.length === 0) {
        results.push({
          product_id: item.product_id,
          requested_quantity: item.quantity,
          available_quantity: 0,
          in_stock: false,
        });
        allAvailable = false;
      } else {
        const inStock = products[0].stock_level >= item.quantity;
        results.push({
          product_id: item.product_id,
          requested_quantity: item.quantity,
          available_quantity: products[0].stock_level,
          in_stock: inStock,
        });
        if (!inStock) allAvailable = false;
      }
    }

    return c.json({
      available: allAvailable,
      items: results,
    });
  } catch (error: any) {
    console.error('Error checking inventory:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// ============================================================================
// SERVICE-TO-SERVICE ENDPOINTS
// ============================================================================

// POST /internal/inventory/deduct - Deduct inventory (idempotent)
app.post('/internal/inventory/deduct', async (c) => {
  try {
    const body = await c.req.json();
    const { order_id, product_id, quantity } = body;

    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
    const correlationId = c.req.header('X-Correlation-ID') || crypto.randomUUID();

    console.log(`[${requestId}] Deduct request: order=${order_id}, product=${product_id}, qty=${quantity}`);

    // Validation
    if (!order_id || !product_id || !quantity || quantity <= 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } }, 400);
    }

    // Begin transaction
    await sql.begin(async (tx) => {
      // Check idempotency - has this order already been processed?
      const existing = await tx`
        SELECT * FROM inventory_operations
        WHERE order_id = ${order_id} AND operation_type = 'deduct'
      `;

      if (existing.length > 0) {
        console.log(`[${requestId}] Idempotent replay for order ${order_id}`);
        // Return cached result
        const op = existing[0];
        return c.json({
          order_id: op.order_id,
          product_id: op.product_id,
          quantity_deducted: Math.abs(op.quantity_change),
          new_stock_level: op.new_stock,
          timestamp: op.created_at,
        });
      }

      // Check stock availability (with row lock)
      const products = await tx`
        SELECT stock_level FROM products
        WHERE product_id = ${product_id}
        FOR UPDATE
      `;

      if (products.length === 0) {
        throw new Error('Product not found');
      }

      const currentStock = products[0].stock_level;

      if (currentStock < quantity) {
        console.log(`[${requestId}] Insufficient stock: ${currentStock} < ${quantity}`);
        throw new Error('Insufficient stock');
      }

      // Deduct stock
      const newStock = currentStock - quantity;
      await tx`
        UPDATE products
        SET stock_level = ${newStock}, last_updated = NOW()
        WHERE product_id = ${product_id}
      `;

      // Record operation (UNIQUE constraint prevents duplicates)
      await tx`
        INSERT INTO inventory_operations (
          operation_type, product_id, quantity_change, previous_stock, new_stock,
          order_id, request_id, correlation_id, status
        ) VALUES (
          'deduct', ${product_id}, ${-quantity}, ${currentStock}, ${newStock},
          ${order_id}, ${requestId}, ${correlationId}, 'success'
        )
      `;

      console.log(`[${requestId}] Stock deducted: ${currentStock} -> ${newStock}`);
    });

    // Fetch the result after transaction
    const result = await sql`
      SELECT * FROM inventory_operations
      WHERE order_id = ${order_id} AND operation_type = 'deduct'
    `;

    if (result.length === 0) {
      throw new Error('Operation not found after commit');
    }

    const op = result[0];
    return c.json({
      order_id: op.order_id,
      product_id: op.product_id,
      quantity_deducted: Math.abs(op.quantity_change),
      new_stock_level: op.new_stock,
      timestamp: op.created_at,
    });

  } catch (error: any) {
    console.error('Error deducting inventory:', error);
    
    if (error.message === 'Product not found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404);
    }
    
    if (error.message === 'Insufficient stock') {
      return c.json({ error: { code: 'INSUFFICIENT_STOCK', message: 'Insufficient stock' } }, 409);
    }

    // Check if it's a duplicate key error
    if (error.code === '23505' || error.message.includes('unique')) {
      // This is a duplicate - fetch and return existing
      const existing = await sql`
        SELECT * FROM inventory_operations
        WHERE order_id = ${body.order_id} AND operation_type = 'deduct'
      `;
      
      if (existing.length > 0) {
        const op = existing[0];
        return c.json({
          order_id: op.order_id,
          product_id: op.product_id,
          quantity_deducted: Math.abs(op.quantity_change),
          new_stock_level: op.new_stock,
          timestamp: op.created_at,
        });
      }
    }

    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

// POST /internal/inventory/adjust - Manual stock adjustment
app.post('/internal/inventory/adjust', async (c) => {
  try {
    const body = await c.req.json();
    const { product_id, adjustment, reason, notes } = body;

    const requestId = c.req.header('X-Request-ID') || crypto.randomUUID();
    const correlationId = c.req.header('X-Correlation-ID') || crypto.randomUUID();

    if (!product_id || adjustment === undefined || !reason) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } }, 400);
    }

    await sql.begin(async (tx) => {
      const products = await tx`
        SELECT stock_level FROM products WHERE product_id = ${product_id} FOR UPDATE
      `;

      if (products.length === 0) {
        throw new Error('Product not found');
      }

      const previousStock = products[0].stock_level;
      const newStock = previousStock + adjustment;

      if (newStock < 0) {
        throw new Error('Stock cannot be negative');
      }

      await tx`
        UPDATE products SET stock_level = ${newStock}, last_updated = NOW()
        WHERE product_id = ${product_id}
      `;

      await tx`
        INSERT INTO inventory_operations (
          operation_type, product_id, quantity_change, previous_stock, new_stock,
          adjustment_reason, notes, request_id, correlation_id, status
        ) VALUES (
          'adjust', ${product_id}, ${adjustment}, ${previousStock}, ${newStock},
          ${reason}, ${notes || null}, ${requestId}, ${correlationId}, 'success'
        )
      `;
    });

    const products = await sql`SELECT stock_level FROM products WHERE product_id = ${product_id}`;

    return c.json({
      product_id,
      previous_stock: products[0].stock_level - adjustment,
      adjustment,
      new_stock: products[0].stock_level,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error adjusting inventory:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
  }
});

// POST /internal/inventory/products - Add new product
app.post('/internal/inventory/products', async (c) => {
  try {
    const body = await c.req.json();
    const { product_id, name, initial_stock } = body;

    if (!product_id || !name || initial_stock === undefined) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } }, 400);
    }

    await sql`
      INSERT INTO products (product_id, name, stock_level)
      VALUES (${product_id}, ${name}, ${initial_stock})
    `;

    const products = await sql`SELECT * FROM products WHERE product_id = ${product_id}`;

    return c.json({
      product_id: products[0].product_id,
      name: products[0].name,
      stock_level: products[0].stock_level,
      created_at: products[0].created_at,
    }, 201);
  } catch (error: any) {
    console.error('Error creating product:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /internal/inventory/audit - Get audit trail
app.get('/internal/inventory/audit', async (c) => {
  try {
    const productId = c.req.query('product_id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const limit = parseInt(c.req.query('limit') || '100');

    let logs;
    if (productId) {
      logs = await sql`
        SELECT
          operation_id as log_id, product_id, operation_type as operation,
          quantity_change, previous_stock, new_stock, order_id,
          created_at as timestamp, notes
        FROM inventory_operations
        WHERE product_id = ${productId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    } else {
      logs = await sql`
        SELECT
          operation_id as log_id, product_id, operation_type as operation,
          quantity_change, previous_stock, new_stock, order_id,
          created_at as timestamp, notes
        FROM inventory_operations
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
    }

    return c.json({
      audit_logs: logs,
      total: logs.length,
    });
  } catch (error: any) {
    console.error('Error fetching audit:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /health - Health check
app.get('/health', async (c) => {
  try {
    await sql`SELECT 1`;
    
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      latency_mode: gremlinEnabled ? 'gremlin' : 'normal',
      database: 'healthy',
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      latency_mode: gremlinEnabled ? 'gremlin' : 'normal',
      database: 'unhealthy',
    }, 503);
  }
});

// ============================================================================
// GREMLIN CONTROL (for testing)
// ============================================================================

app.post('/internal/gremlin/enable', (c) => {
  gremlinEnabled = true;
  requestCounter = 0;
  return c.json({ message: 'Gremlin latency enabled', pattern: 'Every 3rd request delayed by 5s' });
});

app.post('/internal/gremlin/disable', (c) => {
  gremlinEnabled = false;
  requestCounter = 0;
  return c.json({ message: 'Gremlin latency disabled' });
});

app.get('/internal/gremlin/status', (c) => {
  return c.json({
    enabled: gremlinEnabled,
    request_counter: requestCounter,
    pattern: 'Every 3rd request delayed by 5s',
  });
});

// Start server
const port = parseInt(process.env.PORT || '3001');
console.log(`Inventory Service running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
