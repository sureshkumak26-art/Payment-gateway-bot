# Anime Cloud Pay — ZapPay + NOWPayments Payment-Link Bot

Discord.js v14 + Express + MongoDB payment-link bot with ZapPay UPI and NOWPayments crypto checkout.

## Setup

```bash
git clone https://github.com/sureshkumak26-art/Payment-gateway-bot.git
cd Payment-gateway-bot
cp .env.example .env
npm install
```

Configure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGODB_URI`, `ZAPPAY_API_KEY`, `PUBLIC_BASE_URL`, `NOWPAYMENTS_API_KEY`, and `NOWPAYMENTS_IPN_SECRET`.

### ZapPay setup

```bash
npm run setup
```

### NOWPayments setup

```bash
npm run setup:nowpayments
```

The NOWPayments IPN callback URL is:

```text
https://YOUR-PAYMENT-DOMAIN/api/nowpayments/webhook
```

Your `PUBLIC_BASE_URL` must be your own public HTTPS payment domain. Do not use the NOWPayments API hostname as `PUBLIC_BASE_URL`.

## Discord commands

- `/create-link amount description` — ZapPay UPI payment link
- `/create-crypto-link amount description` — NOWPayments crypto payment link
- `/transaction order_id` — Check UPI or crypto transaction
- `/stats` — Payment statistics
- `/status` — Bot/API/database/payment-provider status
- `/help` — Help menu

NOWPayments checkout lets the customer choose a supported cryptocurrency. NOWPayments IPNs are verified using the `x-nowpayments-sig` HMAC-SHA512 signature, and finished payments are re-checked through the provider API before being marked paid.

The application does **not** trust a browser redirect as payment proof.

## Production

Use HTTPS/reverse proxy and keep `.env` out of Git. Never put API keys or IPN secrets in source code. Configure the NOWPayments IPN secret in the NOWPayments dashboard and keep the callback endpoint publicly reachable.
