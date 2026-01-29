import { Hono } from 'hono';
import { sql } from '../db';
import { checkInventoryHealth } from '../helpers/inventory-client';

const health = new Hono();

// GET /health - Health check
health.get('/', async (c) => {
  try {
    // Check database
    await sql`SELECT 1`;
    const dbStatus = 'healthy';

    // Check inventory service
    const inventoryHealthy = await checkInventoryHealth();
    const inventoryStatus = inventoryHealthy ? 'healthy' : 'unhealthy';

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

export default health;
