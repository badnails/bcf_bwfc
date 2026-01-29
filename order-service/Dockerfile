FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

# Copy source code
COPY src ./src

# Expose port
EXPOSE 3000

# Start the app
CMD ["bun", "run", "src/index.ts"]
