FROM node:20-bullseye-slim

# Install system dependencies required by Playwright and common fonts/tools
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    gnupg \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libc6 \
    libcairo2 \
    libexpat1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    libasound2 \
    fonts-liberation \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker cache
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy app source
COPY . .

# Install Playwright browsers and optional deps (if Playwright is used)
# This step is safe even if Playwright isn't used; it will be a no-op if not present.
RUN npx playwright install --with-deps || true

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/app.js"]
