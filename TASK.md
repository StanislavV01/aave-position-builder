# Take-home assignment: Aave V3 position builder

## Overview

Build a small web application that lets a user open a borrow position on the Aave V3 protocol: the user supplies one asset as collateral and borrows another asset against it.

The goal: the user should be able to open their position **in the most optimal way possible**. What "optimal" means is a part of the task. Build the UI/UX in the way you think fits best to solve it.

Feel free to ask us questions at any point during the week — reach out via telegram.

## Networks

The app must support both **Base** and **Base Sepolia**.

- We will test your submission on **Base Sepolia**. Base mainnet only needs to work via configuration — you don't need real funds, but you can request some from us if you want to test on Base yourself.
- You need Base Sepolia ETH for gas; get it from a public faucet (e.g. https://www.alchemy.com/faucets/base-sepolia).
- Aave testnet tokens are freely mintable. If you get stuck obtaining any token, ping us and we'll just send you some.
- Note that a public testnet is shared infrastructure and occasionally has quirks. If something on-chain behaves in a way you don't expect, ask us.

## Functional requirements

- The user sees the assets that can be supplied and the assets that can be borrowed on the current network.
- The user can open a position: supply one asset as collateral and borrow another asset against it — in the most optimal way possible.
- The user sees a summary of their position: supplied assets, borrowed assets, health factor.
- The position summary reflects changes in real time. If the position changes — for example, the user makes a transaction from a different tab or wallet — the UI shows it within seconds of on-chain confirmation, without the user refreshing the page.

Scope bounds:

- When opening a position, you may assume the wallet has no existing Aave position. The position summary must handle any real position.
- ERC-20 assets only; handling native ETH is not required.
- One injected wallet (e.g. MetaMask or Rabby) is enough, you can use any OSS library for wallet connection.

## Technical requirements

- The frontend must be built with React. Everything else — framework, state management, styling, wallet library, backend stack — is your choice.
- We will give you a paid RPC API key from DRPC. This key must not be exposed in the frontend code or in the browser in any way. Structure your solution accordingly.
- You may use any libraries, SDKs, references, and AI tools.

## What we will look at

- The product and architecture decisions you made and your reasons for them. Depth of reasoning matters more to us than breadth of features — a smaller scope with well-thought-out decisions beats a broad, shallow one.
- The data flow, backend-related decisions, and the real-time update mechanism.
- How the app behaves when things don't go smoothly.

## What we do not expect

- Production-grade deployment, monitoring, or test coverage of everything. A few tests in the places you consider important are welcome.
- Support for repaying, withdrawing, or closing positions. Only opening and viewing a position is required.
- Transactions on mainnet with your own real funds (we'll test your solution on Base with real funds though).

## Practical details

- Time limit: one week from receiving the task. The task is designed to take roughly 1–3 focused days; the week is for scheduling flexibility.
- Deliverables: a link to a git repository with the code, a README with setup instructions that work from a clean clone, and a short written summary (half a page is fine) of the key decisions you made and why. The summary will serve as the agenda for the review call.

## Useful links

- Aave documentation: https://aave.com/docs
- Aave address book (also published as the `@bgd-labs/aave-address-book` npm package): https://github.com/aave-dao/aave-address-book, alternatively you can use: https://search.tools.aave.com
- Aave V3 protocol source code: https://github.com/aave-dao/aave-v3-origin
- Icons: https://github.com/bgd-labs/icons
