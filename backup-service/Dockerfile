FROM oven/bun:1-alpine

# Install PostgreSQL client for pg_dump
RUN apk add --no-cache postgresql16-client

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src ./src

# Create dumps directory
RUN mkdir -p /dumps

EXPOSE 3002

CMD ["bun", "run", "start"]
