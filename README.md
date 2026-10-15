# QA API Tester

A web-based QA tool for analyzing page content, comparing text, reading links, and validating internal anchor links on DDC dealership pages.

---

## Requirements

- **Node.js** — version **20 LTS** or higher is recommended (the project uses native `fetch`, which requires Node 18+). Node 22 LTS is also supported.
  - Download: https://nodejs.org/en/download

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/RmichelV/api-to-do-qa.git
cd api-to-do-qa
```

### 2. Install dependencies

```bash
npm install
```

### 3. Install Playwright's Chromium browser

```bash
npx playwright install chromium
```

If the command above fails (e.g. npx not available), use this alternative:

```bash
node node_modules/playwright/cli.js install chromium
```

> Chromium is only required for the **Anchor Reading** feature (internal `#id` link validation). All other features (Text Reading, Link Reading, Full Analysis) use plain `fetch` + `cheerio` and do not need a browser.

---

## Running the server

**Production mode:**

```bash
npm start
```

**Development mode** (auto-restarts on file changes):

```bash
npm run dev
```

The server starts on **http://localhost:4000** by default. Open that URL in your browser to access the tool.

Port 4000 is used to avoid conflicts with other common local services (port 3000 is frequently taken by React dev servers, Next.js, etc.).

**To change the port**, edit line 14 of `src/app.js`:

```js
// src/app.js — line 14
const PORT = process.env.PORT || 4000;  // change 4000 to any available port
```

Examples:

```js
const PORT = process.env.PORT || 3000;  // use port 3000
const PORT = process.env.PORT || 8080;  // use port 8080
```

After saving, restart the server and open the new URL in your browser (e.g. `http://localhost:3000`).

---

## Features

### ⚡ Run All
Runs everything in one click:
- Checks the **H1** tag (visible vs sr-only)
- Extracts and compares **desktop text** against your CO, line by line with word-level diff
- Extracts and compares **mobile text** (iPhone viewport) against your CO
- Reads all **links** in the page, checks their **HTTP status**, and flags each one as **REL** (relative) or **ABS** (absolute)
- Verifies whether the **paths you listed** in the "Links to check" field are present in the extracted links

---

### 🖥️ Text Review — Desktop
Fetches the page in desktop mode, normalizes the text, and compares it line by line against the CO you pasted. For each CO line that doesn't match exactly, it finds the closest line in the page and shows a **word-level diff** highlighting what was added or removed.

### 📱 Text Review — Mobile
Same as Desktop Text Review, but fetches the page using a mobile user agent (iPhone, 430×932 viewport). Useful for pages that serve different content depending on the device.

### 🔗 Read Links + H1
- Extracts all visible links inside `.ddc-wrapper` with their text, full URL, HTTP status code, and REL/ABS type
- Evaluates the **H1** tag: checks if there is exactly one visible H1 and whether it matches the sr-only H1
- If you filled in the **"Links to check"** field, it will report which of those paths were found in the extracted links and which were not

### ⚓ Anchor Reading
Validates internal anchor links (`href="#section-id"`): checks that the target element actually exists on the page and that it can be reached by scrolling.

> **Why is this button separate?**
> All other features work by simply fetching the page HTML — no browser needed. Anchor validation is different: it requires loading the page in a **real browser**, clicking the link, and confirming the page actually scrolls to the target. For this reason it uses Playwright (Chromium) and runs independently. Mixing it into Run All would significantly slow down every analysis even when anchor checking isn't needed.

---

## Usage

1. Open **http://localhost:3000** in your browser.
2. Paste the **Target URL** of the page you want to analyze.
3. *(Optional)* Paste the **CO · Original Content** to compare against the page text.
4. *(Optional)* Paste a list of **paths to check** (one per line, e.g. `/new-inventory/index.htm`) to verify they appear in the extracted links.
5. Click the desired action button or **⚡ Run All**.

---

## Project structure

```
src/
  app.js                         # Express entry point
  controllers/                   # Route handlers
  routes/                        # Express routers
  services/
    textReadingService.js        # Desktop text extraction (fetch + cheerio)
    textReadingMobileService.js  # Mobile text extraction (fetch + cheerio)
    linkReadingService.js        # Link and H1 extraction (fetch + cheerio)
    anchorReadingService.js      # Anchor validation (Playwright)
    fullAnalysisService.js       # Parallel desktop + mobile + links
  utils/
    scrapeUtils.js               # Shared fetch/cheerio scraping utilities
    normalization.js             # Text normalization helpers
public/
  index.html                     # Frontend UI
  styles.css                     # Styles
```

## Deployment with Docker

These steps describe how to deploy the app on an Ubuntu VPS using Docker and Caddy (Caddy will automatically obtain TLS certificates for your domain).

1) Prepare the VPS (Ubuntu)

- Update the system and install Docker & Docker Compose:

  ```bash
  sudo apt update && sudo apt upgrade -y
  sudo apt install -y ca-certificates curl gnupg lsb-release
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io
  sudo usermod -aG docker $USER   # log out / log in or `newgrp docker`

  # Install docker compose plugin if needed
  sudo apt install -y docker-compose-plugin
  ```

2) DNS

- Point your domain (A record) to the VPS public IP. Example: example.com -> 203.0.113.12

3) Files already added to this repo

- A `Dockerfile`, `docker-compose.yml` and `Caddyfile` were added to the project to simplify deployment.
  - Edit `Caddyfile` and replace `example.com` with your real domain.
  - If you want a different port for the app, update both `Dockerfile` and `docker-compose.yml` accordingly.

4) Build and launch

On the VPS, clone the repo (or copy the project) and run:

```bash
git clone <your-repo-url> /opt/api-to-do-qa
cd /opt/api-to-do-qa
# Edit ./Caddyfile: replace example.com with your domain
sudo docker compose up -d --build
```

- Caddy will listen on ports 80 and 443 and automatically obtain a TLS certificate for the domain.
- The Node app exposes port 4000 internally and Caddy reverse-proxies the domain to the app.

5) Confirm

- Check logs:

```bash
sudo docker compose logs -f caddy
sudo docker compose logs -f app
```

- Open `https://your.domain` in a browser. Caddy will redirect with HTTPS.

6) Playwright note

- The image installs Playwright browsers (so features requiring Chromium will work). This increases image size. If you want a lighter image, remove Playwright steps from the Dockerfile, but ensure no code imports Playwright at module-load time (see discussion in repo README about the Anchor Reading feature).

7) Firewall

- Allow ports 80 & 443 through UFW (if enabled):

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw reload
```

8) Updating the app

To deploy a new version:

```bash
cd /opt/api-to-do-qa
git pull
sudo docker compose up -d --build
```

9) Optional: run as non-root docker user

- If you prefer not to use `sudo` for docker, ensure your user is in the `docker` group (`sudo usermod -aG docker $USER`) and re-login.

If you'd like, next steps I can do for you:
- Create a small systemd service or script on the VPS to manage docker compose (optional)
- Replace Caddy with a different reverse proxy (nginx or Traefik) if you prefer
- Remove Playwright from the Docker image and convert Playwright imports to dynamic imports to make it optional (reduces image size)

