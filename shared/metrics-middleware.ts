/**
 * Metrics Middleware for Hono
 * 
 * Automatically tracks HTTP request metrics:
 * - Request count by method, route, status
 * - Request duration histogram
 * - Active requests gauge
 * - Correlation ID logging
 */

import { Context, Next } from 'hono';
import { 
  recordHttpRequest, 
  incActiveRequests, 
  decActiveRequests,
  getMetrics 
} from './metrics';

export async function metricsMiddleware(c: Context, next: Next): Promise<void> {
  const path = c.req.path;
  
  // Skip metrics tracking for internal/monitoring endpoints
  const skipPaths = ['/metrics', '/health', '/internal/sla-status'];
  if (skipPaths.some(p => path === p || path.startsWith(p))) {
    await next();
    return;
  }

  const start = performance.now();
  
  // Extract trace IDs for logging
  const requestId = c.req.header('X-Request-ID') || 'unknown';
  const correlationId = c.req.header('X-Correlation-ID') || 'unknown';
  
  // Track active requests
  incActiveRequests();
  
  try {
    await next();
  } finally {
    const duration = (performance.now() - start) / 1000; // Convert to seconds
    const route = c.req.routePath || c.req.path;
    const method = c.req.method;
    const statusCode = c.res.status;
    
    // Record metrics
    recordHttpRequest(method, route, statusCode, duration, requestId, correlationId);
    
    // Decrement active requests
    decActiveRequests();
    
    // Structured logging with trace IDs
    const logLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(
      `[${logLevel}] [${requestId}] [${correlationId}] ${method} ${route} ${statusCode} ${(duration * 1000).toFixed(2)}ms`
    );
  }
}

/**
 * Creates a metrics endpoint handler
 */
export function createMetricsHandler() {
  return (c: Context) => {
    const metrics = getMetrics();
    c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return c.text(metrics.toPrometheusFormat());
  };
}

/**
 * Creates an SLA status endpoint (for frontend dashboard)
 */
export function createSlaStatusHandler() {
  return (c: Context) => {
    const metrics = getMetrics();
    const avgResponseTime = metrics.getAverageResponseTime();
    const status = metrics.getResponseTimeStatus();
    
    return c.json({
      status,
      average_response_time_ms: Math.round(avgResponseTime * 100) / 100,
      threshold_ms: 1000,
      window_seconds: 30,
      timestamp: new Date().toISOString(),
    });
  };
}
