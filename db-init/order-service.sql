-- Order Service Database Initialization

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('confirmed', 'failed')),
    error_message TEXT,
    
    -- Request tracing
    request_id VARCHAR(64),
    correlation_id VARCHAR(64),
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_correlation_id ON orders(correlation_id);

-- Order Statistics Table
CREATE TABLE IF NOT EXISTS order_stats (
    stat_id SERIAL PRIMARY KEY,
    minute_bucket TIMESTAMP NOT NULL,
    total_orders INT DEFAULT 0,
    confirmed_orders INT DEFAULT 0,
    failed_orders INT DEFAULT 0,
    timeout_errors INT DEFAULT 0,
    avg_response_time_ms INT DEFAULT 0,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(minute_bucket)
);

CREATE INDEX IF NOT EXISTS idx_minute_bucket ON order_stats(minute_bucket);
