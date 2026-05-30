# Dockerfile for Glama introspection checks.
# email-playbook-mcp is a zero-config stdio MCP server (pure ESM, no build step).
FROM node:20-alpine

WORKDIR /app

# Install only the runtime dependency (@modelcontextprotocol/sdk) from the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server source + playbook data.
COPY . .

# stdio transport — Glama starts this and sends an introspection request.
ENTRYPOINT ["node", "src/server.mjs"]
