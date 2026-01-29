# Valerix Monitoring Documentation

## Overview

The Valerix e-commerce platform implements comprehensive monitoring using the **Prometheus + Grafana + Alertmanager** stack. This enables real-time observability of service health, performance metrics, and SLA compliance.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Order Service  │     │Inventory Service│
│   :3000         │     │   :3001         │
│   /metrics      │     │   /metrics      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │  Prometheus │
              │    :9292    │
              └──────┬──────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
   ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
   │  Grafana  │ │Alerts │ │Alertmanager│
   │   :3030   │ │ Rules │ │   :9294    │
   └───────────┘ └───────┘ └───────────┘
```

## Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana Dashboard | http://localhost:3030 | admin / admin |
| Prometheus | http://localhost:9292 | - |
| Alertmanager | http://localhost:9294 | - |
| Order Service Metrics | http://localhost:3000/metrics | - |
| Inventory Service Metrics | http://localhost:3001/metrics | - |
| SLA Status API | http://localhost:3000/internal/sla-status | - |

## Metrics Exposed

### HTTP Metrics (Both Services)

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total HTTP requests by method, route, status_code |
| `http_requests_in_flight` | Gauge | Currently active requests |
| `http_request_duration_seconds` | Histogram | Request duration distribution |
| `http_response_time_avg_30s` | Gauge | Rolling 30-second average response time (ms) |
| `http_timeout_errors_total` | Counter | Total 503 timeout errors |

### Order Metrics (Order Service Only)

| Metric | Type | Description |
|--------|------|-------------|
| `orders_total` | Counter | Total orders by status (confirmed/failed) |
| `orders_timeout_total` | Counter | Orders failed due to inventory timeout |

### SLA Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `sla_status_ok` | Gauge | SLA status: 1 = OK (green), 0 = BREACH (red) |

## SLA Monitoring

### The Requirement

> "If the average response time of the Order Service exceeds 1 second over a rolling 30 second window, a component on your dashboard must change from green to red."

### Implementation

The `sla_status_ok` metric is calculated in real-time:

```
sla_status_ok = 1  → 🟢 GREEN (avg response time ≤ 1000ms)
sla_status_ok = 0  → 🔴 RED   (avg response time > 1000ms)
```

### SLA Status API

```bash
GET http://localhost:3000/internal/sla-status
```

Response:
```json
{
  "status": "green",
  "average_response_time_ms": 234.56,
  "threshold_ms": 1000,
  "window_seconds": 30,
  "timestamp": "2026-01-29T09:52:51.999Z"
}
```

### Testing SLA Breach

1. **Enable Gremlin Latency** (adds 2-5 second delays to inventory service):
   ```bash
   curl -X POST http://localhost:3001/internal/gremlin/enable
   ```

2. **Place several orders** (they will be slow):
   ```bash
   curl -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -d '{"product_id":"PROD-001","quantity":1}'
   ```

3. **Check SLA status**:
   ```bash
   curl http://localhost:3000/internal/sla-status
   # Should show "status": "red" when avg > 1000ms
   ```

4. **Disable Gremlin** to return to normal:
   ```bash
   curl -X POST http://localhost:3001/internal/gremlin/disable
   ```

## Grafana Dashboard

The Valerix Dashboard includes the following panels:

### Row 1: SLA Status
| Panel | Description |
|-------|-------------|
| **Order Service SLA Status** | 🟢/🔴 indicator based on `sla_status_ok` metric |
| **Avg Response Time (30s Window)** | Gauge showing current rolling average with 1000ms threshold |
| **Response Time Trend** | Time series graph with red threshold line at 1000ms |

### Row 2: Service Health
| Panel | Description |
|-------|-------------|
| **Order Service** | UP/DOWN status |
| **Inventory Service** | UP/DOWN status |
| **Active Requests (Order)** | Current in-flight requests |
| **Active Requests (Inventory)** | Current in-flight requests |

### Row 3: HTTP Metrics
| Panel | Description |
|-------|-------------|
| **Request Rate by Route** | Requests per second by endpoint |
| **Response Status Codes** | Distribution of 2xx/4xx/5xx responses |

### Row 4: Order Metrics
| Panel | Description |
|-------|-------------|
| **Total Confirmed Orders** | Count of successful orders |
| **Total Failed Orders** | Count of failed orders |
| **Total Timeout Errors** | Orders failed due to timeout |
| **HTTP 503 Errors** | Service unavailable errors |
| **Order Rate by Status** | Orders over time by confirmed/failed |

## Alert Rules

Alerts are defined in `monitoring/prometheus/alerts.yml`:

### Critical Alerts

| Alert | Condition | Description |
|-------|-----------|-------------|
| `OrderServiceSLABreach` | avg response > 1000ms for 30s | SLA violation |
| `OrderServiceDown` | service unreachable for 30s | Order service is down |
| `InventoryServiceDown` | service unreachable for 30s | Inventory service is down |

### Warning Alerts

| Alert | Condition | Description |
|-------|-----------|-------------|
| `HighErrorRate` | error rate > 10% for 5m | Elevated error rate |
| `HighLatencyP95` | P95 latency > 2s for 5m | Slow response times |
| `HighTimeoutRate` | timeout rate > 5% for 5m | Too many timeouts |

## Health Endpoints

Both services implement health checks that verify downstream dependencies:

### Order Service Health
```bash
GET http://localhost:3000/health
```
```json
{
  "status": "healthy",
  "timestamp": "2026-01-29T09:52:51.999Z",
  "dependencies": {
    "inventory_service": "healthy",
    "database": "healthy"
  }
}
```

### Inventory Service Health
```bash
GET http://localhost:3001/health
```
```json
{
  "status": "healthy",
  "timestamp": "2026-01-29T09:52:51.999Z",
  "latency_mode": "normal",
  "database": "healthy"
}
```

## Configuration Files

| File | Purpose |
|------|---------|
| `monitoring/prometheus/prometheus.yml` | Prometheus scrape configuration |
| `monitoring/prometheus/alerts.yml` | Alert rules |
| `monitoring/grafana/provisioning/dashboards/json/valerix-dashboard.json` | Grafana dashboard |
| `monitoring/grafana/provisioning/datasources/datasources.yml` | Prometheus datasource |
| `monitoring/alertmanager/alertmanager.yml` | Alert routing and notifications |
| `shared/metrics.ts` | Metrics registry implementation |
| `shared/metrics-middleware.ts` | Hono middleware for automatic metrics |

## Prometheus Scrape Configuration

```yaml
scrape_configs:
  - job_name: 'order-service'
    static_configs:
      - targets: ['order-service:3000']
    metrics_path: '/metrics'
    scrape_interval: 5s

  - job_name: 'inventory-service'
    static_configs:
      - targets: ['inventory-service:3001']
    metrics_path: '/metrics'
    scrape_interval: 5s
```

The 5-second scrape interval ensures accurate 30-second rolling window calculations.

## Shared Metrics Module

The `shared/metrics.ts` module provides:

- **MetricsRegistry**: In-memory storage for counters, gauges, and histograms
- **Rolling Window**: Tracks response times over 30-second window
- **Prometheus Export**: Formats metrics in Prometheus text format

### Key Functions

```typescript
// Initialize metrics for a service
initMetrics('order-service');

// Record HTTP request metrics
recordHttpRequest(method, route, statusCode, durationSeconds);

// Record order outcomes
recordOrderResult('confirmed', false);  // confirmed order
recordOrderResult('failed', true);      // failed due to timeout

// Get metrics in Prometheus format
getMetrics().toPrometheusFormat();
```

## Docker Compose Services

```yaml
prometheus:
  image: prom/prometheus:v2.48.0
  ports:
    - "9292:9090"

grafana:
  image: grafana/grafana:10.2.0
  ports:
    - "3030:3000"

alertmanager:
  image: prom/alertmanager:v0.26.0
  ports:
    - "9294:9093"
```

## Troubleshooting

### No Data in Grafana

1. Check if services are exposing metrics:
   ```bash
   curl http://localhost:3000/metrics
   curl http://localhost:3001/metrics
   ```

2. Check Prometheus targets:
   - Go to http://localhost:9292/targets
   - Ensure both services show "UP"

3. Verify Grafana datasource:
   - Go to Grafana → Settings → Data Sources
   - Test the Prometheus connection

### SLA Status Always Green

- Ensure requests are being made to `/api/orders` (not just `/health` or `/metrics`)
- The `/metrics`, `/health`, and `/internal/*` endpoints are excluded from SLA tracking
- Check if the 30-second window has expired (metrics reset after 30s of no requests)

### Metrics Not Updating

- Prometheus scrapes every 5 seconds
- Wait at least 10 seconds after making requests
- Check Prometheus logs: `docker logs prometheus`

## Quick Commands

```bash
# Start all services including monitoring
docker-compose up -d

# Restart only Grafana (after dashboard changes)
docker-compose restart grafana

# View Prometheus targets
open http://localhost:9292/targets

# View Grafana dashboard
open http://localhost:3030

# Check SLA status
curl http://localhost:3000/internal/sla-status

# Enable gremlin latency
curl -X POST http://localhost:3001/internal/gremlin/enable

# Disable gremlin latency
curl -X POST http://localhost:3001/internal/gremlin/disable

# Check current gremlin status
curl http://localhost:3001/internal/gremlin/status
```
