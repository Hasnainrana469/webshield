# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile TypeScript
COPY . .
RUN npm run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install Nmap and Chromium (for Puppeteer) via Alpine package manager
RUN apk add --no-cache \
    nmap \
    nmap-scripts \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Tell Puppeteer to use the system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy production dependencies from builder
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/knexfile.js ./knexfile.js

# Create reports directory
RUN mkdir -p /app/reports

EXPOSE 3001

CMD ["node", "dist/index.js"]
