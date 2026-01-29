import { Hono } from 'hono';
import { sql } from '../db';

const inventory = new Hono();

// GET /api/inventory - Get all products
inventory.get('/', async (c) => {
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
inventory.get('/:product_id', async (c) => {
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
inventory.post('/check', async (c) => {
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

export default inventory;
