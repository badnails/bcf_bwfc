# Valerix E-commerce Microservices

## Architecture

This project implements a microservices architecture for an e-commerce platform with the following services:

- **Order Service** (port 3000) - Handles order placement and management
- **Inventory Service** (port 3001) - Manages product stock and inventory operations
- **Backup Service** (port 3002) - Automated database backups with local caching
- **Mock Backup Service** (port 3003) - Simulates external backup API (1 upload/day limit)
- **PostgreSQL Databases** - Separate databases for each service

## Quick Start

### Prerequisites
- Docker
- Docker Compose

### Running the Services

1. Start all services:
```bash
docker-compose up -d
```

2. Check service health:
```bash
# Order Service
curl http://localhost:3000/health

# Inventory Service
curl http://localhost:3001/health

# Backup Service
curl http://localhost:3002/health

# Mock Backup Service
curl http://localhost:3003/health
```

3. View logs:
```bash
docker-compose logs -f order-service
docker-compose logs -f inventory-service
```

4. Stop all services:
```bash
docker-compose down
```

5. Stop and remove volumes (clears all data):
```bash
docker-compose down -v
```

## API Endpoints

### Order Service (http://localhost:3000)

#### Place an Order
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $(uuidgen)" \
  -H "X-Correlation-ID: $(uuidgen)" \
  -d '{
    "user_id": "user-123",
    "product_id": "PROD-001",
    "quantity": 2
  }'
```

#### Get User Orders
```bash
curl "http://localhost:3000/api/orders?user_id=user-123"
```

#### Get Order Details
```bash
curl http://localhost:3000/api/orders/ORD-xxxxx
```

### Inventory Service (http://localhost:3001)

#### View All Products
```bash
curl http://localhost:3001/api/inventory
```

#### Get Specific Product
```bash
curl http://localhost:3001/api/inventory/PROD-001
```

#### Check Stock Availability
```bash
curl -X POST http://localhost:3001/api/inventory/check \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"product_id": "PROD-001", "quantity": 5}
    ]
  }'
```

## Testing Resilience Features

### 1. Gremlin Latency (Simulates Slow Responses)

Enable gremlin mode to simulate latency on every 3rd request:
```bash
curl -X POST http://localhost:3001/internal/gremlin/enable
```

Check gremlin status:
```bash
curl http://localhost:3001/internal/gremlin/status
```

Disable gremlin mode:
```bash
curl -X POST http://localhost:3001/internal/gremlin/disable
```

### 2. Test Timeout Handling

With gremlin enabled, place multiple orders and observe how Order Service handles timeouts:
```bash
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/orders \
    -H "Content-Type: application/json" \
    -d "{\"user_id\":\"user-test\",\"product_id\":\"PROD-001\",\"quantity\":1}"
  echo ""
done
```

### 3. Test Idempotency (Schrödinger's Warehouse Solution)

Try to place the same order twice using the order_id:
```bash
# First attempt
RESPONSE=$(curl -s -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user-123","product_id":"PROD-002","quantity":3}')

ORDER_ID=$(echo $RESPONSE | grep -o '"order_id":"[^"]*' | cut -d'"' -f4)

# Retry with same order_id (should return cached result)
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"user-123\",\"product_id\":\"PROD-002\",\"quantity\":3,\"idempotency_key\":\"$ORDER_ID\"}"
```

## Database Schema

### Order Service Database (order_db)
- `orders` - All order records with status (confirmed/failed)
- `order_stats` - Aggregated metrics for monitoring

### Inventory Service Database (inventory_db)
- `products` - Product catalog with stock levels
- `inventory_operations` - Audit trail + idempotency tracking

## Key Features

### Idempotency
- Order IDs serve as idempotency keys
- Prevents duplicate inventory deductions (Schrödinger's Warehouse solution)
- UNIQUE constraint on `(order_id, operation_type)` ensures exactly-once semantics

### Request Tracing
- All requests include X-Request-ID and X-Correlation-ID headers
- Compatible with Jaeger/Zipkin distributed tracing
- Enables debugging across service boundaries

### Timeout Handling
- Order Service has 3-second timeout for Inventory Service calls
- Graceful degradation with user-friendly error messages
- Automatic retry support via idempotency

### Health Checks
- All services expose `/health` endpoints
- Dependency checks (database, downstream services)
- Returns degraded status when dependencies fail

### Backup System ("The Need to Leave a Trail Behind")
Solves the challenge of backing up data when external service only allows 1 call/day:

**Strategy: Black Box Pattern**
1. **Every 5 minutes**: Incremental SQL dumps saved to local volume
2. **Daily at 00:00 UTC**: Consolidate dumps into single archive
3. **Single upload**: Send consolidated backup to external service

**Endpoints:**
```bash
# Manual dump
curl -X POST http://localhost:3002/api/backup/trigger-dump

# Manual upload (bypass rate limit for demo)
curl -X POST http://localhost:3002/api/backup/trigger-upload -H "X-Bypass-Rate-Limit: true"

# Check status
curl http://localhost:3002/api/backup/status

# List uploaded backups
curl http://localhost:3003/api/backup/list
```

**Benefits:**
- Multiple local backups without hitting API limit
- Single daily upload respects 1/day restriction
- Data preserved even if external service is down
- Full audit trail of all database changes

## Sample Products

The inventory is pre-populated with:
- PROD-001: Gaming Console - PS5 (100 units)
- PROD-002: Gaming Console - Xbox Series X (75 units)
- PROD-003: Gaming Laptop (50 units)
- PROD-004: Wireless Headset (200 units)
- PROD-005: Mechanical Keyboard (150 units)

## Development

### Rebuild Services
```bash
docker-compose up -d --build
```

### Access Database Directly
```bash
# Order DB
docker exec -it order-db psql -U postgres -d order_db

# Inventory DB
docker exec -it inventory-db psql -U postgres -d inventory_db
```

### View Audit Trail
```bash
curl "http://localhost:3001/internal/inventory/audit?product_id=PROD-001"
```

## Architecture Diagram

```
┌─────────┐
│ Client  │
└────┬────┘
     │
     ├─► Order Service (3000) ──┐
     │         │                 │
     │         └─► Order DB      │
     │                           │
     │                           ├─► Inventory Service (3001)
     │                           │          │
     │                           │          └─► Inventory DB
     └─► Inventory Service ──────┘
             (public endpoints)

     Backup Layer:
     ┌─────────────────────────────────────────────────────┐
     │                                                     │
     │  ┌────────────┐    ┌─────────────────────────────┐  │
     │  │ Order DB   │◄───│                             │  │
     │  └────────────┘    │    Backup Service (3002)    │  │
     │  ┌────────────┐    │    - 5min local dumps       │  │
     │  │Inventory DB│◄───│    - Daily consolidation    │  │
     │  └────────────┘    │    - Upload to external     │  │
     │                    └──────────────┬──────────────┘  │
     │                                   │                 │
     │                    ┌──────────────▼──────────────┐  │
     │                    │ Mock Backup Service (3003)  │  │
     │                    │ (1 upload/day rate limit)   │  │
     │                    └─────────────────────────────┘  │
     └─────────────────────────────────────────────────────┘
```

## Troubleshooting

### Services not starting
```bash
# Check logs
docker-compose logs

# Rebuild from scratch
docker-compose down -v
docker-compose up -d --build
```

### Database connection issues
```bash
# Verify databases are healthy
docker-compose ps

# Check database logs
docker-compose logs order-db
docker-compose logs inventory-db
```

### Reset everything
```bash
docker-compose down -v
docker-compose up -d
```
