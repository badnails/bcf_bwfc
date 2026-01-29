.PHONY: help dev-up dev-down dev-build dev-restart dev-logs dev-clean prod-up prod-down prod-build prod-restart prod-logs prod-clean test-basic test-idempotency test-timeout test-gremlin clean-all db-reset health status

# Default target
help:
	@echo "Valerix E-commerce Platform - Makefile Commands"
	@echo ""
	@echo "Development Commands:"
	@echo "  make dev-up          - Start development environment"
	@echo "  make dev-down        - Stop development environment"
	@echo "  make dev-build       - Rebuild development containers"
	@echo "  make dev-restart     - Restart development environment"
	@echo "  make dev-logs        - Show development logs (follow)"
	@echo "  make dev-clean       - Clean development environment (remove volumes)"
	@echo ""
	@echo "Production Commands:"
	@echo "  make prod-up         - Start production environment"
	@echo "  make prod-down       - Stop production environment"
	@echo "  make prod-build      - Rebuild production containers"
	@echo "  make prod-restart    - Restart production environment"
	@echo "  make prod-logs       - Show production logs (follow)"
	@echo "  make prod-clean      - Clean production environment (remove volumes)"
	@echo ""
	@echo "Testing Commands:"
	@echo "  make test-basic      - Run basic API tests"
	@echo "  make test-idempotency - Test idempotency mechanism"
	@echo "  make test-timeout    - Test timeout handling"
	@echo "  make test-gremlin    - Test gremlin chaos injection"
	@echo ""
	@echo "Utility Commands:"
	@echo "  make health          - Check health of all services"
	@echo "  make status          - Show status of all containers"
	@echo "  make db-reset        - Reset databases (dev only)"
	@echo "  make clean-all       - Clean both dev and prod environments"
	@echo ""

# ==============================================================================
# DEVELOPMENT ENVIRONMENT
# ==============================================================================

dev-up:
	@echo "Starting development environment..."
	docker-compose -f docker-compose.dev.yml up -d
	@echo "Development environment started!"
	@echo "Order Service: http://localhost:3000"
	@echo "Inventory Service: http://localhost:3001"

dev-down:
	@echo "Stopping development environment..."
	docker-compose -f docker-compose.dev.yml down

dev-build:
	@echo "Building development containers..."
	docker-compose -f docker-compose.dev.yml build --no-cache

dev-restart: dev-down dev-up

dev-logs:
	docker-compose -f docker-compose.dev.yml logs -f

dev-clean:
	@echo "Cleaning development environment..."
	docker-compose -f docker-compose.dev.yml down -v
	@echo "Development environment cleaned!"

# ==============================================================================
# PRODUCTION ENVIRONMENT
# ==============================================================================

prod-up:
	@echo "Starting production environment..."
	docker-compose -f docker-compose.prod.yml up -d
	@echo "Production environment started!"
	@echo "Order Service: http://localhost:3000"
	@echo "Inventory Service: http://localhost:3001"

prod-down:
	@echo "Stopping production environment..."
	docker-compose -f docker-compose.prod.yml down

prod-build:
	@echo "Building production containers..."
	docker-compose -f docker-compose.prod.yml build --no-cache

prod-restart: prod-down prod-up

prod-logs:
	docker-compose -f docker-compose.prod.yml logs -f

prod-clean:
	@echo "Cleaning production environment..."
	docker-compose -f docker-compose.prod.yml down -v
	@echo "Production environment cleaned!"

# ==============================================================================
# TESTING COMMANDS
# ==============================================================================

test-basic:
	@echo "Running basic API tests..."
	@echo "\n=== Testing Health Checks ==="
	@curl -s http://localhost:3000/health | jq .
	@curl -s http://localhost:3001/health | jq .
	@echo "\n=== Testing Inventory Check ==="
	@curl -s http://localhost:3001/api/inventory | jq .
	@echo "\n=== Placing Test Order ==="
	@curl -s -X POST http://localhost:3000/api/orders \
		-H "Content-Type: application/json" \
		-d '{"product_id":"WIDGET-001","quantity":1}' | jq .
	@echo "\n=== Getting All Orders ==="
	@curl -s http://localhost:3000/api/orders | jq .

test-idempotency:
	@echo "Testing idempotency mechanism..."
	@echo "\n=== First Order Attempt ==="
	@ORDER_ID=$$(curl -s -X POST http://localhost:3000/api/orders \
		-H "Content-Type: application/json" \
		-d '{"product_id":"WIDGET-001","quantity":2}' | jq -r '.order_id'); \
	echo "Order ID: $$ORDER_ID"; \
	echo "\n=== Retry with Same Order ID (should return cached result) ==="; \
	curl -s -X POST http://localhost:3000/api/orders \
		-H "Content-Type: application/json" \
		-d "{\"product_id\":\"WIDGET-001\",\"quantity\":2,\"idempotency_key\":\"$$ORDER_ID\"}" | jq .

test-timeout:
	@echo "Testing timeout handling..."
	@echo "\n=== Enable Gremlin (every 3rd request delayed 5s) ==="
	@curl -s -X POST http://localhost:3001/internal/gremlin/enable | jq .
	@echo "\n=== Making 3 requests to trigger timeout ==="
	@for i in 1 2 3; do \
		echo "\nRequest $$i:"; \
		curl -s -X POST http://localhost:3000/api/orders \
			-H "Content-Type: application/json" \
			-d '{"product_id":"WIDGET-001","quantity":1}' | jq .; \
		sleep 1; \
	done
	@echo "\n=== Disable Gremlin ==="
	@curl -s -X POST http://localhost:3001/internal/gremlin/disable | jq .

test-gremlin:
	@echo "Testing gremlin chaos injection..."
	@echo "\n=== Gremlin Status ==="
	@curl -s http://localhost:3001/internal/gremlin/status | jq .
	@echo "\n=== Enable Gremlin ==="
	@curl -s -X POST http://localhost:3001/internal/gremlin/enable | jq .
	@echo "\n=== Make requests to observe latency pattern ==="
	@for i in 1 2 3 4 5; do \
		echo "\nRequest $$i:"; \
		START=$$(date +%s); \
		curl -s -X POST http://localhost:3000/api/orders \
			-H "Content-Type: application/json" \
			-d '{"product_id":"WIDGET-001","quantity":1}' > /dev/null; \
		END=$$(date +%s); \
		DIFF=$$((END - START)); \
		echo "Time taken: $${DIFF}s"; \
	done
	@echo "\n=== Disable Gremlin ==="
	@curl -s -X POST http://localhost:3001/internal/gremlin/disable | jq .

# ==============================================================================
# UTILITY COMMANDS
# ==============================================================================

health:
	@echo "Checking service health..."
	@echo "\n=== Order Service ==="
	@curl -s http://localhost:3000/health | jq . || echo "❌ Order Service unreachable"
	@echo "\n=== Inventory Service ==="
	@curl -s http://localhost:3001/health | jq . || echo "❌ Inventory Service unreachable"

status:
	@echo "Container Status:"
	@docker ps -a --filter "name=order" --filter "name=inventory" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

db-reset:
	@echo "Resetting development databases..."
	@docker-compose -f docker-compose.dev.yml exec order-db psql -U postgres -d order_db -c "TRUNCATE TABLE orders CASCADE;"
	@docker-compose -f docker-compose.dev.yml exec inventory-db psql -U postgres -d inventory_db -c "TRUNCATE TABLE inventory_operations CASCADE;"
	@echo "Databases reset! Reinitializing sample data..."
	@docker-compose -f docker-compose.dev.yml restart order-db inventory-db

clean-all:
	@echo "Cleaning all environments..."
	@make dev-clean
	@make prod-clean
	@echo "All environments cleaned!"
