# FlyerTrack

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Backend-Node.js%2020-339933?logo=node.js)
![Express 5](https://img.shields.io/badge/Framework-Express%205-000000?logo=express)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?logo=sqlite)
![Docker](https://img.shields.io/badge/Deploy-Docker-2496ED?logo=docker)
![JWT](https://img.shields.io/badge/Auth-JWT-black?logo=jsonwebtokens)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)

**Open-source QR-based flyer tracking and anti-fraud system for nightclub promoter (RRPP) teams.**

FlyerTrack lets a venue create events, assign promoters, and generate a unique QR code per physical flyer. Every scan is tracked in real time and evaluated by a three-layer anti-fraud engine, so a venue can pay promoters by *verified* activations instead of printed volume — and know exactly which flyer, which promoter, and which device drove every discount code redeemed at the door.

---

```
┌───────────────────────────────────────────────────────────────────┐
│  FlyerTrack — Admin Dashboard                        [admin] 🎟️   │
├────────────────┬────────────────┬────────────────┬────────────────┤
│  ACTIVE EVENTS │  RRPPs ACTIVE  │  QRs GENERATED │  SUSPICIOUS     │
│  ● 3           │  ● 18          │  ● 4,250        │  ● 7           │
├────────────────┴────────────────┴────────────────┴────────────────┤
│  Recent events                                                     │
│  ● Club Aurora     Velvet    1,240 QRs    980 scans    [active]    │
│  ● Warehouse Nine   Lemon      860 QRs    612 scans    [active]    │
│  ● Bermuda Room    Zrrcus       500 QRs    310 scans   [closed]    │
├──────────────────────────────────────────────────────────────────┤
│  Scan pipeline                                                     │
│  GET /qr/:token → fingerprint check → claim → landing page          │
│  ✔ unique device   ✔ within threshold   → discount code shown       │
└───────────────────────────────────────────────────────────────────┘
```

---

## Table of contents

- [Features](#features)
- [Anti-fraud system](#anti-fraud-system)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Roles & access](#roles--access)
- [API overview](#api-overview)
- [Project structure](#project-structure)
- [License](#license)

---

## Features

- **Event management** — create, edit, close, reopen and archive events, each with its own venue room, fraud thresholds and limited-time offer countdown.
- **Promoter (RRPP) management** — accounts, color-tagged groups/teams, per-event assignment and unique discount codes.
- **QR generation at scale** — generate unique QR codes per flyer (standard or with venue logo baked in) in configurable batches of up to 1,000.
- **Automatic flyer assembly** — drag-and-resize the QR position on a live preview, then overlay it onto a flyer template (PNG, JPG or PDF) and export the whole batch as a ready-to-print ZIP.
- **Digital flyer generator** — square, social-ready flyer with an embedded QR for online distribution.
- **Branded scan landing page** — each QR resolves to a themed landing page (per room) with the promoter's discount code and a live countdown for time-limited offers.
- **Real-time analytics** — dashboards for admins, venue managers and promoters: scan counts, activation rate, promoter ranking per event, hourly scan distribution.
- **Anti-fraud engine** — see [Anti-fraud system](#anti-fraud-system) below.
- **Fraud alerts** — optional Telegram and email notifications the moment suspicious activity is detected.
- **Login protection** — progressive lockout after repeated failed login attempts, with temporary suspension and permanent block.
- **Role-based access** — `admin`, `jefe` (venue manager) and `rrpp` (promoter) roles, each with a dedicated panel.
- **Reporting** — per-event PDF report and CSV export of the full scan log.
- **Automatic hourly backups** of closed-event history to JSON, importable back into the database.

---

## Anti-fraud system

FlyerTrack assumes every printed QR code can be photographed, screenshotted and reshared, so a scan is never trusted at face value. Each claim passes through three independent layers before a discount code is ever shown:

| Layer | What it catches | How |
|---|---|---|
| **1. QR uniqueness** | The same flyer being "activated" by more than one person | Each QR token can only be *claimed* once per device fingerprint. The first device to claim it owns it — every other device is rejected with "already used", regardless of how many times the physical flyer is rescanned. |
| **2. Device blocking** | One device farming multiple flyers to inflate a promoter's numbers | If a device fingerprint tries to claim a *second* QR for the same event, that device is recorded in a per-event block list (`dispositivos_bloqueados`) and denied any further claims for that event. |
| **3. Compulsive reuse detection** | Burst reuse of a single QR (e.g. a link shared in a group chat) | Scans of the same QR within a configurable time window (`umbral_fraude_minutos`) are counted; once they exceed the per-event threshold (`umbral_fraude_escaneos`), the QR is auto-blocked, flagged `sospechoso`, and — if Telegram/email alerts are configured — the admin is notified immediately. |

Every flagged event is visible on the admin dashboard's alerts feed with the specific reason, and blocked QRs can be manually reviewed and unblocked from the panel.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js 20, Express 5 |
| **Database** | SQLite via `better-sqlite3` (WAL mode) |
| **Auth** | JWT access + refresh tokens (`jsonwebtoken`), `bcryptjs` password hashing |
| **Frontend** | Vanilla HTML / CSS / JavaScript — no build step, no framework |
| **QR / imaging** | `qrcode`, `sharp`, `pdf-lib`, `pdf2pic`, `pdfkit`, `archiver` |
| **Scheduling & alerts** | `node-cron`, `telegraf` (Telegram), `nodemailer` (email) |
| **Security middleware** | `helmet`, `cors`, `express-rate-limit` |
| **Uploads** | `multer` (in-memory, size-limited) |
| **Deployment** | Docker / Docker Compose |

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- npm

### 1. Clone & install

```bash
git clone https://github.com/Porras-Dev/FlyerTrack.git
cd FlyerTrack/backend
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env` with your own values — see the [full variable reference](#environment-variables) below.

### 3. Run the app

```bash
npm start
```

On first boot the server creates the SQLite schema, seeds the three preset promoter groups (Velvet, Lemon, Zrrcus) and the default admin account from your `.env`. The API and the static frontend are both served from:

```
http://localhost:3000
```

### 4. Run with Docker instead

```bash
docker compose up --build
```

`docker-compose.yml` reads the same variables from your shell/`.env`; the database and uploaded assets persist across restarts in named Docker volumes.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Port the server listens on (default `3000`) |
| `NODE_ENV` | No | `development` or `production` |
| `DB_PATH` | No | Path to the SQLite database file (default `./flyertrack.db`) |
| `JWT_SECRET` | **Yes** | Secret used to sign access tokens |
| `JWT_REFRESH_SECRET` | **Yes** | Secret used to sign refresh tokens |
| `JWT_EXPIRES_IN` | No | Access token lifetime (default `1h`) |
| `JWT_REFRESH_EXPIRES_IN` | No | Refresh token lifetime (default `7d`) |
| `ADMIN_USERNAME` | **Yes** | Username for the admin account created on first run |
| `ADMIN_PASSWORD` | **Yes** | Password for that admin account |
| `ADMIN_EMAIL` | No | Email tied to the admin account |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | No | Enables Telegram fraud alerts |
| `EMAIL_USER` / `EMAIL_PASS` | No | Gmail SMTP credentials for email fraud alerts |
| `BASE_URL` | **Yes** | Public base URL used to build the QR landing links (e.g. `https://your-domain.com`) |

> Never commit a real `.env` file. `.gitignore` already excludes it — only `backend/.env.example` (with empty values) is tracked.

---

## Roles & access

| Role | Panel | Can do |
|---|---|---|
| `admin` | `/admin` | Everything: events, promoters, groups, QR/flyer generation, suspensions, fraud review, reports |
| `jefe` (venue manager) | `/jefe` | Read-only: full event list, cross-event promoter ranking, PDF/CSV export |
| `rrpp` (promoter) | `/rrpp` | Personal dashboard: own active events, live ranking position, scan breakdown, achievement notifications |

---

## API overview

| Prefix | Router | Purpose |
|---|---|---|
| `/api/auth` | `routes/auth.js` | Login, token refresh, logout, profile, password change |
| `/api/rrpps` | `routes/rrpp.js` | Promoter CRUD, groups, suspensions |
| `/api/eventos` | `routes/eventos.js` | Event CRUD, promoter assignment, close/reopen |
| `/api/qrs` | `routes/qr.js` | Batch QR generation, listing, block/unblock |
| `/api/flyer` | `routes/flyer.js` | Overlay QRs onto a flyer template / generate digital flyer |
| `/api/panel` | `routes/panel.js` | Dashboards (admin/jefe/rrpp), event ranking, real-time scan feed |
| `/api/informes` | `routes/informes.js` | PDF report and CSV export per event |
| `/qr` | `routes/landing.js` | Public QR scan entry point, fingerprint claim, landing page |

All `/api/*` routes require a `Bearer` JWT except `/api/auth/login`. Download endpoints under `/api/informes` also accept the token as a `?token=` query parameter, since browsers can't attach an `Authorization` header to a direct download link.

---

## Project structure

```
FlyerTrack/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js          # SQLite schema definition & connection
│   │   ├── controllers/
│   │   │   ├── authController.js    # Login, JWT issuance, password change
│   │   │   ├── eventosController.js # Event CRUD & promoter assignment
│   │   │   ├── flyerController.js   # QR-to-flyer image/PDF compositing
│   │   │   ├── informesController.js# PDF/CSV report generation
│   │   │   ├── landingController.js # Public scan/claim flow + anti-fraud logic
│   │   │   ├── panelController.js   # Dashboards & ranking queries
│   │   │   ├── qrController.js      # Batch QR generation & blocking
│   │   │   └── rrppController.js    # Promoter & group CRUD
│   │   ├── middleware/
│   │   │   └── auth.js              # JWT verification & role guards
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── eventos.js
│   │   │   ├── flyer.js
│   │   │   ├── informes.js
│   │   │   ├── landing.js
│   │   │   ├── panel.js
│   │   │   ├── qr.js
│   │   │   └── rrpp.js
│   │   ├── utils/
│   │   │   ├── alertas.js           # Telegram / email fraud & backup alerts
│   │   │   ├── helpers.js           # ID generation, IP hashing, fingerprinting
│   │   │   └── historico.js         # Hourly backup export/import
│   │   └── index.js                 # App entry point — middleware & route wiring
│   ├── .env.example
│   ├── .gitignore
│   ├── Dockerfile
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── admin/index.html             # Admin panel (events, RRPPs, QRs, flyers, fraud)
│   ├── jefe/index.html              # Venue manager panel (read-only overview)
│   ├── rrpp/index.html              # Promoter personal dashboard
│   ├── login.html
│   └── assets/
│       ├── css/base.css             # Shared dark/light theme
│       └── js/api.js                # Fetch wrapper, JWT refresh, shared UI helpers
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── LICENSE
└── README.md
```

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
