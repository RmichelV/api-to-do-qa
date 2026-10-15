FROM node:20-bookworm-slim

WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker cache
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Chromium plus its system libraries (only the Anchors feature needs it)
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

# Copy app source
COPY . .

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["node", "src/app.js"]
