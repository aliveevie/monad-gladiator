#!/usr/bin/env node
const { ethers } = require('ethers');
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const RPC = 'https://rpc.monad.xyz';
const PK = '0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f';

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

function compileSources() {
  const sources = {};
  const srcDir = path.join(__dirname, 'src');
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith('.sol')) sources[f] = { content: fs.readFileSync(path.join(srcDir, f), 'utf8') };
  }
  const input = {
    language: 'Solidity', sources,
    settings: {
      viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  if (out.errors) {
    const errs = out.errors.filter(e => e.severity === 'error');
    if (errs.length) { console.error(errs.map(e => e.message).join('\n')); process.exit(1); }
  }
  return out.contracts;
}

async function deploy(contracts, name, file, args = []) {
  const c = contracts[file][name];
  const factory = new ethers.ContractFactory(c.abi, c.evm.bytecode.object, wallet);
  console.log(`  Deploying ${name}...`);
  const contract = await factory.deploy(...args, { gasLimit: 5000000 });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ✅ ${name}: ${addr}`);
  return { addr, abi: c.abi };
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  MonadGladiator — Mainnet Deployment       ║');
  console.log('╚════════════════════════════════════════════╝');
  
  const bal = await provider.getBalance(wallet.address);
  const net = await provider.getNetwork();
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Chain: ${Number(net.chainId)} | Balance: ${ethers.formatEther(bal)} MON\n`);

  console.log('Compiling contracts...');
  const contracts = compileSources();
  console.log('Compilation complete ✅\n');

  // 1. GameRegistry
  const registry = await deploy(contracts, 'GameRegistry', 'GameRegistry.sol');

  // 2. RPSArena
  const rps = await deploy(contracts, 'RPSArena', 'RPSArena.sol', [registry.addr]);

  // 3. BattleshipArena
  const battleship = await deploy(contracts, 'BattleshipArena', 'BattleshipArena.sol', [registry.addr]);

  // 4. CoinFlipArena
  const coinflip = await deploy(contracts, 'CoinFlipArena', 'CoinFlipArena.sol', [registry.addr]);

  // 5. TournamentManager
  const tournament = await deploy(contracts, 'TournamentManager', 'TournamentManager.sol', [registry.addr]);

  // Authorize all arenas in GameRegistry
  console.log('\nAuthorizing arenas in GameRegistry...');
  const reg = new ethers.Contract(registry.addr, registry.abi, wallet);
  await (await reg.authorizeGame(rps.addr, { gasLimit: 200000 })).wait();
  console.log('  ✅ RPSArena authorized');
  await (await reg.authorizeGame(battleship.addr, { gasLimit: 200000 })).wait();
  console.log('  ✅ BattleshipArena authorized');
  await (await reg.authorizeGame(coinflip.addr, { gasLimit: 200000 })).wait();
  console.log('  ✅ CoinFlipArena authorized');
  await (await reg.authorizeGame(tournament.addr, { gasLimit: 200000 })).wait();
  console.log('  ✅ TournamentManager authorized');

  const bal2 = await provider.getBalance(wallet.address);
  console.log(`\nGas spent: ${(Number(ethers.formatEther(bal)) - Number(ethers.formatEther(bal2))).toFixed(4)} MON`);
  console.log(`Remaining: ${ethers.formatEther(bal2)} MON`);

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  MAINNET DEPLOYMENT COMPLETE               ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  GameRegistry:      ${registry.addr}`);
  console.log(`║  RPSArena:          ${rps.addr}`);
  console.log(`║  BattleshipArena:   ${battleship.addr}`);
  console.log(`║  CoinFlipArena:     ${coinflip.addr}`);
  console.log(`║  TournamentManager: ${tournament.addr}`);
  console.log('╚════════════════════════════════════════════╝');
}

main().catch(e => console.error('Deploy failed:', e.message));
