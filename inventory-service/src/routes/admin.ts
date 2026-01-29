import { Hono } from 'hono';
import { sql } from '../db';

const admin = new Hono();

// POST /internal/inventory/adjust - Manual stock adjustment
admin.post('/adjust', async (c) => {
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
admin.post('/products', async (c) => {
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
admin.get('/audit', async (c) => {
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

export default admin;
