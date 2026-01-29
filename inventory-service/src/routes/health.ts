import { Hono } from 'hono';
import { sql } from '../db';
import { isGremlinEnabled } from '../helpers/gremlin';
import { updateDependencyHealth } from '../../../shared/metrics';

const health = new Hono();

// GET /health - Health check
health.get('/', async (c) => {
  let dbHealthy = false;
  
  try {
    await sql`SELECT 1`;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }
  
  // Update database health metric
  updateDependencyHealth('database', dbHealthy);
  
  const status = dbHealthy ? 'healthy' : 'unhealthy';
  
  return c.json({
    status,
    timestamp: new Date().toISOString(),
    latency_mode: isGremlinEnabled() ? 'gremlin' : 'normal',
    database: dbHealthy ? 'healthy' : 'unhealthy',
  }, dbHealthy ? 200 : 503);
});

export default health;
