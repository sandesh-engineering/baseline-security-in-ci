# ---------- Builder stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (including dev dependencies needed for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Drop privileges
USER appuser

EXPOSE 3000

CMD ["node", "dist/index.js"]