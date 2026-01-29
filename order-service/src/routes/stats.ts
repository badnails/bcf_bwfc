import { Hono } from 'hono';
import { sql } from '../db';

const stats = new Hono();

// GET /internal/orders/stats - Get order statistics
stats.get('/', async (c) => {
  try {
    const from = c.req.query('from');
    const to = c.req.query('to');
    const source = c.req.query('source') || 'orders'; // 'orders' or 'aggregated'

    // If using aggregated stats from order_stats table
    if (source === 'aggregated') {
      let aggStats;
      if (from && to) {
        aggStats = await sql`
          SELECT
            COALESCE(SUM(total_orders), 0) as total_orders,
            COALESCE(SUM(confirmed_orders), 0) as confirmed_orders,
            COALESCE(SUM(failed_orders), 0) as failed_orders,
            COALESCE(SUM(timeout_errors), 0) as timeout_errors,
            COALESCE(AVG(avg_response_time_ms), 0) as avg_response_time_ms
          FROM order_stats
          WHERE minute_bucket BETWEEN ${from} AND ${to}
        `;
      } else {
        aggStats = await sql`
          SELECT
            COALESCE(SUM(total_orders), 0) as total_orders,
            COALESCE(SUM(confirmed_orders), 0) as confirmed_orders,
            COALESCE(SUM(failed_orders), 0) as failed_orders,
            COALESCE(SUM(timeout_errors), 0) as timeout_errors,
            COALESCE(AVG(avg_response_time_ms), 0) as avg_response_time_ms
          FROM order_stats
        `;
      }

      return c.json({
        source: 'aggregated',
        total_orders: parseInt(aggStats[0].total_orders || '0'),
        confirmed_orders: parseInt(aggStats[0].confirmed_orders || '0'),
        failed_orders: parseInt(aggStats[0].failed_orders || '0'),
        timeout_errors: parseInt(aggStats[0].timeout_errors || '0'),
        average_processing_time_ms: parseInt(aggStats[0].avg_response_time_ms || '0'),
      });
    }

    // Default: Query from orders table directly
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
      source: 'orders',
      total_orders: parseInt(statsResult[0].total_orders),
      confirmed_orders: parseInt(statsResult[0].confirmed_orders || '0'),
      failed_orders: parseInt(statsResult[0].failed_orders || '0'),
      pending_orders: 0,
      average_processing_time_ms: 0,
    });
  } catch (error: any) {
    console.error('Error fetching stats:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

// GET /internal/orders/stats/timeline - Get stats grouped by minute
stats.get('/timeline', async (c) => {
  try {
    const minutes = parseInt(c.req.query('minutes') || '60');
    
    const timeline = await sql`
      SELECT
        minute_bucket,
        total_orders,
        confirmed_orders,
        failed_orders,
        timeout_errors,
        avg_response_time_ms
      FROM order_stats
      WHERE minute_bucket >= CURRENT_TIMESTAMP - INTERVAL '1 minute' * ${minutes}
      ORDER BY minute_bucket DESC
    `;

    return c.json({
      minutes_requested: minutes,
      data_points: timeline.length,
      timeline,
    });
  } catch (error: any) {
    console.error('Error fetching stats timeline:', error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
  }
});

export default stats;
