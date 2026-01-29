import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import inventory from './routes/inventory';
import deduct from './routes/deduct';
import admin from './routes/admin';
import gremlin from './routes/gremlin';
import health from './routes/health';
import { initMetrics, registerHealthCheck, updateDependencyHealth } from '../../shared/metrics';
import { metricsMiddleware, createMetricsHandler, createSlaStatusHandler } from '../../shared/metrics-middleware';
import { sql } from './db';

// Initialize metrics for this service
initMetrics('inventory-service');

// Register health checks to run on each /metrics scrape
registerHealthCheck(async () => {
  try {
    await sql`SELECT 1`;
    updateDependencyHealth('database', true);
  } catch {
    updateDependencyHealth('database', false);
  }
});

const app = new Hono();

app.use('/*', cors());
app.use('/*', metricsMiddleware);

app.route('/api/inventory', inventory);
app.route('/internal/inventory/deduct', deduct);
app.route('/internal/inventory', admin);
app.route('/internal/gremlin', gremlin);
app.route('/health', health);

// Metrics endpoints
app.get('/metrics', createMetricsHandler());
app.get('/internal/sla-status', createSlaStatusHandler());

// Start server
console.log(`Inventory Service running on port ${config.server.port}`);

export default {
  port: config.server.port,
  fetch: app.fetch,
};
