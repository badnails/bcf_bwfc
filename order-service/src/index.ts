import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import orders from './routes/orders';
import stats from './routes/stats';
import health from './routes/health';
import events from './routes/events';
import { startUndecidedOrderWorker } from './workers/undecided-resolver';
import { getRedisClient } from './helpers/redis-client';

const app = new Hono();

// Middleware
app.use('/*', cors());

// Routes
app.route('/api/orders', orders);
app.route('/api/orders', events);
app.route('/internal/orders/stats', stats);
app.route('/health', health);

// Initialize Redis and start worker
(async () => {
  try {
    await getRedisClient();
    console.log('✅ Redis connection established');
    
    // Start background worker for undecided order resolution
    startUndecidedOrderWorker().catch((error) => {
      console.error('Worker crashed:', error);
    });
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    console.error('⚠️  Worker will not start - manual retry required for undecided orders');
  }
})();

// Start server
console.log(`Order Service running on port ${config.server.port}`);

export default {
  port: config.server.port,
  fetch: app.fetch,
};
