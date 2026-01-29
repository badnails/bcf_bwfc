import { Hono } from 'hono';
import { sql } from '../db';

const stats = new Hono();

// GET /internal/orders/stats - Get order statistics
stats.get('/', async (c) => {
  try {
    const from = c.req.query('from');
    const to = c.req.query('to');

    let statsResult;
    if (from && to) {
      statsResult = await sql`
        SELECT
          COUNT(*) as total_orders,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_orders,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_orders
        FROM orders
        WHERE created_at BETWEEN ${from} AND ${to}
      `;
    } else {
      statsResult = await sql`
        SELECT
          COUNT(*) as total_orders,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_orders,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_orders
        FROM orders
      `;
    }

    return c.json({
      total_orders: parseInt(statsResult[0].total_orders),
      confirmed_orders: parseInt(statsResult[0].confirmed_orders),
      failed_orders: parseInt(statsResult[0].failed_orders),
      pending_orders: 0,
      average_processing_time_ms: 0,
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

export default stats;
