# Base stage - common for both dev and prod
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY inventory-service/package.json ./
RUN bun install

# Development stage
FROM base AS development
WORKDIR /app
EXPOSE 3001
CMD ["bun", "run", "--watch", "src/index.ts"]

# Production stage
FROM base AS production
WORKDIR /app

# Copy source code
COPY inventory-service/src ./src

# Copy shared module (metrics) - placed as sibling for ../../shared imports
COPY shared /shared

# Expose port
EXPOSE 3001

# Start the app
CMD ["bun", "run", "src/index.ts"]
