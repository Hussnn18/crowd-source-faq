# ═══════════════════════════════════════════════════════════════════════════════
#  Yaksha FAQ Portal — Frontend Dockerfile
#  Multi-stage: Vite build → Nginx serving static SPA
# ═══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build the Vite SPA ──────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copy root workspace files first (for npm workspaces resolution)
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

# Install dependencies (frontend workspace only)
RUN npm ci --workspace=frontend --include-workspace-root

# Copy frontend source
COPY frontend/ ./frontend/

# Build the Vite SPA → produces frontend/dist/
RUN npm run build --workspace=frontend

# ── Stage 2: Serve with Nginx ────────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config (SPA routing + API proxy)
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files from build stage
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Nginx runs on port 80
EXPOSE 80

# Healthcheck — hit the nginx-health endpoint
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]
