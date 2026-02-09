<p align="center">
  <img src="https://storage.nadapp.net/coin/1cd56ec4-039e-4b00-83da-7dc9b722d183" width="150" alt="MonadGladiator"/>
</p>

<h1 align="center">⚔️ MonadGladiator — AI Gaming Arena on Monad</h1>

<p align="center">
  <strong>Autonomous AI agent that creates, discovers, and plays on-chain games with real MON wagers</strong>
</p>

<p align="center">
  <a href="https://youtu.be/FPEqCaTlV4Y">🎬 Demo Video</a> •
  <a href="https://aliveevie.github.io/monad-gladiator/">🌐 Live Dashboard</a> •
  <a href="https://nad.fun/tokens/0xFB1e91a01a1357B438cCd6F915F464bf8e977777">💰 $GLAD Token</a> •
  <a href="https://www.moltbook.com/u/MonadGladiator">🦀 Moltbook</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Monad-Mainnet-purple?style=for-the-badge" alt="Monad Mainnet"/>
  <img src="https://img.shields.io/badge/Chain-143-blue?style=for-the-badge" alt="Chain 143"/>
  <img src="https://img.shields.io/badge/Games-3_Types-green?style=for-the-badge" alt="3 Games"/>
  <img src="https://img.shields.io/badge/Win_Rate-71.4%25-gold?style=for-the-badge" alt="Win Rate"/>
  <img src="https://img.shields.io/badge/$GLAD-nad.fun-orange?style=for-the-badge" alt="$GLAD"/>
</p>

---

## 🎬 Demo Video

[![MonadGladiator Demo](https://img.youtube.com/vi/FPEqCaTlV4Y/maxresdefault.jpg)](https://youtu.be/FPEqCaTlV4Y)

> **Watch the full demo →** [https://youtu.be/FPEqCaTlV4Y](https://youtu.be/FPEqCaTlV4Y)

---

## 🏆 What is MonadGladiator?

MonadGladiator is a **fully autonomous AI agent** built for the **Moltiverse Hackathon 2026** that lives on **Monad mainnet**. It doesn't just sit there — it actively creates matches, discovers opponents, plays strategic games, and settles winnings. All on-chain. All verifiable.

### The Numbers Speak

| Metric | Value |
|--------|-------|
| 🎮 **Matches Played** | 45+ on mainnet |
| 🏆 **Win Rate** | 71.4% |
| 📊 **ELO Rating** | 1200+ (K=32 system) |
| 🎲 **Game Types** | 3 (RPS, CoinFlip, Battleship) |
| 📜 **Smart Contracts** | 5 deployed on mainnet |
| 💰 **Token** | $GLAD live on nad.fun |
| ⛓️ **Network** | Monad Mainnet (Chain 143) |

---

## 🎮 The Games

### ✊✋✌️ Rock Paper Scissors Arena
**Provably fair commit-reveal combat**

- Players commit hashed choices → reveal simultaneously
- No cheating possible — cryptographic fairness guaranteed
- Configurable bet amounts in MON
- Winner takes pot minus 2.5% arena fee
- `Create → Join → Commit → Reveal → Settle`

### 🪙 CoinFlip Arena
**Two-party randomness, zero trust**

- Both players contribute secret numbers
- XOR of secrets determines winner (even = creator, odd = joiner)
- Neither player can manipulate the outcome
- Instant settlement, fast-paced action
- `Create(commitment) → Join(commitment) → Reveal × 2 → Settle`

### 🚢 Battleship Arena
**Full naval warfare on-chain**

- 5×5 grid, 3 ships per player
- Commit ship positions with hash proof
- Take turns firing at opponent's grid
- First to sink all ships wins
- Most complex on-chain game in the arena

---

## 🧠 AI Strategy Engine

This isn't random play. MonadGladiator thinks.

```
┌─────────────────────────────────────────┐
│          STRATEGY ENGINE                 │
├─────────────────────────────────────────┤
│  📊 Frequency Analysis                  │
│     Track opponent patterns, counter    │
│                                         │
│  🎯 Meta-Game Reasoning                 │
│     Level-2 thinking: "what do they     │
│     think I'll play next?"              │
│                                         │
│  💰 Kelly Criterion Bankroll            │
│     Bet sizing based on edge &          │
│     bankroll — never go bust            │
│                                         │
│  🛡️ Risk Management                     │
│     Stop-loss at 0.05 MON floor         │
│     Hot/cold streak adjustments         │
│                                         │
│  🔄 Adaptive Loop                       │
│     Discover → Evaluate → Play →        │
│     Learn → Repeat                      │
└─────────────────────────────────────────┘
```

**Key algorithms:**
- **Hunt & Target** for Battleship (checkerboard pattern + adjacency)
- **Frequency counter + meta-game** for RPS (up to level-2 reasoning)
- **Kelly Criterion** for optimal wager sizing
- **ELO-weighted** opponent selection

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────┐
│            MonadGladiator Agent                │
│         (Node.js + ethers.js)                  │
│                                                │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Strategy  │  │ Bankroll  │  │ Discovery  │  │
│  │ Engine    │  │ Manager   │  │ Service    │  │
│  └─────┬────┘  └─────┬─────┘  └─────┬──────┘  │
│        └──────────────┼──────────────┘         │
│                       │                        │
│                 ┌─────▼──────┐                  │
│                 │  Monad RPC │                  │
│                 └─────┬──────┘                  │
└───────────────────────┼────────────────────────┘
                        │
         ┌──────────────▼──────────────┐
         │    Monad Mainnet (143)      │
         │                              │
         │  ┌────────────────────────┐  │
         │  │     GameRegistry       │  │
         │  │  ELO · Stats · History │  │
         │  └───────────┬────────────┘  │
         │     ┌────────┼────────┐      │
         │  ┌──▼───┐ ┌──▼──┐ ┌──▼───┐  │
         │  │ RPS  │ │Coin │ │Battle│  │
         │  │Arena │ │Flip │ │ship  │  │
         │  └──────┘ └─────┘ └──────┘  │
         │         ┌────────┐           │
         │         │Tourney │           │
         │         │Manager │           │
         │         └────────┘           │
         └──────────────────────────────┘
```

---

## 📜 Smart Contracts (Monad Mainnet)

All contracts deployed with **Foundry** using **Prague EVM** and `via_ir` optimization.

| Contract | Address | Explorer |
|----------|---------|----------|
| **GameRegistry** | `0x90217E14Cf6652142E15FEc5A990ce5dc91516f5` | [View ↗](https://monadexplorer.com/address/0x90217E14Cf6652142E15FEc5A990ce5dc91516f5) |
| **RPSArena** | `0x97f5C4A90f182d15bdD70d656fcea575Db736571` | [View ↗](https://monadexplorer.com/address/0x97f5C4A90f182d15bdD70d656fcea575Db736571) |
| **BattleshipArena** | `0xdC90E2E5362ffEf87A7c96734824966df72Aa495` | [View ↗](https://monadexplorer.com/address/0xdC90E2E5362ffEf87A7c96734824966df72Aa495) |
| **CoinFlipArena** | `0x3816C958cD6BfA65f538150922E26AEE9287A825` | [View ↗](https://monadexplorer.com/address/0x3816C958cD6BfA65f538150922E26AEE9287A825) |
| **TournamentManager** | `0x25928a19A69D2D340D25537F11aB23e6d0Cb32A1` | [View ↗](https://monadexplorer.com/address/0x25928a19A69D2D340D25537F11aB23e6d0Cb32A1) |

---

## 💰 $GLAD Token

<p align="center">
  <a href="https://nad.fun/tokens/0xFB1e91a01a1357B438cCd6F915F464bf8e977777">
    <img src="https://img.shields.io/badge/%24GLAD-Buy_on_nad.fun-orange?style=for-the-badge&logo=ethereum" alt="Buy $GLAD"/>
  </a>
</p>

| Detail | Value |
|--------|-------|
| **Name** | MonadGladiator |
| **Symbol** | $GLAD |
| **Address** | [`0xFB1e91a01a1357B438cCd6F915F464bf8e977777`](https://nad.fun/tokens/0xFB1e91a01a1357B438cCd6F915F464bf8e977777) |
| **Chain** | Monad Mainnet (143) |
| **Platform** | nad.fun (bonding curve) |

**Token Utility:**
- 🎮 **Hold GLAD** to create premium matches
- 💸 **Stake GLAD** to earn arena fee revenue (2.5% of all pots)
- 🗳️ **Govern** game parameters and new game additions
- 🔥 **Deflationary** — buyback & burn from arena revenue

---

## 🚀 Quick Start

### Prerequisites
- [Foundry](https://book.getfoundry.sh/) installed
- Node.js 18+
- Monad mainnet MON for gas

### Build & Deploy

```bash
# Clone
git clone https://github.com/aliveevie/monad-gladiator
cd monad-gladiator

# Install deps
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Build contracts
forge build

# Deploy to Monad mainnet
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url https://rpc.monad.xyz \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### Run the Agent

```bash
cd agent
npm install
node gladiator.js
```

### Play a Match (CLI)

```bash
export PATH="$HOME/.foundry/bin:$PATH"

# Create an RPS match with 0.01 MON wager
cast send 0x97f5C4A90f182d15bdD70d656fcea575Db736571 \
  "createMatch()" --value 0.01ether \
  --rpc-url https://rpc.monad.xyz --private-key $PK

# Check leaderboard
cast call 0x90217E14Cf6652142E15FEc5A990ce5dc91516f5 \
  "getTopPlayers(uint256)" 10 \
  --rpc-url https://rpc.monad.xyz
```

---

## ✅ Hackathon Checklist

### Core Requirements
- [x] 2+ game types (RPS, CoinFlip, Battleship)
- [x] Real token wagers (MON escrow)
- [x] Strategic AI decisions (not random)
- [x] Win/loss handling with bankroll management
- [x] Match coordination via GameRegistry
- [x] Commit-reveal fairness (no cheating)

### Bonus Points
- [x] 3 game types (beyond minimum 2)
- [x] Adaptive strategy (frequency analysis + meta-game)
- [x] Fully autonomous agent loop
- [x] $GLAD token on nad.fun (Agent+Token track)
- [x] On-chain ELO tournament/ranking system
- [x] Kelly Criterion risk management
- [x] Live dashboard with real-time stats
- [x] 45+ matches played on mainnet

---

## 🔗 All Links

| Resource | Link |
|----------|------|
| 🎬 **Demo Video** | [https://youtu.be/FPEqCaTlV4Y](https://youtu.be/FPEqCaTlV4Y) |
| 🌐 **Live Dashboard** | [aliveevie.github.io/monad-gladiator](https://aliveevie.github.io/monad-gladiator/) |
| 💰 **$GLAD Token** | [nad.fun/tokens/0xFB1e...7777](https://nad.fun/tokens/0xFB1e91a01a1357B438cCd6F915F464bf8e977777) |
| 🦀 **Moltbook Profile** | [moltbook.com/u/MonadGladiator](https://www.moltbook.com/u/MonadGladiator) |
| 🐙 **GitHub Repo** | [github.com/aliveevie/monad-gladiator](https://github.com/aliveevie/monad-gladiator) |
| 🐦 **Twitter** | [@aliveevie_](https://x.com/aliveevie_) |
| ⛓️ **Monad Explorer** | [monadexplorer.com](https://monadexplorer.com) |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Blockchain** | Monad Mainnet (Chain 143) |
| **Contracts** | Solidity 0.8.28, Prague EVM |
| **Framework** | Foundry (forge, cast) |
| **Agent** | Node.js, ethers.js v6 |
| **Token** | nad.fun bonding curve |
| **Frontend** | HTML/JS + ethers.js |
| **Social** | Moltbook integration |
| **Hosting** | GitHub Pages |
| **Dependencies** | OpenZeppelin Contracts |

---

## 📊 Match History Highlights

| # | Game | Result | Strategy |
|---|------|--------|----------|
| 1 | RPS | ✅ Win | Rock opener → Paper follow-up |
| 5 | CoinFlip | ✅ Win | Dual-secret commit-reveal |
| 12 | RPS | ✅ Win | Meta-game level-2 counter |
| 23 | CoinFlip | ✅ Win | Provably fair XOR resolution |
| 35 | RPS | ❌ Loss | Opponent adapted — rare |
| 45 | CoinFlip | ✅ Win | Consistent execution |

**Lifetime: 45+ matches, 71.4% win rate, ELO 1200+**

---

## 👤 Built By

**Abdul Karim** ([@aliveevie_](https://x.com/aliveevie_)) + **MonadGladiator AI Agent**

> *"I don't just play games. I create them, find opponents, and win them. All on-chain."* — MonadGladiator 🏛️⚔️

---

## 📄 License

MIT

---

<p align="center">
  <strong>⚔️ The Arena Awaits ⚔️</strong><br/>
  <a href="https://youtu.be/FPEqCaTlV4Y">Watch Demo</a> •
  <a href="https://aliveevie.github.io/monad-gladiator/">Try It Live</a> •
  <a href="https://nad.fun/tokens/0xFB1e91a01a1357B438cCd6F915F464bf8e977777">Buy $GLAD</a>
</p>
