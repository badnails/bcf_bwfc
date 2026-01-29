/**
 * Shared Metrics Module for Valerix Microservices
 * 
 * Provides Prometheus-compatible metrics for monitoring:
 * - HTTP request counts and durations
 * - Order statistics (confirmed, failed, timeouts)
 * - Response time tracking for SLA monitoring
 * - Correlation ID tracking for distributed tracing
 */

// In-memory metrics storage (Prometheus text format)
interface MetricValue {
  labels: Record<string, string>;
  value: number;
  timestamp?: number;
}

interface HistogramValue {
  labels: Record<string, string>;
  buckets: Record<number, number>;
  sum: number;
  count: number;
}

class MetricsRegistry {
  private counters: Map<string, MetricValue[]> = new Map();
  private gauges: Map<string, MetricValue[]> = new Map();
  private histograms: Map<string, HistogramValue[]> = new Map();
  
  // Rolling window for response times (last 30 seconds)
  private responseTimes: { timestamp: number; duration: number; route: string }[] = [];
  private readonly ROLLING_WINDOW_MS = 30000;

  // Standard histogram buckets for HTTP request duration (in seconds)
  private readonly DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  constructor(private serviceName: string) {}

  // ============================================================================
  // Counter Operations
  // ============================================================================

  incCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const existing = this.findMetric(this.counters, name, labels);
    if (existing) {
      existing.value += value;
    } else {
      if (!this.counters.has(name)) {
        this.counters.set(name, []);
      }
      this.counters.get(name)!.push({ labels, value });
    }
  }

  // ============================================================================
  // Gauge Operations
  // ============================================================================

  setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
    const existing = this.findMetric(this.gauges, name, labels);
    if (existing) {
      existing.value = value;
    } else {
      if (!this.gauges.has(name)) {
        this.gauges.set(name, []);
      }
      this.gauges.get(name)!.push({ labels, value });
    }
  }

  incGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const existing = this.findMetric(this.gauges, name, labels);
    if (existing) {
      existing.value += value;
    } else {
      this.setGauge(name, labels, value);
    }
  }

  decGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    this.incGauge(name, labels, -value);
  }

  // ============================================================================
  // Histogram Operations
  // ============================================================================

  observeHistogram(name: string, labels: Record<string, string> = {}, value: number): void {
    let histogram = this.findHistogram(name, labels);
    
    if (!histogram) {
      if (!this.histograms.has(name)) {
        this.histograms.set(name, []);
      }
      histogram = {
        labels,
        buckets: {},
        sum: 0,
        count: 0,
      };
      // Initialize buckets
      for (const bucket of this.DURATION_BUCKETS) {
        histogram.buckets[bucket] = 0;
      }
      histogram.buckets[Infinity] = 0;
      this.histograms.get(name)!.push(histogram);
    }

    // Update buckets
    for (const bucket of this.DURATION_BUCKETS) {
      if (value <= bucket) {
        histogram.buckets[bucket]++;
      }
    }
    histogram.buckets[Infinity]++;
    histogram.sum += value;
    histogram.count++;
  }

  // ============================================================================
  // Rolling Window Response Time Tracking
  // ============================================================================

  recordResponseTime(route: string, durationMs: number): void {
    const now = Date.now();
    
    // Add new entry
    this.responseTimes.push({
      timestamp: now,
      duration: durationMs,
      route,
    });

    // Clean up old entries outside the rolling window
    this.responseTimes = this.responseTimes.filter(
      (entry) => now - entry.timestamp <= this.ROLLING_WINDOW_MS
    );
  }

  getAverageResponseTime(route?: string): number {
    const now = Date.now();
    const validEntries = this.responseTimes.filter(
      (entry) =>
        now - entry.timestamp <= this.ROLLING_WINDOW_MS &&
        (!route || entry.route === route)
    );

    if (validEntries.length === 0) return 0;

    const sum = validEntries.reduce((acc, entry) => acc + entry.duration, 0);
    return sum / validEntries.length;
  }

  getResponseTimeStatus(): 'green' | 'red' {
    const avgMs = this.getAverageResponseTime();
    return avgMs > 1000 ? 'red' : 'green';
  }

  // ============================================================================
  // Prometheus Format Export
  // ============================================================================

  toPrometheusFormat(): string {
    const lines: string[] = [];
    const service = this.serviceName;

    // Counters
    for (const [name, metrics] of this.counters) {
      lines.push(`# HELP ${name} Counter metric`);
      lines.push(`# TYPE ${name} counter`);
      for (const metric of metrics) {
        const labelStr = this.formatLabels({ ...metric.labels, service });
        lines.push(`${name}${labelStr} ${metric.value}`);
      }
    }

    // Gauges
    for (const [name, metrics] of this.gauges) {
      lines.push(`# HELP ${name} Gauge metric`);
      lines.push(`# TYPE ${name} gauge`);
      for (const metric of metrics) {
        const labelStr = this.formatLabels({ ...metric.labels, service });
        lines.push(`${name}${labelStr} ${metric.value}`);
      }
    }

    // Histograms
    for (const [name, histograms] of this.histograms) {
      lines.push(`# HELP ${name} Histogram metric`);
      lines.push(`# TYPE ${name} histogram`);
      for (const histogram of histograms) {
        const baseLabels = { ...histogram.labels, service };
        
        // Buckets
        let cumulative = 0;
        for (const bucket of this.DURATION_BUCKETS) {
          cumulative += histogram.buckets[bucket] || 0;
          const labelStr = this.formatLabels({ ...baseLabels, le: bucket.toString() });
          lines.push(`${name}_bucket${labelStr} ${cumulative}`);
        }
        // +Inf bucket
        const infLabelStr = this.formatLabels({ ...baseLabels, le: '+Inf' });
        lines.push(`${name}_bucket${infLabelStr} ${histogram.count}`);
        
        // Sum and count
        const sumLabelStr = this.formatLabels(baseLabels);
        lines.push(`${name}_sum${sumLabelStr} ${histogram.sum}`);
        lines.push(`${name}_count${sumLabelStr} ${histogram.count}`);
      }
    }

    // Add rolling window average response time gauge
    lines.push(`# HELP http_response_time_avg_30s Average response time over 30 second rolling window (ms)`);
    lines.push(`# TYPE http_response_time_avg_30s gauge`);
    lines.push(`http_response_time_avg_30s{service="${service}"} ${this.getAverageResponseTime()}`);

    // Add SLA status gauge (1 = green, 0 = red)
    lines.push(`# HELP sla_status_ok SLA status (1 = within SLA, 0 = SLA breach)`);
    lines.push(`# TYPE sla_status_ok gauge`);
    lines.push(`sla_status_ok{service="${service}"} ${this.getResponseTimeStatus() === 'green' ? 1 : 0}`);

    // Add dependency health gauges
    lines.push(`# HELP service_dependency_health Health status of service dependencies (1 = healthy, 0 = unhealthy)`);
    lines.push(`# TYPE service_dependency_health gauge`);
    for (const [name, metrics] of this.gauges) {
      if (name === 'service_dependency_health') {
        for (const metric of metrics) {
          const labelStr = this.formatLabels({ ...metric.labels, service });
          lines.push(`${name}${labelStr} ${metric.value}`);
        }
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private findMetric(map: Map<string, MetricValue[]>, name: string, labels: Record<string, string>): MetricValue | undefined {
    const metrics = map.get(name);
    if (!metrics) return undefined;
    return metrics.find((m) => this.labelsMatch(m.labels, labels));
  }

  private findHistogram(name: string, labels: Record<string, string>): HistogramValue | undefined {
    const histograms = this.histograms.get(name);
    if (!histograms) return undefined;
    return histograms.find((h) => this.labelsMatch(h.labels, labels));
  }

  private labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key, i) => key === keysB[i] && a[key] === b[key]);
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
  }
}

// ============================================================================
// Singleton Instances
// ============================================================================

let metricsInstance: MetricsRegistry | null = null;

// Health check functions registry
type HealthCheckFn = () => Promise<void>;
const healthChecks: HealthCheckFn[] = [];

/**
 * Register a health check function that runs before each /metrics scrape
 * The function should call updateDependencyHealth() for each dependency it checks
 */
export function registerHealthCheck(fn: HealthCheckFn): void {
  healthChecks.push(fn);
}

/**
 * Run all registered health checks (called before each metrics scrape)
 */
export async function runHealthChecks(): Promise<void> {
  await Promise.all(healthChecks.map(fn => fn().catch(() => {})));
}

export function initMetrics(serviceName: string): MetricsRegistry {
  metricsInstance = new MetricsRegistry(serviceName);
  return metricsInstance;
}

export function getMetrics(): MetricsRegistry {
  if (!metricsInstance) {
    throw new Error('Metrics not initialized. Call initMetrics() first.');
  }
  return metricsInstance;
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
  requestId?: string,
  correlationId?: string
): void {
  const metrics = getMetrics();
  const labels = { method, route, status_code: statusCode.toString() };
  
  // Increment request counter
  metrics.incCounter('http_requests_total', labels);
  
  // Record duration histogram
  metrics.observeHistogram('http_request_duration_seconds', { method, route }, durationSeconds);
  
  // Record in rolling window (in ms)
  metrics.recordResponseTime(route, durationSeconds * 1000);

  // Track timeout errors specifically
  if (statusCode === 503) {
    metrics.incCounter('http_timeout_errors_total', { method, route });
  }
}

export function recordOrderResult(status: 'confirmed' | 'failed', isTimeout: boolean = false): void {
  const metrics = getMetrics();
  metrics.incCounter('orders_total', { status });
  
  if (isTimeout) {
    metrics.incCounter('orders_timeout_total', {});
  }
}

export function setActiveRequests(count: number): void {
  const metrics = getMetrics();
  metrics.setGauge('http_requests_in_flight', {}, count);
}

export function incActiveRequests(): void {
  const metrics = getMetrics();
  metrics.incGauge('http_requests_in_flight', {});
}

export function decActiveRequests(): void {
  const metrics = getMetrics();
  metrics.decGauge('http_requests_in_flight', {});
}

/**
 * Update dependency health status for monitoring
 * @param dependency - Name of the dependency (e.g., 'database', 'inventory_service')
 * @param isHealthy - Whether the dependency is healthy
 */
export function updateDependencyHealth(dependency: string, isHealthy: boolean): void {
  const metrics = getMetrics();
  metrics.setGauge('service_dependency_health', { dependency }, isHealthy ? 1 : 0);
}

export { MetricsRegistry };
