-- Inventory Service Database Initialization

-- Products Table
CREATE TABLE IF NOT EXISTS products (
    product_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    stock_level INT NOT NULL DEFAULT 0 CHECK (stock_level >= 0),
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_level ON products(stock_level);

-- Inventory Operations Table
CREATE TABLE IF NOT EXISTS inventory_operations (
    operation_id SERIAL PRIMARY KEY,
    
    -- Operation details
    operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('deduct', 'adjust')),
    product_id VARCHAR(64) NOT NULL,
    quantity_change INT NOT NULL,
    
    -- Stock snapshots
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL,
    
    -- Idempotency: Links to order (NULL for manual adjustments)
    order_id VARCHAR(64),
    
    -- Manual adjustment details (NULL for deduct operations)
    adjustment_reason VARCHAR(50) CHECK (adjustment_reason IN ('restock', 'correction', 'damage') OR adjustment_reason IS NULL),
    notes TEXT,
    
    -- Request tracing
    request_id VARCHAR(64),
    correlation_id VARCHAR(64),
    
    -- Result tracking
    status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

-- CRITICAL: Prevent duplicate deductions for same order (Schrödinger's Warehouse solution)
CREATE UNIQUE INDEX IF NOT EXISTS unique_order_deduction ON inventory_operations(order_id, operation_type) WHERE order_id IS NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_id ON inventory_operations(product_id);
CREATE INDEX IF NOT EXISTS idx_order_id ON inventory_operations(order_id);
CREATE INDEX IF NOT EXISTS idx_operation_type ON inventory_operations(operation_type);
CREATE INDEX IF NOT EXISTS idx_created_at ON inventory_operations(created_at);
CREATE INDEX IF NOT EXISTS idx_correlation_id ON inventory_operations(correlation_id);

-- Sample Data
INSERT INTO products (product_id, name, stock_level) VALUES
('PROD-001', 'Gaming Console - PS5', 100),
('PROD-002', 'Gaming Console - Xbox Series X', 75),
('PROD-003', 'Gaming Laptop', 50),
('PROD-004', 'Wireless Headset', 200),
('PROD-005', 'Mechanical Keyboard', 150)
ON CONFLICT (product_id) DO NOTHING;
