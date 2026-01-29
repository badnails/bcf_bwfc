import { Context, Next } from 'hono';
import { shouldDelayRequest, getRequestCounter } from '../helpers/gremlin';

export async function gremlinLatencyMiddleware(c: Context, next: Next) {
  if (shouldDelayRequest()) {
    console.log(`[GREMLIN] Delaying request #${getRequestCounter()} by 5 seconds`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  await next();
}
