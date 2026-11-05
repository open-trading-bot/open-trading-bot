# Contributing

Contributions are welcome. This file shows how to set up the project and how to send a change.

## Before you start

- To ask a question, use [Q&A in Discussions](https://github.com/open-trading-bot/open-trading-bot/discussions/categories/q-a).
- To find a small task, look at the issues with the label [`good first issue`](https://github.com/open-trading-bot/open-trading-bot/labels/good%20first%20issue).
- Before you start a large change, open an issue to discuss it.
- Do not report security vulnerabilities in public issues. Read [SECURITY.md](SECURITY.md).

## Set up the project

Requirements: Node.js 22 or later, npm.

```bash
git clone https://github.com/open-trading-bot/open-trading-bot.git
cd open-trading-bot
npm install --legacy-peer-deps
cp server/.env.example server/.env   # then edit the values
npm run dev
```

## Test safely

- Use **paper mode** or the **Bybit testnet**.
- Do not use an exchange account that contains real funds.
- Do not put API keys, secrets or account details in commits, issues or pull requests.

## Check your change

Run these commands from the repository root. CI runs the same commands on each pull request.

```bash
npm test
npm run build
npm run build --workspace backoffice
```

CI does not run the linter at this time, because the dashboard has old lint errors. Do not add new lint errors. To see them, run `npx eslint .` in the `client` directory.

## Rules for trading code

A mistake in trading code can cause a financial loss. Apply these rules to the strategies, the risk management and the order code.

- Add a test for each change in behavior.
- Use closed candles only. A strategy must ignore the candle that is still open.
- Do not change a default risk value without a reason in the pull request.

## Send a pull request

All changes to `main` go through a pull request.

1. Make a branch from `main`.
2. Make one change. Keep the pull request small.
3. Write the commit message as a command. Example: `Add tests for the client WebSocket connection`.
4. Update the README if the change affects the setup or the behavior.
5. Open the pull request and complete the checklist.

Write documentation in short, simple sentences. Use one instruction in each sentence. The project follows the [ASD-STE100](https://www.asd-ste100.org) style.

## Code of conduct

Read the [code of conduct](CODE_OF_CONDUCT.md). It applies to all project spaces.

## License

You agree that your contribution uses the [MIT license](LICENSE) of this project.
