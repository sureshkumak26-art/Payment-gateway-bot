# Anime Cloud Pay — ZapPay + Plisio Payment-Link Bot

Discord.js v14 + Express + MongoDB payment-link bot with ZapPay UPI and Plisio crypto checkout.

## Setup

```bash
git clone https://github.com/sureshkumak26-art/Payment-gateway-bot.git
cd Payment-gateway-bot
cp .env.example .env
npm install
```

Configure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGODB_URI`, `ZAPPAY_API_KEY`, `PLISIO_SECRET_KEY`, and `PUBLIC_BASE_URL`.

### ZapPay setup

```bash
npm run setup
```

### Plisio setup

```bash
npm run setup:plisio
```

The Plisio callback URL is:

```text
https://YOUR-PAYMENT-DOMAIN/api/plisio/webhook?json=true
```

Set this URL as the Plisio Status URL if you are not overriding it per invoice. `PUBLIC_BASE_URL` must be your own public HTTPS payment domain.

## Discord commands

- `/create-link amount description` — ZapPay UPI payment link
- `/create-crypto-link amount description currency` — Plisio crypto payment link; currency is optional
- `/transaction order_id` — Check UPI or crypto transaction
- `/stats` — Payment statistics
- `/status` — Bot/API/database/payment-provider status
- `/help` — Help menu

Plisio invoices are created through `https://api.plisio.net/api/v1/invoices/new` using INR as the source currency. Plisio sends invoice updates to the callback URL with a `verify_hash`; the bot validates that HMAC-SHA1 signature and re-checks a completed transaction through the Plisio transaction-details endpoint before marking it paid. citeturn1search0turn2search0

The application does **not** trust a browser redirect as payment proof.

## Production

Use HTTPS/reverse proxy and keep `.env` out of Git. Never put API keys or secret keys in source code. Keep the Plisio callback endpoint publicly reachable. Plisio documents the API secret key under its API settings. citeturn2search3turn0search0
