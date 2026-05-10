# Telegram to Google Apps Script Proxy

Telegram does not accept the `302 Moved Temporarily` response that Google Apps Script web apps often return before redirecting to `script.googleusercontent.com`.

This Cloudflare Worker receives Telegram webhook updates, immediately responds with `200 OK`, and forwards the update body to the Apps Script web app in the background.

## Files

- `src/index.js`: Worker code
- `wrangler.toml`: Worker config with the current Apps Script URL
- `package.json`: Wrangler scripts

## Deploy

Run these commands in this folder:

```powershell
npm.cmd install
npx.cmd wrangler login
npx.cmd wrangler deploy
```

After deploy, Wrangler prints a Worker URL like:

```text
https://telegram-apps-script-proxy.<your-subdomain>.workers.dev
```

Open that URL in a browser. It should return JSON with `"health":"alive"`.

## Register Telegram Webhook

First drop old pending updates:

```text
https://api.telegram.org/bot<봇토큰>/deleteWebhook?drop_pending_updates=true
```

Then register the Worker URL, not the Apps Script URL:

```text
https://api.telegram.org/bot<봇토큰>/setWebhook?url=<WorkerURL>&drop_pending_updates=true
```

Check:

```text
https://api.telegram.org/bot<봇토큰>/getWebhookInfo
```

Expected:

- `url` is the Worker URL
- `pending_update_count` is `0`
- no `last_error_message`

## Optional Secret

If Apps Script has `WEBHOOK_SECRET` set in Script Properties, set the same value as a Cloudflare Worker secret:

```powershell
npx wrangler secret put WEBHOOK_SECRET
```

The Worker will forward it as `?secret=...` to Apps Script.
