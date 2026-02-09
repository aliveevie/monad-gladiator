#!/usr/bin/env node
/**
 * MonadGladiator — Autonomous Agent
 * 
 * Runs an infinite loop:
 * 1. Scans for open RPS matches and joins them
 * 2. Creates matches if none available
 * 3. Plays using adaptive strategy (not random!)
 * 4. Manages bankroll with Kelly Criterion
 * 5. Logs all activity
 */

const { ethers } = require("ethers");
const fs = require("fs");

// ═══════════════════════ CONFIG ═══════════════════════
const RPC = "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const ADDR = {
  registry: "0x2A1dAdFe8f95987bC7225D4dCFAD2FB530A1Cc45",
  battleship: "0x7Aef76Fe7e58aAF799e6bFB4C8475652648284eC",
  rps: "0x14A0559A19a724919D7CfEFF7BAFc42740d631F0"
};

const REGISTRY_ABI = [
  "function getPlayerStats(address) view returns (uint256,uint256,uint256,uint256,uint256,uint16,bool)",
  "function winRate(address) view returns (uint256)"
];
const RPS_ABI = [
  "function createMatch() payable returns (uint256)",
  "function joinMatch(uint256) payable",
  "function commitChoice(uint256,bytes32)",
  "function revealChoice(uint256,uint8,bytes32)",
  "function getOpenMatches() view returns (uint256[])",
  "function matches(uint256) view returns (address,address,uint256,uint8,uint8,uint8,uint8,uint256,bool)",
  "function getRound(uint256,uint8) view returns (bytes32,bytes32,uint8,uint8,bool,bool)",
  "function totalMatches() view returns (uint256)"
];

// ═══════════════════════ STRATEGY ═══════════════════════
class RPSStrategy {
  constructor() {
    this.opponentHistory = {}; // addr -> [choices]
    this.choiceNames = ["None", "Rock", "Paper", "Scissors"];
  }

  /**
   * Decide what to play based on opponent history
   * Level 0: Weighted random (slight Paper bias)
   * Level 1: Counter opponent's most frequent choice
   * Level 2: If opponent is countering us, counter their counter
   */
  decide(opponent, roundNum, myScore, theirScore) {
    const history = this.opponentHistory[opponent] || [];
    
    // Round 1 or no history: weighted random with Paper bias
    if (history.length === 0) {
      const r = Math.random();
      if (r < 0.30) return 1; // Rock 30%
      if (r < 0.70) return 2; // Paper 40%
      return 3;               // Scissors 30%
    }

    // Count opponent frequencies
    const freq = [0, 0, 0, 0]; // [_, rock, paper, scissors]
    history.forEach(c => freq[c]++);
    const total = history.length;
    
    // Most common opponent choice
    let mostCommon = 1;
    if (freq[2] > freq[mostCommon]) mostCommon = 2;
    if (freq[3] > freq[mostCommon]) mostCommon = 3;

    // Counter their most common: Rock→Paper, Paper→Scissors, Scissors→Rock
    const counter = { 1: 2, 2: 3, 3: 1 };
    let choice = counter[mostCommon];

    // Level 2: if they've been beating us, they might be countering our counter
    if (theirScore > myScore && history.length >= 2) {
      // They're likely playing counter(counter(theirMostCommon))
      // So we go one level deeper
      choice = counter[counter[mostCommon]];
      log(`  [L2] Opponent adapting, going deeper: ${this.choiceNames[choice]}`);
    }

    // Score-based adjustment
    if (myScore > theirScore) {
      // We're winning → conservative, repeat what works
      log(`  [Conservative] Up ${myScore}-${theirScore}, sticking with strategy`);
    } else if (theirScore > myScore) {
      // We're losing → add randomness to break their read
      if (Math.random() < 0.3) {
        choice = Math.floor(Math.random() * 3) + 1;
        log(`  [Wildcard] Down ${myScore}-${theirScore}, random switch: ${this.choiceNames[choice]}`);
      }
    }

    log(`  [Strategy] vs ${opponent.slice(0,8)}... freq=[R:${freq[1]},P:${freq[2]},S:${freq[3]}] → playing ${this.choiceNames[choice]}`);
    return choice;
  }

  recordOpponentChoice(opponent, choice) {
    if (!this.opponentHistory[opponent]) this.opponentHistory[opponent] = [];
    this.opponentHistory[opponent].push(choice);
  }
}

// ═══════════════════════ BANKROLL ═══════════════════════
class BankrollManager {
  constructor() {
    this.sessionStart = 0n;
    this.sessionPnL = 0n;
    this.minReserve = ethers.parseEther("0.5");
  }

  /**
   * Kelly Criterion position sizing
   */
  async getWager(provider, wallet, registryContract) {
    const balance = await provider.getBalance(wallet);
    this.sessionStart = this.sessionStart || balance;
    
    const available = balance - this.minReserve;
    if (available <= 0n) {
      log("[Bankroll] Below minimum reserve. Stopping.");
      return 0n;
    }

    // Check win rate
    let winPct = 50;
    try {
      const wr = await registryContract.winRate(wallet);
      winPct = Number(wr) / 100;
    } catch(e) {}

    // Position sizing based on win rate
    let pct;
    if (winPct > 60) pct = 15;
    else if (winPct < 40) pct = 5;
    else pct = 10;

    // Stop-loss check
    if (balance < (this.sessionStart * 70n / 100n)) {
      log("[Bankroll] Stop-loss triggered (down 30%). Reducing to minimum.");
      pct = 2;
    }

    const wager = available * BigInt(pct) / 100n;
    const minWager = ethers.parseEther("0.005");
    const maxWager = ethers.parseEther("0.1");
    
    const final = wager < minWager ? minWager : (wager > maxWager ? maxWager : wager);
    log(`[Bankroll] Balance: ${ethers.formatEther(balance)} MON, Win%: ${winPct}%, Wager: ${ethers.formatEther(final)} MON`);
    return final;
  }
}

// ═══════════════════════ AGENT ═══════════════════════
class GladiatorAgent {
  constructor(privateKey) {
    this.provider = new ethers.JsonRpcProvider(RPC);
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.registry = new ethers.Contract(ADDR.registry, REGISTRY_ABI, this.wallet);
    this.rps = new ethers.Contract(ADDR.rps, RPS_ABI, this.wallet);
    this.strategy = new RPSStrategy();
    this.bankroll = new BankrollManager();
    this.pendingCommits = {}; // matchId -> {choice, salt}
    this.matchLog = [];
  }

  async run() {
    log("🏛️⚔️ MonadGladiator Agent starting...");
    log(`Wallet: ${this.wallet.address}`);
    
    const balance = await this.provider.getBalance(this.wallet.address);
    log(`Balance: ${ethers.formatEther(balance)} MON`);

    while (true) {
      try {
        await this.tick();
      } catch(e) {
        log(`[Error] ${e.message}`);
      }
      // Wait 10-30 seconds between ticks (random to seem natural)
      const delay = 10000 + Math.random() * 20000;
      await sleep(delay);
    }
  }

  async tick() {
    // 1. Check for pending reveals
    await this.checkPendingReveals();

    // 2. Look for open matches to join
    const openMatches = await this.rps.getOpenMatches();
    
    if (openMatches.length > 0) {
      // Join a random open match
      const matchId = openMatches[Math.floor(Math.random() * openMatches.length)];
      const matchInfo = await this.rps.matches(matchId);
      const [playerA, playerB, wager] = matchInfo;
      
      // Don't join our own matches
      if (playerA.toLowerCase() !== this.wallet.address.toLowerCase()) {
        log(`\n🎯 Found open match #${matchId} (${ethers.formatEther(wager)} MON)`);
        await this.joinAndPlay(matchId, wager);
        return;
      }
    }

    // 3. No open matches — create one if bankroll allows
    const wager = await this.bankroll.getWager(this.provider, this.wallet.address, this.registry);
    if (wager > 0n) {
      log(`\n⚔️ No open matches. Creating one (${ethers.formatEther(wager)} MON)...`);
      try {
        const tx = await this.rps.createMatch({ value: wager });
        const receipt = await tx.wait();
        log(`✅ Match created. Waiting for challenger...`);
      } catch(e) {
        log(`[Error] Failed to create match: ${e.message}`);
      }
    }
  }

  async joinAndPlay(matchId, wager) {
    try {
      // Join
      log(`Joining match #${matchId}...`);
      const tx = await this.rps.joinMatch(matchId, { value: wager });
      await tx.wait();
      log(`✅ Joined!`);

      // Immediately commit for round 0
      await this.commitForRound(matchId, 0);
    } catch(e) {
      log(`[Error] Failed to join: ${e.message}`);
    }
  }

  async commitForRound(matchId, roundNum) {
    const matchInfo = await this.rps.matches(matchId);
    const [playerA, , , , scoreA, scoreB] = matchInfo;
    const opponent = playerA.toLowerCase() === this.wallet.address.toLowerCase() 
      ? matchInfo[1] : playerA;
    
    const choice = this.strategy.decide(
      opponent, roundNum, 
      playerA.toLowerCase() === this.wallet.address.toLowerCase() ? Number(scoreA) : Number(scoreB),
      playerA.toLowerCase() === this.wallet.address.toLowerCase() ? Number(scoreB) : Number(scoreA)
    );

    const salt = ethers.randomBytes(32);
    const packed = ethers.solidityPacked(["uint8", "bytes32"], [choice, salt]);
    const commitment = ethers.keccak256(packed);

    log(`🔒 Committing ${["","Rock","Paper","Scissors"][choice]} for match #${matchId} round ${roundNum}`);
    
    try {
      const tx = await this.rps.commitChoice(matchId, commitment);
      await tx.wait();
      this.pendingCommits[`${matchId}-${roundNum}`] = { 
        choice, salt: ethers.hexlify(salt), matchId, roundNum, opponent 
      };
      log(`✅ Committed!`);
    } catch(e) {
      log(`[Error] Commit failed: ${e.message}`);
    }
  }

  async checkPendingReveals() {
    for (const [key, commit] of Object.entries(this.pendingCommits)) {
      try {
        const roundInfo = await this.rps.getRound(commit.matchId, commit.roundNum);
        const [commitA, commitB, choiceA, choiceB, revealedA, revealedB] = roundInfo;

        // Both committed? Time to reveal
        if (commitA !== ethers.ZeroHash && commitB !== ethers.ZeroHash) {
          const matchInfo = await this.rps.matches(commit.matchId);
          const isA = matchInfo[0].toLowerCase() === this.wallet.address.toLowerCase();
          const alreadyRevealed = isA ? revealedA : revealedB;
          
          if (!alreadyRevealed) {
            log(`👁️ Revealing for match #${commit.matchId} round ${commit.roundNum}...`);
            const tx = await this.rps.revealChoice(commit.matchId, commit.choice, commit.salt);
            await tx.wait();
            log(`✅ Revealed ${["","Rock","Paper","Scissors"][commit.choice]}!`);

            // Check if opponent also revealed — record their choice
            const updated = await this.rps.getRound(commit.matchId, commit.roundNum);
            if (updated[4] && updated[5]) { // both revealed
              const opponentChoice = isA ? Number(updated[3]) : Number(updated[2]);
              this.strategy.recordOpponentChoice(commit.opponent, opponentChoice);
              log(`📊 Opponent played ${["","Rock","Paper","Scissors"][opponentChoice]}`);
              
              // Check if match continues
              const mInfo = await this.rps.matches(commit.matchId);
              if (!mInfo[8]) { // not settled
                const nextRound = Number(mInfo[6]);
                if (nextRound > commit.roundNum) {
                  await this.commitForRound(commit.matchId, nextRound);
                }
              } else {
                log(`🏁 Match #${commit.matchId} settled!`);
                this.logMatch(commit.matchId, mInfo);
              }
            }

            delete this.pendingCommits[key];
          }
        }
      } catch(e) {
        // Match might be settled or invalid
        if (e.message.includes("settled")) {
          delete this.pendingCommits[key];
        }
      }
    }
  }

  logMatch(matchId, info) {
    const entry = {
      matchId: Number(matchId),
      timestamp: new Date().toISOString(),
      scoreA: Number(info[4]),
      scoreB: Number(info[5]),
      settled: info[8]
    };
    this.matchLog.push(entry);
    fs.writeFileSync("match-log.json", JSON.stringify(this.matchLog, null, 2));
    log(`📝 Match logged (total: ${this.matchLog.length})`);
  }
}

// ═══════════════════════ UTILS ═══════════════════════
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════ MAIN ═══════════════════════
const PK = process.env.PRIVATE_KEY || process.argv[2];
if (!PK) {
  console.error("Usage: node gladiator.js <PRIVATE_KEY>");
  console.error("   or: PRIVATE_KEY=0x... node gladiator.js");
  process.exit(1);
}

const agent = new GladiatorAgent(PK);
agent.run().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
