#!/usr/bin/env node
const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const RPC = 'https://rpc.monad.xyz';
const PK_A = '0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f';
const PK_B = '0x8989dc81f134572e66373d0c54b7152bbe33d408636b9096e3449c745e25693c';
const RPS = '0x7Aef76Fe7e58aAF799e6bFB4C8475652648284eC';
const CF = '0xA1eE78AB7126E5ba97A08389698171dEED459fD7';

const provider = new ethers.JsonRpcProvider(RPC);
const walletA = new ethers.Wallet(PK_A, provider);
const walletB = new ethers.Wallet(PK_B, provider);

let compiled = {};
function compile(name) {
  if (compiled[name]) return compiled[name];
  const sources = {};
  for (const f of fs.readdirSync(path.join(__dirname, 'src'))) {
    if (f.endsWith('.sol')) sources[f] = { content: fs.readFileSync(path.join(__dirname, 'src', f), 'utf8') };
  }
  const input = { language: 'Solidity', sources,
    settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi'] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  for (const file of Object.keys(out.contracts)) {
    if (out.contracts[file][name]) { compiled[name] = out.contracts[file][name].abi; return compiled[name]; }
  }
}

const moveNames = ['', 'Rock', 'Paper', 'Scissors'];
let stats = { rps: 0, coinflip: 0, errors: 0, aWins: 0, bWins: 0, draws: 0 };

async function playRPS(num) {
  const abi = compile('RPSArena');
  const rpsA = new ethers.Contract(RPS, abi, walletA);
  const rpsB = new ethers.Contract(RPS, abi, walletB);
  const wager = ethers.parseEther('0.01');
  const moveA = Math.floor(Math.random() * 3) + 1;
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

  const result = moveA === moveB ? 'Draw' : (moveA===1&&moveB===3)||(moveA===2&&moveB===1)||(moveA===3&&moveB===2) ? 'A wins' : 'B wins';
  if (result === 'A wins') stats.aWins++;
  else if (result === 'B wins') stats.bWins++;
  else stats.draws++;
  stats.rps++;
  console.log(`  RPS #${num}: ${moveNames[moveA]} vs ${moveNames[moveB]} → ${result} (match ${matchId})`);
}

async function playCoinFlip(num) {
  const abi = compile('CoinFlipArena');
  const cfA = new ethers.Contract(CF, abi, walletA);
  const cfB = new ethers.Contract(CF, abi, walletB);
  const wager = ethers.parseEther('0.01');
  const secretA = ethers.randomBytes(32);
  const secretB = ethers.randomBytes(32);
  const commitA = ethers.keccak256(secretA);
  const commitB = ethers.keccak256(secretB);

  const tx1 = await cfA.createFlip(commitA, { value: wager, gasLimit: 500000 });
  const r1 = await tx1.wait();
  let flipId = 0n;
  for (const log of r1.logs) { if (log.topics.length > 1) { flipId = BigInt(log.topics[1]); break; } }

  await (await cfB.joinFlip(flipId, commitB, { value: wager, gasLimit: 500000 })).wait();
  await (await cfA.revealSecret(flipId, ethers.hexlify(secretA), { gasLimit: 500000 })).wait();
  await (await cfB.revealSecret(flipId, ethers.hexlify(secretB), { gasLimit: 500000 })).wait();

  stats.coinflip++;
  console.log(`  CoinFlip #${num}: resolved ✅ (flip ${flipId})`);
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  MonadGladiator — MAINNET Matches      ║');
  console.log('╚════════════════════════════════════════╝');
  
  const balA = await provider.getBalance(walletA.address);
  const balB = await provider.getBalance(walletB.address);
  console.log(`A: ${ethers.formatEther(balA)} MON | B: ${ethers.formatEther(balB)} MON\n`);

  for (let i = 1; i <= 15; i++) {
    try {
      if (i % 3 === 0) {
        await playCoinFlip(Math.ceil(i/3));
      } else {
        await playRPS(i);
      }
    } catch(e) {
      console.log(`  Match ${i} error: ${e.message.slice(0, 100)}`);
      stats.errors++;
      if (e.message.includes('insufficient')) { console.log('  ⚠️ Out of funds'); break; }
    }
  }

  const balA2 = await provider.getBalance(walletA.address);
  const balB2 = await provider.getBalance(walletB.address);
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  MAINNET Results                       ║`);
  console.log(`╠════════════════════════════════════════╣`);
  console.log(`║  RPS: ${stats.rps} | CoinFlip: ${stats.coinflip} | Errors: ${stats.errors}`);
  console.log(`║  A wins: ${stats.aWins} | B wins: ${stats.bWins} | Draws: ${stats.draws}`);
  console.log(`║  A: ${ethers.formatEther(balA2).slice(0,8)} MON | B: ${ethers.formatEther(balB2).slice(0,8)} MON`);
  console.log(`╚════════════════════════════════════════╝`);
}

main().catch(e => console.error(e.message.slice(0, 200)));
