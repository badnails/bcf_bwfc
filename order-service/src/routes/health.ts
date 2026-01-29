import { Hono } from 'hono';
import { sql } from '../db';
import { checkInventoryHealth } from '../helpers/inventory-client';
import { updateDependencyHealth } from '../../../shared/metrics';

const health = new Hono();

// GET /health - Health check
health.get('/', async (c) => {
  let dbHealthy = false;
  let inventoryHealthy = false;
  
  try {
    // Check database
    await sql`SELECT 1`;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }
  
  // Update database health metric
  updateDependencyHealth('database', dbHealthy);
  
  // Check inventory service
  try {
    inventoryHealthy = await checkInventoryHealth();
  } catch {
    inventoryHealthy = false;
  }
  
  // Update inventory service health metric
  updateDependencyHealth('inventory_service', inventoryHealthy);
  
  const dbStatus = dbHealthy ? 'healthy' : 'unhealthy';
  const inventoryStatus = inventoryHealthy ? 'healthy' : 'unhealthy';
  const overallStatus = dbHealthy && inventoryHealthy ? 'healthy' : dbHealthy ? 'degraded' : 'unhealthy';

  const response = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    dependencies: {
      inventory_service: inventoryStatus,
      database: dbStatus,
    },
  };

  return c.json(response, overallStatus === 'unhealthy' ? 503 : 200);
});

export default health;
