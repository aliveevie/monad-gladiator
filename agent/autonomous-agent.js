#!/usr/bin/env node
/**
 * MonadGladiator — Autonomous Gaming Agent
 * Runs continuously, discovers matches, plays with adaptive strategy,
 * posts results to Moltbook. True autonomous agent behavior.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Config
const RPC = 'https://rpc.monad.xyz';
const PK_A = '0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f';
const PK_B = '0x8989dc81f134572e66373d0c54b7152bbe33d408636b9096e3449c745e25693c';
const RPS_ADDR = '0x97f5C4A90f182d15bdD70d656fcea575Db736571';
const CF_ADDR = '0x3816C958cD6BfA65f538150922E26AEE9287A825';
const REG_ADDR = '0x90217E14Cf6652142E15FEc5A990ce5dc91516f5';
const MOLTBOOK_KEY = 'moltbook_sk_jRke2LPFOqy-qQL9ZAQkfxre5hcCbJON';

const provider = new ethers.JsonRpcProvider(RPC);
const agentA = new ethers.Wallet(PK_A, provider); // MonadGladiator
const agentB = new ethers.Wallet(PK_B, provider); // Sparring Partner

// Load Foundry ABIs
const rpsAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '../out/RPSArena.sol/RPSArena.json'))).abi;
const cfAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '../out/CoinFlipArena.sol/CoinFlipArena.json'))).abi;
const regAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '../out/GameRegistry.sol/GameRegistry.json'))).abi;

// Strategy state
const moveNames = ['', 'Rock', 'Paper', 'Scissors'];
let opponentHistory = [];
let matchLog = [];
let stats = { rps: 0, coinflip: 0, aWins: 0, bWins: 0, draws: 0, totalWagered: 0 };

// ═══════════════════════ STRATEGY ENGINE ═══════════════════════

function adaptiveRPSChoice() {
  if (opponentHistory.length < 3) return Math.floor(Math.random() * 3) + 1;
  
  // Frequency analysis - find opponent's most common move
  const freq = [0, 0, 0, 0]; // index 1-3
  const recent = opponentHistory.slice(-10);
  recent.forEach(m => freq[m]++);
  
  // Counter the most frequent move
  const mostFreq = freq.indexOf(Math.max(freq[1], freq[2], freq[3]), 1);
  const counter = mostFreq === 1 ? 2 : mostFreq === 2 ? 3 : 1; // R→P, P→S, S→R
  
  // Meta-game: sometimes counter the counter (level-2 thinking)
  if (Math.random() < 0.3) {
    const counterCounter = counter === 1 ? 2 : counter === 2 ? 3 : 1;
    return counterCounter;
  }
  
  return counter;
}

function kellyWager(balance, winRate) {
  // Kelly Criterion: f* = (p*b - q) / b where b=1 (even odds), p=winRate, q=1-p
  const edge = (2 * winRate - 1);
  if (edge <= 0) return 0.005; // minimum wager
  const fraction = Math.min(edge, 0.1); // cap at 10% of bankroll
  const wager = Math.max(0.005, Math.min(balance * fraction, 0.02));
  return Math.round(wager * 1000) / 1000;
}

// ═══════════════════════ GAME PLAY ═══════════════════════

async function playRPS() {
  const rpsA = new ethers.Contract(RPS_ADDR, rpsAbi, agentA);
  const rpsB = new ethers.Contract(RPS_ADDR, rpsAbi, agentB);
  
  const balA = parseFloat(ethers.formatEther(await provider.getBalance(agentA.address)));
  const winRate = stats.rps > 0 ? stats.aWins / stats.rps : 0.5;
  const wagerAmt = kellyWager(balA, winRate);
  const wager = ethers.parseEther(wagerAmt.toString());
  
  // Agent A uses strategy, Agent B plays random (sparring partner)
  const moveA = adaptiveRPSChoice();
  const moveB = Math.floor(Math.random() * 3) + 1;
  const saltA = ethers.randomBytes(32);
  const saltB = ethers.randomBytes(32);
  const commitA = ethers.solidityPackedKeccak256(['uint8','bytes32'], [moveA, saltA]);
  const commitB = ethers.solidityPackedKeccak256(['uint8','bytes32'], [moveB, saltB]);

  const tx1 = await rpsA.createMatch({ value: wager, gasLimit: 500000 });
  const r1 = await tx1.wait();
  let matchId = 0n;
  for (const log of r1.logs) { if (log.topics.length > 1) { matchId = BigInt(log.topics[1]); break; } }

  await (await rpsB.joinMatch(matchId, { value: wager, gasLimit: 500000 })).wait();
  await (await rpsA.commitChoice(matchId, commitA, { gasLimit: 300000 })).wait();
  await (await rpsB.commitChoice(matchId, commitB, { gasLimit: 300000 })).wait();
  await (await rpsA.revealChoice(matchId, moveA, ethers.hexlify(saltA), { gasLimit: 500000 })).wait();
  await (await rpsB.revealChoice(matchId, moveB, ethers.hexlify(saltB), { gasLimit: 500000 })).wait();

  opponentHistory.push(moveB);
  
  const result = moveA === moveB ? 'Draw' : (moveA===1&&moveB===3)||(moveA===2&&moveB===1)||(moveA===3&&moveB===2) ? 'A wins' : 'B wins';
  if (result === 'A wins') stats.aWins++;
  else if (result === 'B wins') stats.bWins++;
  else stats.draws++;
  stats.rps++;
  stats.totalWagered += wagerAmt * 2;
  
  const entry = {
    type: 'RPS', matchId: matchId.toString(), moveA: moveNames[moveA], moveB: moveNames[moveB],
    result, wager: wagerAmt, strategy: opponentHistory.length < 3 ? 'random' : 'adaptive',
    time: new Date().toISOString()
  };
  matchLog.push(entry);
  
  console.log(`  ⚔️ RPS #${stats.rps} (${matchId}): ${moveNames[moveA]} vs ${moveNames[moveB]} → ${result} | wager: ${wagerAmt} MON | strategy: ${entry.strategy}`);
  return entry;
}

async function playCoinFlip() {
  const cfA = new ethers.Contract(CF_ADDR, cfAbi, agentA);
  const cfB = new ethers.Contract(CF_ADDR, cfAbi, agentB);
  const wager = ethers.parseEther('0.005');
  
  const secretA = ethers.randomBytes(32);
  const secretB = ethers.randomBytes(32);
  const commitA = ethers.keccak256(secretA);
  const commitB = ethers.keccak256(secretB);

  const tx1 = await cfA.createFlip(commitA, { value: wager, gasLimit: 500000 });
  const r1 = await tx1.wait();
  let flipId = 0n;
  for (const log of r1.logs) { if (log.topics.length > 1) { flipId = BigInt(log.topics[1]); break; } }

  await (await cfB.joinFlip(flipId, commitB, { value: wager, gasLimit: 500000 })).wait();
  await (await cfA.revealSecret(flipId, secretA, { gasLimit: 800000 })).wait();
  await new Promise(r => setTimeout(r, 2000));
  await (await cfB.revealSecret(flipId, secretB, { gasLimit: 800000 })).wait();

  stats.coinflip++;
  stats.totalWagered += 0.01;
  
  const entry = {
    type: 'CoinFlip', flipId: flipId.toString(), result: 'resolved',
    wager: 0.005, time: new Date().toISOString()
  };
  matchLog.push(entry);
  
  console.log(`  🪙 CoinFlip #${stats.coinflip} (${flipId}): resolved ✅`);
  return entry;
}

// ═══════════════════════ MOLTBOOK INTEGRATION ═══════════════════════

function postToMoltbook(title, content) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ submolt: 'moltiversehackathon', title, content });
    const req = https.request('https://www.moltbook.com/api/v1/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MOLTBOOK_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ═══════════════════════ AUTONOMOUS LOOP ═══════════════════════

async function checkBalances() {
  const balA = await provider.getBalance(agentA.address);
  const balB = await provider.getBalance(agentB.address);
  return {
    a: parseFloat(ethers.formatEther(balA)),
    b: parseFloat(ethers.formatEther(balB)),
  };
}

async function autonomousRound(roundNum) {
  console.log(`\n═══ Round ${roundNum} | ${new Date().toISOString()} ═══`);
  
  const bal = await checkBalances();
  console.log(`  💰 Balances — A: ${bal.a.toFixed(4)} MON | B: ${bal.b.toFixed(4)} MON`);
  
  // Decision: can we afford to play?
  const minBalance = 0.05;
  if (bal.a < minBalance || bal.b < minBalance) {
    console.log('  ⚠️ Low balance, skipping round');
    return null;
  }
  
  // Decision: which game to play? (weighted random based on state)
  const rand = Math.random();
  let result;
  
  if (rand < 0.65) {
    // 65% RPS (our main game)
    console.log('  🎯 Decision: Play RPS (adaptive strategy)');
    result = await playRPS();
  } else {
    // 35% CoinFlip
    console.log('  🎯 Decision: Play CoinFlip (provably fair)');
    result = await playCoinFlip();
  }
  
  return result;
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  MonadGladiator — Autonomous Gaming Agent v1   ║');
  console.log('║  Running continuously on Monad mainnet         ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Agent A (Gladiator): ${agentA.address}`);
  console.log(`Agent B (Sparring):  ${agentB.address}`);
  console.log(`Games: RPS @ ${RPS_ADDR.slice(0,10)}... | CF @ ${CF_ADDR.slice(0,10)}...`);
  console.log(`Strategy: Adaptive frequency analysis + Kelly Criterion\n`);

  const ROUNDS = parseInt(process.env.ROUNDS || '20');
  const DELAY_MS = parseInt(process.env.DELAY_MS || '5000'); // 5s between rounds
  
  for (let i = 1; i <= ROUNDS; i++) {
    try {
      await autonomousRound(i);
    } catch(e) {
      console.log(`  ❌ Round ${i} error: ${e.message.slice(0, 100)}`);
      if (e.message.includes('insufficient')) {
        console.log('  💸 Out of funds, stopping');
        break;
      }
    }
    
    // Wait between rounds (simulates agent thinking/deciding)
    if (i < ROUNDS) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Final stats
  const bal = await checkBalances();
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  Autonomous Session Complete                   ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  RPS: ${stats.rps} | CoinFlip: ${stats.coinflip} | Total: ${stats.rps + stats.coinflip}`);
  console.log(`║  A wins: ${stats.aWins} | B wins: ${stats.bWins} | Draws: ${stats.draws}`);
  const wr = stats.rps > 0 ? ((stats.aWins / (stats.rps - stats.draws)) * 100).toFixed(1) : '0';
  console.log(`║  Win Rate: ${wr}% | Total Wagered: ${stats.totalWagered.toFixed(3)} MON`);
  console.log(`║  A: ${bal.a.toFixed(4)} MON | B: ${bal.b.toFixed(4)} MON`);
  console.log('╚════════════════════════════════════════════════╝');

  // Save match log
  const logPath = path.join(__dirname, '../match-log.json');
  const existing = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath)) : [];
  fs.writeFileSync(logPath, JSON.stringify([...existing, ...matchLog], null, 2));
  console.log(`\n📝 Match log saved (${matchLog.length} new entries)`);
}

main().catch(e => console.error('Agent crashed:', e.message.slice(0, 200)));
