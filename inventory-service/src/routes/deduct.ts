import { Hono } from 'hono';
import { sql } from '../db';
import { shouldDelayRequest, getRequestCounter } from '../helpers/gremlin';

const deduct = new Hono();

// POST /internal/inventory/deduct - Deduct inventory (idempotent)
deduct.post('/', async (c) => {
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
    
    // Apply gremlin delay AFTER database commit but BEFORE response
    // This simulates network delay without affecting data integrity
    if (shouldDelayRequest()) {
      const counter = getRequestCounter();
      console.log(`[GREMLIN] Delaying response for request #${counter} by 5 seconds (DB already committed)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
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

export default deduct;
