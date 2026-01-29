import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import orders from './routes/orders';
import stats from './routes/stats';
import health from './routes/health';

const app = new Hono();

// Middleware
app.use('/*', cors());

// Routes
app.route('/api/orders', orders);
app.route('/internal/orders/stats', stats);
app.route('/health', health);

// Start server
console.log(`Order Service running on port ${config.server.port}`);

export default {
  port: config.server.port,
  fetch: app.fetch,
};
