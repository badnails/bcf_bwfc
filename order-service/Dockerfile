# Base stage - common for both dev and prod
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

# Development stage
FROM base AS development
WORKDIR /app
EXPOSE 3000
CMD ["bun", "run", "--watch", "src/index.ts"]

# Production stage
FROM base AS production
WORKDIR /app

# Copy source code
COPY src ./src

# Expose port
EXPOSE 3000

# Start the app
CMD ["bun", "run", "src/index.ts"]
