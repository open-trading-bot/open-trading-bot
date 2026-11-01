# open-trading-bot

An algorithmic crypto trading bot for [Bybit](https://www.bybit.com). It has a dashboard for users and a backoffice for admins.

> **Disclaimer:** Use this software only for education and research. It is **not financial advice**.
> Crypto trading has a high risk of loss. You use this software at your own risk.
> The authors are not responsible for financial losses. Always start in **paper mode** or on the **Bybit testnet**.

## Features

- **Trading engine:** runs the strategies at a fixed interval (one "tick"). Strategies: MA crossover, RSI, MACD, Bollinger Bands, Wyckoff. A trade opens only above a minimum confidence.
- **Risk management:** stop loss, daily loss limit, maximum open positions, kill switch
- **Paper mode and live mode.** The bot can also use the Bybit testnet.
- **Backtests** on historical market data
- **Dashboard:** positions, strategies, backtests
- **Backoffice:** users, roles, invitations, feature flags

## Project structure

```
server/      API and trading engine (Node.js, TypeScript)
client/      Dashboard for users (React, Vite, Tailwind)
backoffice/  Backoffice for admins (React, Vite, Tailwind)
common/      Code and types that the other packages share
docker/      Dockerfile, docker-compose and nginx configs
scripts/     Scripts to start, set up and deploy the bot
```

## Quick start (local)

Requirements: Node.js 22 or later, npm.

```bash
git clone https://github.com/open-trading-bot/open-trading-bot.git
cd open-trading-bot
npm install --legacy-peer-deps
cp server/.env.example server/.env   # then edit the values
npm run dev
```

- Server: http://localhost:3001
- Dashboard: http://localhost:5173
- Backoffice: http://localhost:5174

## Start with an AI coding assistant

An AI coding assistant can install, configure and start the app for you, for example Claude Code. The prompt below starts the app in paper mode only.

1. Open the assistant in the folder of this repository.
2. Copy the text in the block below.
3. Paste the text into the assistant.

```text
Start the open-trading-bot app on this computer in paper mode. Do these steps in sequence.

1. Make sure that this computer has Node.js 22 or later and npm. If one of them is missing, stop and tell me.
2. In the repository root, run: npm install --legacy-peer-deps
3. Make sure that this file exists: node_modules/better-sqlite3/build/Release/better_sqlite3.node
   If the file does not exist, go to node_modules/better-sqlite3 and run: npx prebuild-install
4. If the file server/.env exists, do not change it. Go to step 7.
5. Copy server/.env.example to server/.env.
6. In server/.env, set these values:
   - API_KEY: the output of: openssl rand -hex 32
   - JWT_SECRET: a new output of: openssl rand -hex 32
   - EXCHANGE_KEYS_ENC_KEY: a new output of: openssl rand -hex 32
   - ADMIN_PASS: a random password with a minimum of 12 characters. Use an uppercase letter, a digit and a symbol.
   - BOT_MODE=paper
   - BYBIT_TESTNET=true
   - Keep BYBIT_API_KEY and BYBIT_API_SECRET empty.
7. In the repository root, run: npm run dev
   Keep this process running.
8. Send a request to http://localhost:3001/api/health every 2 seconds. Stop when the status is 200, or after 60 seconds.
9. Make sure that http://localhost:5173 and http://localhost:5174 return a page.
10. Give me this information:
    - The URL of the dashboard, the backoffice and the server.
    - The admin username. It is the ADMIN_USER value in server/.env. The default is admin.
    - The location of the admin password: server/.env.
    Do not write a secret in the chat.

Rules:
- Do not set BOT_MODE=live.
- Do not add exchange API keys.
- Do not commit server/.env or a different file that contains a secret.
- Do not change the source code to make the app start. If a step fails, stop and show me the error.
```

## Configuration

The server does not start without `API_KEY`, `JWT_SECRET`, `EXCHANGE_KEYS_ENC_KEY` and `ADMIN_PASS`.

| Variable | Description |
|---|---|
| `BOT_MODE` | `paper` (default) or `live` |
| `BYBIT_API_KEY`, `BYBIT_API_SECRET` | Bybit API credentials |
| `BYBIT_TESTNET` | `true` to use the Bybit testnet |
| `PORT` | Server port (default `3001`) |
| `API_KEY` | Random string for API access |
| `JWT_SECRET` | Random secret that signs login tokens |
| `EXCHANGE_KEYS_ENC_KEY` | Key that encrypts the exchange API keys of the users in the database. Use 64 hex characters. Make the key with `openssl rand -hex 32`. Keep a backup of the key. If you lose the key, the users must add their exchange API keys again. |
| `EXCHANGE_KEYS_ENC_KEY_PREVIOUS` | The old `EXCHANGE_KEYS_ENC_KEY` during a key rotation (optional). Refer to [Rotate the exchange-key encryption key](#rotate-the-exchange-key-encryption-key). |
| `ADMIN_USER`, `ADMIN_PASS` | Username and password of the backoffice admin |
| `SEED_DEMO_USERS` | `true` creates the demo users `demo/demo` and `user/user`. Use only for local tests. Default: `false` |
| `TRADE_AMOUNT` | Amount per trade |
| `STOP_LOSS_PCT` | Stop loss, in percent |
| `DAILY_LOSS_LIMIT` | The bot stops trading for the day after this loss |
| `MAX_OPEN_POSITIONS` | Maximum number of open positions |
| `MIN_CONFIDENCE` | Minimum strategy confidence needed to open a trade |
| `TICK_INTERVAL` | Time between two ticks, in seconds. Minimum: `10` |
| `LOG_LEVEL` | Log level: `error`, `warn`, `info` (default) or `debug`. Refer to [Logs](#logs). |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email settings for user invitations (optional) |
| `PUBLIC_APP_URL` | Base URL of the dashboard. Invitation links use this URL. |
| `RECAPTCHA_SECRET_KEY`, `VITE_RECAPTCHA_SITE_KEY` | reCAPTCHA on login (optional) |
| `TRUST_PROXY` | Proxies that can set the client IP (Express `trust proxy`). Default: private networks only. Set it when a proxy outside your network is in front of the server. |
| `GIT_COMMIT_SHA` | Build version that the UI shows (optional) |

Use long random values for the secrets. Example: `openssl rand -hex 32`.

The server checks the secrets when it starts. It does not start in these conditions:

- A secret still contains `change-me` from the example env file.
- `API_KEY` or `JWT_SECRET` has fewer than 32 characters.
- `ADMIN_PASS` has fewer than 12 characters.
- `EXCHANGE_KEYS_ENC_KEY` is not 64 hex characters.

### Upgrade from a version without `EXCHANGE_KEYS_ENC_KEY`

Old versions encrypted the exchange API keys with a key from `JWT_SECRET`. The server now uses `EXCHANGE_KEYS_ENC_KEY` for these keys.

1. Make a backup of the database file `server/data/trading.db`. With Docker, the file is `data/trading.db` in the `server-data` volume.
2. Make a new key with `openssl rand -hex 32`.
3. Set the key in `EXCHANGE_KEYS_ENC_KEY`.
4. Do not change `JWT_SECRET` before the first start.
5. Start the server. The server encrypts the stored exchange API keys again with the new key. The log shows the number of users.
6. Look for warnings in the log. A warning shows the ID of a user whose keys the server cannot read. This user must add the exchange API keys again.
7. You can now change `JWT_SECRET`. The exchange API keys do not use `JWT_SECRET` after the first start.

### Rotate the exchange-key encryption key

1. Make a new key with `openssl rand -hex 32`.
2. Move the current value of `EXCHANGE_KEYS_ENC_KEY` to `EXCHANGE_KEYS_ENC_KEY_PREVIOUS`.
3. Set the new key in `EXCHANGE_KEYS_ENC_KEY`.
4. Start the server. The server encrypts the stored exchange API keys again with the new key.
5. Look for warnings in the log.
6. Remove `EXCHANGE_KEYS_ENC_KEY_PREVIOUS`.

### Logs

The server writes the log to the console and to files in the `logs/` directory.

- `combined-<date>.log` contains all messages at `LOG_LEVEL` and higher.
- `error-<date>.log` contains only errors.
- The server starts a new file each day. It also starts a new file when the file is 50 MB (20 MB for the error log).
- The server keeps the 20 newest files of each log and removes older files. Thus the combined log uses a maximum of 1 GB of disk space.

At `info`, each tick of a bot writes one line. The line shows the user, the number of assets, signals and orders, the number of errors and the duration. An API request that fails with a 4xx status writes a warning. An API request that fails with a 5xx status writes an error.

Set `LOG_LEVEL=debug` to also see each candle fetch, each strategy signal and each successful API request.

## Running with Docker

```bash
cp .env.example docker/.env.production   # then edit the values
cd docker
docker compose up --build -d
```

- Dashboard: port `80`
- Backoffice: port `8080`

To deploy to your own server over SSH:

1. Install Docker on the server: `ssh user@host 'bash -s' < scripts/setup-server.sh`
2. Run `./scripts/deploy.sh user@host` to deploy the bot.

## Tests

```bash
cd server && npm test
```

## Contributing

Contributions are welcome.

- To ask a question, use [Q&A in Discussions](https://github.com/open-trading-bot/open-trading-bot/discussions/categories/q-a).
- Before you start a large change, open an issue to discuss it.
- Keep pull requests small.

## Security

Do not report vulnerabilities in public issues. Read [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
