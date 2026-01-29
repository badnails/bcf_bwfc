import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import orders from './routes/orders';
import stats from './routes/stats';
import health from './routes/health';
import { initMetrics } from '../../shared/metrics';
import { metricsMiddleware, createMetricsHandler, createSlaStatusHandler } from '../../shared/metrics-middleware';

// Initialize metrics for this service
initMetrics('order-service');

const app = new Hono();

// Middleware
app.use('/*', cors());
app.use('/*', metricsMiddleware);

// Routes
app.route('/api/orders', orders);
app.route('/internal/orders/stats', stats);
app.route('/health', health);

// Metrics endpoints
app.get('/metrics', createMetricsHandler());
app.get('/internal/sla-status', createSlaStatusHandler());

// Start server
console.log(`Order Service running on port ${config.server.port}`);

export default {
  port: config.server.port,
  fetch: app.fetch,
};
