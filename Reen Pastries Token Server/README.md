# Reen Pastries Token Server

Backend API for the Reen Pastries bakery ordering app.  
Built with **Node.js + Express + Prisma + PostgreSQL**, hosted on **Railway**.

---

## Project Structure

```
Reen Pastries Token Server/
├── src/
│   ├── index.js                  # App entry point
│   ├── config/
│   │   ├── database.js           # Prisma client
│   │   ├── firebase.js           # Firebase Admin SDK
│   │   └── cloudinary.js         # Image uploads
│   ├── middleware/
│   │   └── auth.js               # Customer / Owner / Dev auth
│   ├── routes/
│   │   ├── auth.js               # Firebase sync, owner login, dev login
│   │   ├── products.js           # Product CRUD
│   │   ├── categories.js         # Category CRUD
│   │   ├── orders.js             # Order placement, cancel, status
│   │   ├── payments.js           # MPesa STK Push + Google Pay
│   │   ├── offers.js             # Promotions management
│   │   ├── owner.js              # Owner dashboard & notifications
│   │   ├── dev.js                # Developer console (private)
│   │   └── upload.js             # Image upload endpoints
│   └── services/
│       ├── orderService.js       # Core business logic
│       └── mpesaService.js       # Daraja API integration
├── prisma/
│   ├── schema.prisma             # Database models
│   └── seed.js                   # Initial data seed
├── .env.example                  # Environment variable template
├── railway.json                  # Railway deployment config
├── nixpacks.toml                 # Railway build config
└── package.json
```

---

## Setup Instructions

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd "Reen Pastries Token Server"
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
```

Fill in every value in `.env`. See the section below for where to get each one.

### 3. Database Setup

```bash
npx prisma generate        # Generate Prisma client
npx prisma db push         # Push schema to your database
npm run db:seed            # Seed default categories and config
```

### 4. Run Locally

```bash
npm run dev
```

Server starts on `http://localhost:3000`

Test health: `GET http://localhost:3000/health`

---

## Environment Variables Guide

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Railway → Your PostgreSQL service → Connect tab |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `DEV_JWT_SECRET` | Same as above, generate a different one |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts → Generate new key |
| `FIREBASE_PRIVATE_KEY` | Same JSON file from Firebase — copy the `private_key` field |
| `CLOUDINARY_CLOUD_NAME` | cloudinary.com → Dashboard |
| `CLOUDINARY_API_KEY` | cloudinary.com → Dashboard → API Keys |
| `CLOUDINARY_API_SECRET` | cloudinary.com → Dashboard → API Keys |
| `MPESA_CONSUMER_KEY` | developer.safaricom.co.ke → Your App |
| `MPESA_CONSUMER_SECRET` | developer.safaricom.co.ke → Your App |
| `MPESA_PASSKEY` | Safaricom → Lipa Na MPesa Online → Passkey |
| `MPESA_SHORTCODE` | Your Paybill or Till number (use `174379` for sandbox) |
| `MPESA_CALLBACK_URL` | Your Railway public URL + `/api/payments/mpesa/callback` |
| `OWNER_PASSWORD` | Set any strong password — this is what the management app uses |
| `DEV_CONSOLE_PASSWORD` | Your own private console password |
| `DEV_REVENUE_SHARE_PERCENT` | Your agreed percentage e.g. `5` |

---

## Deploying to Railway

### First Deploy

1. Push your code to GitHub (make sure `.env` is in `.gitignore`)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo
4. Add a **PostgreSQL** service from Railway's plugin marketplace
5. Go to your app's **Variables** tab and add all `.env` values
6. Railway auto-deploys on every push to main

### After First Deploy

The `railway.json` config runs `npm run db:migrate && npm start` on every deploy, so migrations apply automatically.

To run the seed on Railway:
```bash
railway run npm run db:seed
```

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/customer/sync` | Firebase token | Register/login customer |
| POST | `/api/auth/owner/login` | Password | Get owner JWT |
| POST | `/api/auth/dev/login` | Password | Get developer JWT |

### Products (public read, owner write)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/products` | None | List products (filter by category, search) |
| GET | `/api/products/:id` | None | Single product + reviews |
| POST | `/api/products` | Owner | Create product (multipart/form-data) |
| PATCH | `/api/products/:id` | Owner | Update product |
| DELETE | `/api/products/:id` | Owner | Soft-delete product |

### Orders

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/orders` | Customer | Place order |
| GET | `/api/orders/my` | Customer | Customer's order history |
| GET | `/api/orders/:id` | Customer | Single order |
| POST | `/api/orders/:id/cancel` | Customer | Cancel (within 30 min) |
| GET | `/api/orders` | Owner | All orders |
| PATCH | `/api/orders/:id/status` | Owner | Update order status |

### Payments

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/payments/mpesa/initiate` | Customer | Trigger STK Push |
| POST | `/api/payments/mpesa/callback` | None (Safaricom) | Webhook from Safaricom |
| GET | `/api/payments/mpesa/status/:id` | Customer | Poll payment status |
| POST | `/api/payments/google-pay/verify` | Customer | Verify Google Pay token |

### Offers

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/offers` | None | Active offers |
| GET | `/api/offers/all` | Owner | All offers (including inactive) |
| POST | `/api/offers` | Owner | Create offer |
| PATCH | `/api/offers/:id` | Owner | Update offer |
| DELETE | `/api/offers/:id` | Owner | Deactivate offer |

### Owner Console

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/owner/dashboard` | Owner | Dashboard stats + active orders |
| GET | `/api/owner/finances` | Owner | Revenue, her cut, monthly breakdown |
| POST | `/api/owner/fcm-token` | Owner | Register device for push notifications |
| GET | `/api/owner/notifications` | Owner | In-app notifications |

### Developer Console (Private)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/dev/overview` | Dev | Full system stats |
| GET | `/api/dev/revenue` | Dev | Revenue breakdown — your cut, her cut |
| GET | `/api/dev/users` | Dev | All customers |
| PATCH | `/api/dev/rate` | Dev | Update revenue share % |
| GET | `/api/dev/config` | Dev | View all system config |
| PATCH | `/api/dev/config/:key` | Dev | Update config value |
| POST | `/api/dev/suspend-user` | Dev | Suspend/reactivate a customer |

---

## Business Rules (Implemented in Code)

### 30-Minute Cancellation Window
- When an order is created, `cancelDeadline = createdAt + 30 minutes`
- The Flutter app reads this field to show/hide the cancel button
- The server also enforces this — a cancel request after the deadline returns a 400 error
- A cron job runs every minute to auto-cancel PENDING orders that haven't paid their deposit within 2 hours

### 50% Deposit
- On order creation, `depositAmount = totalAmount * 0.5`
- The order status stays `PENDING` until the deposit is paid
- Once MPesa/Google Pay confirms payment, status moves to `DEPOSIT_PAID`
- Owner gets a push notification immediately when deposit lands
- Remaining 50% is collected on delivery

### Revenue Share
- Every order records `devShareAmount` and `devShareRate` at the time of ordering
- This means historical records are preserved even if you change the rate later
- The current rate is stored in `DevConfig` and can be updated via `/api/dev/rate`
- Owner's `/finances` endpoint shows total revenue and dev share separately so she's always informed

---

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Database**: PostgreSQL (Railway)
- **ORM**: Prisma
- **Auth**: Firebase Admin SDK (customers) + JWT (owner & dev)
- **Image Storage**: Cloudinary
- **Payments**: Safaricom Daraja API (MPesa) + Google Pay
- **Push Notifications**: Firebase Cloud Messaging
- **Hosting**: Railway
- **Scheduled Jobs**: node-cron

---

*Reen Pastries Token Server — Built with care 🎂*
