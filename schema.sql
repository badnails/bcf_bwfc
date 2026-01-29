-- ============================================================================
-- DATABASE SCHEMA - Valerix E-commerce Platform
-- ============================================================================

-- ============================================================================
-- ORDER SERVICE DATABASE
-- ============================================================================

-- Orders Table
-- Stores all order attempts (confirmed and failed)
-- order_id serves as idempotency key
CREATE TABLE orders (
    order_id VARCHAR(64) PRIMARY KEY,           -- UUID format (e.g., "ORD-uuid")
    user_id VARCHAR(64) NOT NULL,                -- Reference to user (from Auth Service)
    product_id VARCHAR(64) NOT NULL,             -- Reference to product
    quantity INT NOT NULL CHECK (quantity > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('confirmed', 'failed')),
    error_message TEXT,                          -- Populated if status = 'failed'
    
    -- Request tracing
    request_id VARCHAR(64),                      -- X-Request-ID from initial request
    correlation_id VARCHAR(64),                  -- X-Correlation-ID for tracking retries
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for common queries
    INDEX idx_user_id (user_id),
    INDEX idx_product_id (product_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_correlation_id (correlation_id)
);

-- Order Statistics Table (Optional - for metrics aggregation)
-- Tracks performance metrics for monitoring dashboard
CREATE TABLE order_stats (
    stat_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    minute_bucket TIMESTAMP NOT NULL,            -- Rounded to minute for aggregation
    total_orders INT DEFAULT 0,
    confirmed_orders INT DEFAULT 0,
    failed_orders INT DEFAULT 0,
    timeout_errors INT DEFAULT 0,                -- Orders failed due to inventory timeout
    avg_response_time_ms INT DEFAULT 0,          -- Average response time in milliseconds
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_minute (minute_bucket),
    INDEX idx_minute_bucket (minute_bucket)
);

-- ============================================================================
-- INVENTORY SERVICE DATABASE
-- ============================================================================

-- Products Table
-- Master catalog of all products with current stock levels
CREATE TABLE products (
    product_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    stock_level INT NOT NULL DEFAULT 0 CHECK (stock_level >= 0),
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_stock_level (stock_level)
);

-- Inventory Operations Table
-- Dual purpose:
-- 1. Idempotency: Prevents duplicate deductions for same order_id
-- 2. Audit Trail: Tracks all inventory changes with full context
CREATE TABLE inventory_operations (
    operation_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- Operation details
    operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('deduct', 'adjust')),
    product_id VARCHAR(64) NOT NULL,
    quantity_change INT NOT NULL,                -- Negative for deductions, positive for additions
    
    -- Stock snapshots
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL,
    
    -- Idempotency: Links to order (NULL for manual adjustments)
    order_id VARCHAR(64),                        -- Unique for deduct operations
    
    -- Manual adjustment details (NULL for deduct operations)
    adjustment_reason VARCHAR(50) CHECK (adjustment_reason IN ('restock', 'correction', 'damage') OR adjustment_reason IS NULL),
    notes TEXT,
    
    -- Request tracing
    request_id VARCHAR(64),                      -- X-Request-ID
    correlation_id VARCHAR(64),                  -- X-Correlation-ID
    
    -- Result tracking
    status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    
    -- CRITICAL: Prevent duplicate deductions for same order
    -- This is the key to solving Schrödinger's Warehouse
    UNIQUE KEY unique_order_deduction (order_id, operation_type),
    
    -- Indexes for common queries
    INDEX idx_product_id (product_id),
    INDEX idx_order_id (order_id),
    INDEX idx_operation_type (operation_type),
    INDEX idx_created_at (created_at),
    INDEX idx_correlation_id (correlation_id)
);

-- ============================================================================
-- NOTES ON SCHRÖDINGER'S WAREHOUSE SOLUTION
-- ============================================================================
/*
The UNIQUE constraint on (order_id, operation_type) ensures:

1. First deduct attempt for order_id="ORD-123":
   - INSERT INTO inventory_operations succeeds
   - Stock is deducted in products table (within same transaction)
   - COMMIT happens
   - Service crashes before HTTP response
   
2. Retry with same order_id="ORD-123":
   - Attempt INSERT INTO inventory_operations
   - UNIQUE constraint violation detected
   - Query existing record for order_id="ORD-123"
   - Return cached result (previous_stock, new_stock, etc.)
   - No duplicate deduction occurs

This provides exactly-once semantics at the database level.
*/

-- ============================================================================
-- SAMPLE DATA FOR TESTING
-- ============================================================================

-- Sample products
INSERT INTO products (product_id, name, stock_level) VALUES
('PROD-001', 'Gaming Console - PS5', 100),
('PROD-002', 'Gaming Console - Xbox Series X', 75),
('PROD-003', 'Gaming Laptop', 50),
('PROD-004', 'Wireless Headset', 200),
('PROD-005', 'Mechanical Keyboard', 150);

-- ============================================================================
-- QUERIES FOR COMMON OPERATIONS
-- ============================================================================

-- Check if order already processed (idempotency check)
-- SELECT * FROM inventory_operations WHERE order_id = ? AND operation_type = 'deduct';

-- Get current stock for product
-- SELECT stock_level FROM products WHERE product_id = ?;

-- Get user's order history
-- SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC;

-- Get audit trail for product
-- SELECT * FROM inventory_operations WHERE product_id = ? ORDER BY created_at DESC;

-- Get orders affected by timeouts (for monitoring)
-- SELECT * FROM orders WHERE error_message LIKE '%timeout%' OR error_message LIKE '%INVENTORY_SERVICE_TIMEOUT%';

-- ============================================================================
-- TRANSACTION PATTERN FOR DEDUCT OPERATION (Pseudocode)
-- ============================================================================
/*
BEGIN TRANSACTION;

  -- Check idempotency
  existing = SELECT * FROM inventory_operations WHERE order_id = :order_id AND operation_type = 'deduct';
  
  IF existing EXISTS:
    ROLLBACK;
    RETURN cached_result(existing);
  
  -- Check stock availability
  current_stock = SELECT stock_level FROM products WHERE product_id = :product_id FOR UPDATE;
  
  IF current_stock < :quantity:
    ROLLBACK;
    RETURN error('Insufficient stock');
  
  -- Deduct stock
  new_stock = current_stock - :quantity;
  UPDATE products SET stock_level = new_stock, last_updated = NOW() WHERE product_id = :product_id;
  
  -- Record operation (with UNIQUE constraint on order_id)
  INSERT INTO inventory_operations (
    operation_type, product_id, quantity_change, previous_stock, new_stock,
    order_id, request_id, correlation_id, status
  ) VALUES (
    'deduct', :product_id, -:quantity, current_stock, new_stock,
    :order_id, :request_id, :correlation_id, 'success'
  );

COMMIT;

-- Even if crash happens here, DB has committed
-- Retry will hit UNIQUE constraint and return cached result
*/
