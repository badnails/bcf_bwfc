# API Endpoints - Valerix E-commerce Platform

## Order Service

### Client-Facing Endpoints (Public API)

#### **POST /api/orders**
Place a new order. Immediately deducts inventory upon confirmation.
- **Request Body:**
  ```json
  {
    "product_id": "string",
    "quantity": number,
    "idempotency_key": "string|null"
  }
  ```
  - `idempotency_key` (optional): Order ID from a previous failed attempt. If provided, attempts to retrieve/retry that order instead of creating a new one.
- **Response (200 OK) - Order Confirmed:**
  ```json
  {
    "order_id": "string",
    "status": "confirmed",
    "product_id": "string",
    "quantity": number,
    "message": "Order placed and fulfilled",
    "timestamp": "ISO-8601"
  }
  ```
- **Response (200 OK) - Order Failed:**
  ```json
  {
    "order_id": "string",
    "status": "failed",
    "product_id": "string",
    "quantity": number,
    "message": "Insufficient inventory",
    "timestamp": "ISO-8601"
  }
  ```
- **Error Responses:**
  - `400 Bad Request` - Invalid input
  - `503 Service Unavailable` - Inventory service timeout (client should retry with returned `order_id` as `idempotency_key`)
  - `500 Internal Server Error` - Server error (client should retry with returned `order_id` as `idempotency_key`)

#### **GET /api/orders**
Get all order history
- **Query Parameters:**
  - `status` (optional): confirmed|failed|all (default: all)
  - `limit` (optional): number (default: 50)
  - `offset` (optional): number (default: 0)
- **Response (200 OK):**
  ```json
  {
    "orders": [
      {
        "order_id": "string",
        "product_id": "string",
        "quantity": number,
        "status": "confirmed|failed",
        "placed_at": "ISO-8601",
        "error_message": "string|null"
      }
    ],
    "total": number,
    "limit": number,
    "offset": number
  }
  ```

#### **GET /api/orders/{order_id}**
Get specific order details
- **Response (200 OK):**
  ```json
  {
    "order_id": "string",
    "user_id": "string",
    "product_id": "string",
    "quantity": number,
    "status": "confirmed|failed",
    "placed_at": "ISO-8601",
    "error_message": "string|null"
  }
  ```
- **Error Responses:**
  - `404 Not Found` - Order not found

### Service-to-Service Endpoints (Internal)

#### **POST /internal/inventory/deduct**
Deduct inventory when order is placed (immediate fulfillment). Idempotent operation.
- **Request Body:**
  ```json
  {
    "order_id": "string",
    "product_id": "string",
    "quantity": number
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "order_id": "string",
    "product_id": "string",
    "quantity_deducted": number,
    "new_stock_level": number,
    "timestamp": "ISO-8601"
  }
  ```
- **Error Responses:**
  - `409 Conflict` - Insufficient stock OR order_id already processed (idempotency)
  - `400 Bad Request` - Invalid input
  - `404 Not Found` - Product not found

### Administrative/Management Endpoints

#### **GET /internal/orders/stats**
Get order statistics for monitoring
- **Query Parameters:**
  - `from` (optional): ISO-8601 timestamp
  - `to` (optional): ISO-8601 timestamp
- **Response (200 OK):**
  ```json
  {
    "total_orders": number,
    "confirmed_orders": number,
    "failed_orders": number,
    "pending_orders": number,
    "average_processing_time_ms": number
  }
  ```

#### **GET /health**
Health check endpoint
- **Response (200 OK):**
  ```json
  {
    "status": "healthy|degraded|unhealthy",
    "timestamp": "ISO-8601",
    "dependencies": {
      "inventory_service": "healthy|degraded|unhealthy",
      "database": "healthy|unhealthy"
    }
  }
  ```

---

## Inventory Service

### Client-Facing Endpoints (Public API)

#### **GET /api/inventory**
Get all products with stock levels
- **Query Parameters:**
  - `in_stock_only` (optional): boolean (default: false)
  - `limit` (optional): number (default: 100)
  - `offset` (optional): number (default: 0)
- **Response (200 OK):**
  ```json
  {
    "products": [
      {
        "product_id": "string",
        "name": "string",
        "stock_level": number,
        "reserved_stock": number,
        "available_stock": number,
        "last_updated": "ISO-8601"
      }
    ],
    "total": number,
    "limit": number,
    "offset": number
  }
  ```

#### **GET /api/inventory/{product_id}**
Get specific product stock information
- **Response (200 OK):**
  ```json
  {
    "product_id": "string",
    "name": "string",
    "stock_level": number,
    "reserved_stock": number,
    "available_stock": number,
    "last_updated": "ISO-8601"
  }
  ```
- **Error Responses:**
  - `404 Not Found` - Product not found

#### **POST /api/inventory/check**
Check stock availability for multiple products
- **Request Body:**
  ```json
  {
    "items": [
      {
        "product_id": "string",
        "quantity": number
      }
    ]
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "available": boolean,
    "items": [
      {
        "product_id": "string",
        "requested_quantity": number,
        "available_quantity": number,
        "in_stock": boolean
      }
    ]
  }
  ```

### Service-to-Service Endpoints (Internal)

### Service-to-Service Endpoints (Internal)

#### **POST /internal/inventory/deduct**
Deduct inventory when order is placed (immediate fulfillment). Idempotent operation.
- **Request Body:**
  ```json
  {
    "order_id": "string",
    "product_id": "string",
    "quantity": number
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "order_id": "string",
    "product_id": "string",
    "quantity_deducted": number,
    "new_stock_level": number,
    "timestamp": "ISO-8601"
  }
  ```
- **Error Responses:**
  - `409 Conflict` - Insufficient stock OR order_id already processed (idempotency)
  - `400 Bad Request` - Invalid input
  - `404 Not Found` - Product not found

### Administrative/Management Endpoints

#### **POST /internal/inventory/adjust**
Manual stock adjustment (restocking, corrections)
- **Request Body:**
  ```json
  {
    "product_id": "string",
    "adjustment": number,
    "reason": "restock|correction|damage",
    "notes": "string"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "product_id": "string",
    "previous_stock": number,
    "adjustment": number,
    "new_stock": number,
    "timestamp": "ISO-8601"
  }
  ```

#### **POST /internal/inventory/products**
Add new product to inventory
- **Request Body:**
  ```json
  {
    "product_id": "string",
    "name": "string",
    "initial_stock": number
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "product_id": "string",
    "name": "string",
    "stock_level": number,
    "created_at": "ISO-8601"
  }
  ```

#### **GET /internal/inventory/audit**
Get audit trail for stock changes
- **Query Parameters:**
  - `product_id` (optional): string
  - `from` (optional): ISO-8601 timestamp
  - `to` (optional): ISO-8601 timestamp
  - `limit` (optional): number (default: 100)
- **Response (200 OK):**
  ```json
  {
    "audit_logs": [
      {
        "log_id": "string",
        "product_id": "string",
        "operation": "deduct|adjust",
        "quantity_change": number,
        "previous_stock": number,
        "new_stock": number,
        "order_id": "string|null",
        "timestamp": "ISO-8601",
        "notes": "string|null"
      }
    ],
    "total": number
  }
  ```

#### **GET /health**
Health check endpoint (with gremlin latency simulation)
- **Response (200 OK):**
  ```json
  {
    "status": "healthy|degraded|unhealthy",
    "timestamp": "ISO-8601",
    "latency_mode": "normal|gremlin",
    "database": "healthy|unhealthy"
  }
  ```

---

## Auth Service (Minimal - Not in Focus)

#### **POST /api/auth/login**
User authentication
- **Request Body:**
  ```json
  {
    "username": "string",
    "password": "string"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "token": "jwt-token",
    "user_id": "string",
    "expires_at": "ISO-8601"
  }
  ```

#### **POST /api/auth/validate**
Validate token (internal use)
- **Request Headers:**
  - `Authorization: Bearer {token}`
- **Response (200 OK):**
  ```json
  {
    "valid": boolean,
    "user_id": "string"
  }
  ```

---

## Idempotency Strategy

### Mechanism: Order ID as Idempotency Key

When a client encounters an error (timeout or internal server error) during order placement:

1. **Initial Request Fails:**
   - Order is created in database with `status: "pending"`
   - Order ID is returned to client even on failure
   - Client never receives this response due to network/timeout

2. **Retry with Order ID:**
   - Client retries `POST /api/orders` with `idempotency_key: "{order_id}"`
   - Order Service checks if order_id already exists
   - If exists: returns cached result of previous attempt
   - If not: creates new order (previous attempt truly failed at DB level)

3. **Inventory Service Idempotency:**
   - `POST /internal/inventory/deduct` is keyed by `order_id`
   - Multiple deduct calls with same `order_id` return the original result
   - Prevents "Schrödinger's Warehouse": inventory updates are atomic per order

### Example Flow - Timeout Case

```
Attempt 1:
Client → POST /api/orders 
  {"user_id": "u1", "product_id": "p1", "quantity": 2, "idempotency_key": null}
Server creates order_id = "ORD-12345", returns in response but connection times out
Client receives nothing

Attempt 2:
Client → POST /api/orders
  {"user_id": "u1", "product_id": "p1", "quantity": 2, "idempotency_key": "ORD-12345"}
Order Service finds order_id "ORD-12345" exists
Returns cached result from first attempt (confirmed or failed)
Client gets consistent answer
```

### Guarantee
- **Exactly-once semantics** for inventory deduction
- **Deterministic behavior** for retries
- **No double-charges** to inventory

### Error Handling
- All errors return consistent format:
  ```json
  {
    "error": {
      "code": "ERROR_CODE",
      "message": "Human-readable message",
      "timestamp": "ISO-8601",
      "request_id": "uuid"
    }
  }
  ```

### Headers

#### **Required on All Requests:**
- `Content-Type: application/json`
- `Authorization: Bearer {token}` (except auth and health endpoints)

#### **Request Tracing Headers (Required):**
- `X-Request-ID: uuid-v4` 
  - Unique identifier for each request
  - Generated by client or API gateway
  - Used to trace a single request through all services
  - Logged with every log message
  - Compatible with Jaeger/Zipkin trace ID

- `X-Correlation-ID: uuid-v4`
  - Links related operations together (e.g., original request + retries)
  - Client should use same correlation ID when retrying with idempotency_key
  - Persists across retry attempts
  - Enables tracking of the full user interaction flow

**Propagation Rules:**
- When Order Service calls Inventory Service, it forwards both headers
- Each service logs both IDs with all log entries
- Response headers echo back the request IDs for verification

**Example Flow:**
```
Initial Request:
  Client → Order Service
    Headers: X-Request-ID: req-001, X-Correlation-ID: corr-abc
  Order Service → Inventory Service  
    Headers: X-Request-ID: req-001, X-Correlation-ID: corr-abc
    
Retry After Timeout:
  Client → Order Service (with idempotency_key: ORD-999)
    Headers: X-Request-ID: req-002, X-Correlation-ID: corr-abc (SAME)
  Order Service → Inventory Service
    Headers: X-Request-ID: req-002, X-Correlation-ID: corr-abc
```

This enables:
- Full request flow visibility across microservices
- Root cause analysis for "Schrödinger's Warehouse" scenarios
- Integration with distributed tracing systems (Jaeger, Zipkin, OpenTelemetry)
- Performance monitoring and debugging

#### **Optional Headers:**
- `X-Client-Version: string` (client version tracking)

### Timeout Handling (Order Service → Inventory Service)
- Default timeout: 3 seconds
- On timeout, Order Service:
  - Creates order with `status: "failed"`
  - Returns order_id to client
  - Client retries with order_id as idempotency_key
  - Returns:
  ```json
  {
    "order_id": "ORD-12345",
    "status": "failed",
    "error": {
      "code": "INVENTORY_SERVICE_TIMEOUT",
      "message": "Could not confirm inventory availability. Retry with the order ID.",
      "timestamp": "ISO-8601"
    }
  }
  ```

---

## Async Patterns Consideration

For additional resilience beyond idempotency, consider implementing:

### Event-Based Communication (Optional Enhancement)

**Order Service publishes:**
- `OrderConfirmed` event (inventory successfully deducted)
- `OrderFailed` event (inventory insufficient)

**Inventory Service publishes:**
- `InventoryDeducted` event

This allows for:
- Event sourcing for complete audit trail
- Downstream services (notifications, analytics) to subscribe without blocking order flow
- Additional guarantees for "Schrödinger's Warehouse" resilience

**Implementation suggestion:** Use message queue (RabbitMQ/Kafka) for event publishing alongside HTTP for critical deduction operations.
