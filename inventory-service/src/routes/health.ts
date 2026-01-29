import { Hono } from 'hono';
import { sql } from '../db';
import { isGremlinEnabled } from '../helpers/gremlin';

const health = new Hono();

// GET /health - Health check
health.get('/', async (c) => {
  try {
    await sql`SELECT 1`;
    
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      latency_mode: isGremlinEnabled() ? 'gremlin' : 'normal',
      database: 'healthy',
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      latency_mode: isGremlinEnabled() ? 'gremlin' : 'normal',
      database: 'unhealthy',
    }, 503);
  }
});

export default health;
