import { Hono } from 'hono';
import { isGremlinEnabled, enableGremlin, disableGremlin, getRequestCounter } from '../helpers/gremlin';

const gremlin = new Hono();

// POST /internal/gremlin/enable
gremlin.post('/enable', (c) => {
  enableGremlin();
  return c.json({ message: 'Gremlin latency enabled', pattern: 'Every 3rd request delayed by 5s' });
});

// POST /internal/gremlin/disable
gremlin.post('/disable', (c) => {
  disableGremlin();
  return c.json({ message: 'Gremlin latency disabled' });
});

// GET /internal/gremlin/status
gremlin.get('/status', (c) => {
  return c.json({
    enabled: isGremlinEnabled(),
    request_counter: getRequestCounter(),
    pattern: 'Every 3rd request delayed by 5s',
  });
});

export default gremlin;
