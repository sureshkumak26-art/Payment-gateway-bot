# Anime Cloud Pay — ZapPay Payment-Link Bot

Discord.js v14 + Express + MongoDB payment-link bot using ZapPay.

## Setup

```bash
git clone https://github.com/sureshkumak26-art/Payment-gateway-bot.git
cd Payment-gateway-bot
cp .env.example .env
npm install
npm start
```

Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `MONGODB_URI`, `ZAPPAY_API_KEY`, and an HTTPS `PUBLIC_BASE_URL`.

Commands:
- `/create-link amount description`
- `/transaction order_id`
- `/stats`

The application does **not** trust a browser redirect as payment proof. It verifies the order with ZapPay's server-side status endpoint before marking a transaction paid.

## Production

Use HTTPS/reverse proxy and keep `.env` out of Git. Do not put API keys in source code. Confirm your current ZapPay account's exact authentication and request payload fields before live use, because provider contracts can change.
