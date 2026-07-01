# FlyerTrack

FlyerTrack is a management platform for nightclub promoter (RRPP) teams. It lets venues create events, assign promoters, generate a unique QR code per physical flyer, batch-print flyers with the QR already embedded, and track every scan in real time through a multi-layer anti-fraud system.

## Features

- **Event management** — create, edit, close and archive events, with per-event fraud thresholds and limited-time offers.
- **Promoter (RRPP) management** — accounts, groups/teams (with color tags), per-event assignment and discount codes.
- **QR generation at scale** — generate unique QR codes per flyer (standard or with venue logo), in configurable batches.
- **Automatic flyer assembly** — overlay generated QRs onto a flyer template (image or PDF) and export the whole batch as a ZIP, ready to print.
- **Scan landing page** — each QR resolves to a branded landing page with a live countdown for time-limited offers.
- **Real-time analytics** — dashboards for admins and venue managers (jefe) with scan counts, activation rate, promoter ranking per event, and CSV/PDF report export.
- **Anti-fraud engine** — see [Anti-fraud system](#anti-fraud-system) below.
- **Alerts** — optional Telegram and email notifications when suspicious activity is detected.
- **Role-based access** — `admin`, `jefe` (venue manager) and `rrpp` (promoter) roles with JWT access/refresh tokens.
- **Automatic hourly backups** of event history to JSON.

## Tech stack

- **Backend:** Node.js, Express 5
- **Database:** SQLite via `better-sqlite3`
- **Auth:** JWT (access + refresh tokens), `bcryptjs` password hashing
- **Frontend:** vanilla HTML / CSS / JavaScript (no build step)
- **QR / imaging:** `qrcode`, `sharp`, `pdf-lib`, `pdf2pic`, `pdfkit`, `archiver`
- **Scheduling & alerts:** `node-cron`, `telegraf` (Telegram), `nodemailer` (email)
- **Security middleware:** `helmet`, `cors`, `express-rate-limit`
- **Deployment:** Docker / Docker Compose

## Getting started

### Requirements

- Node.js 20+
- npm

### Installation

```bash
git clone https://github.com/Porras-Dev/FlyerTrack.git
cd FlyerTrack/backend
npm install
```

### Environment variables

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (default `3000`) |
| `NODE_ENV` | `development` or `production` |
| `DB_PATH` | Path to the SQLite database file |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Secrets used to sign access/refresh tokens |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | Token lifetimes |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | Credentials for the admin account created on first run |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional, for Telegram fraud alerts |
| `EMAIL_USER` / `EMAIL_PASS` | Optional, for email alerts (Gmail SMTP) |
| `BASE_URL` | Public base URL used to build QR landing links |

### Running the app

```bash
npm start
```

The server initializes the SQLite schema on first boot, creates the default admin account, and serves both the API and the static frontend on `http://localhost:3000`.

### Running with Docker

```bash
docker compose up --build
```

Environment variables are read from your shell/`.env` at the `docker-compose.yml` level; data and uploaded assets persist in named volumes.

## Architecture overview

```
Flyertrack/
├── backend/
│   ├── src/
│   │   ├── config/        # SQLite schema & connection
│   │   ├── controllers/    # Business logic (auth, events, flyers, QR, reports, dashboard, landing)
│   │   ├── middleware/     # JWT auth guards
│   │   ├── routes/         # Express routers
│   │   ├── utils/          # Alerts, helpers, history/backups
│   │   └── index.js         # App entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── admin/               # Admin panel
│   ├── jefe/                # Venue manager panel
│   ├── rrpp/                # Promoter panel
│   ├── login.html
│   └── assets/              # Shared CSS/JS
├── docker-compose.yml
└── LICENSE
```

## Anti-fraud system

FlyerTrack assumes any QR code can be photographed, screenshotted and reshared, so it enforces fraud protection in three layers:

1. **QR uniqueness** — each QR token can only be *claimed* once per device fingerprint/IP combination; once a code has been activated, further scans from a different origin are flagged instead of counted as new conversions.
2. **Device blocking** — devices that repeatedly trigger fraud signals are recorded in a block list (`dispositivos_bloqueados`) scoped per event, preventing them from claiming further codes for that event.
3. **Compulsive reuse detection** — scan velocity and activation ratio per promoter/flyer are compared against configurable per-event thresholds (`umbral_fraude_escaneos`, `umbral_fraude_minutos`); scans that exceed them are marked `sospechoso` with a recorded reason and surfaced on the dashboard/alerts feed.

## Screenshots

_Screenshots of the admin, venue manager and promoter dashboards will be added here._

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
