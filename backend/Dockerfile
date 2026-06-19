# ═══════════════════════════════════════════════════════════════════════════════
#  Yaksha FAQ Portal — Backend Dockerfile
#  Multi-stage: dependency install → lean runtime with Infisical CLI
#  Inspired by vicharanashala/wa-client
# ═══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Install production dependencies ─────────────────────────────────
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Install system dependencies needed to build native node modules
# (bcryptjs, @huggingface/transformers ONNX runtime, sharp, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root workspace + backend package files
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/

# Install production dependencies only (backend workspace)
RUN npm ci --workspace=backend --include-workspace-root --omit=dev

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Install curl (healthchecks), gnupg/ca-certificates (Infisical)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    lsb-release \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Infisical CLI for secret injection at runtime
RUN curl -1sLf \
    'https://artifacts-cli.infisical.com/setup.deb.sh' \
    | bash && \
    apt-get update && apt-get install -y infisical \
    && rm -rf /var/lib/apt/lists/*

# Copy production node_modules from deps stage (workspace deps are hoisted to root)
COPY --from=deps /app/node_modules ./node_modules

# Copy backend source code
COPY backend/ ./backend/

# Copy root package.json (needed for workspace resolution)
COPY package.json ./

# Create logs directory
RUN mkdir -p /app/logs

# Set working directory to backend
WORKDIR /app/backend

# Expose the backend API port
EXPOSE 6767

# Healthcheck — hit the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
    CMD curl -sf http://localhost:6767/api/health || exit 1

# Run the server using tsx (TypeScript executor from node_modules)
# tsx is included in production deps since it's in "dependencies" via the
# root workspace. We use node --import to register the tsx loader.
CMD ["node", "--import", "tsx", "server.ts"]
