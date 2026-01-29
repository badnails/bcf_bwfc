FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install

COPY src ./src

# Create backup storage directory
RUN mkdir -p /backups

EXPOSE 3003

CMD ["bun", "run", "start"]
