#!/usr/bin/env node
const { ethers } = require("ethers");
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const RPC = "https://testnet-rpc.monad.xyz";
const PK_A = "0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f";

const EXISTING = {
  registry: "0x2A1dAdFe8f95987bC7225D4dCFAD2FB530A1Cc45",
  rps: "0x14A0559A19a724919D7CfEFF7BAFc42740d631F0"
};

function readSol(name) {
  return fs.readFileSync(path.join(__dirname, "src", name), "utf8");
}

function compile(contractName) {
  const sources = {
    "GameRegistry.sol": { content: readSol("GameRegistry.sol") },
    "RPSArena.sol": { content: readSol("RPSArena.sol") },
    "BattleshipArena.sol": { content: readSol("BattleshipArena.sol") },
    "TournamentManager.sol": { content: readSol("TournamentManager.sol") },
    "CoinFlipArena.sol": { content: readSol("CoinFlipArena.sol") }
  };

  const input = {
    language: "Solidity",
    sources,
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const errs = output.errors.filter(e => e.severity === "error");
    if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
  }

  for (const [, contracts] of Object.entries(output.contracts)) {
    if (contracts[contractName]) {
      return { abi: contracts[contractName].abi, bytecode: "0x" + contracts[contractName].evm.bytecode.object };
    }
  }
  throw new Error(`${contractName} not found`);
}

async function deployContract(wallet, provider, compiled, constructorArgs) {
  const iface = new ethers.Interface(compiled.abi);
  const deployData = compiled.bytecode + iface.encodeDeploy(constructorArgs).slice(2);
  
  const nonce = await provider.getTransactionCount(wallet.address);
  const feeData = await provider.getFeeData();
  
  const tx = {
    nonce,
    data: deployData,
    gasLimit: 8000000n,
    gasPrice: feeData.gasPrice ? feeData.gasPrice * 2n : 50000000000n,
    type: 0,
    chainId: 10143
  };

  console.log("  Sending tx...");
  const sentTx = await wallet.sendTransaction(tx);
  console.log("  Tx hash:", sentTx.hash);
  const receipt = await sentTx.wait();
  console.log("  Contract:", receipt.contractAddress);
  return receipt.contractAddress;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK_A, provider);
  
  const bal = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}, Balance: ${ethers.formatEther(bal)} MON`);

  // Compile
  console.log("\nCompiling TournamentManager...");
  const tmCompiled = compile("TournamentManager");
  console.log("Compiling CoinFlipArena...");
  const cfCompiled = compile("CoinFlipArena");

  // Deploy TournamentManager
  console.log("\n🚀 Deploying TournamentManager...");
  const tmAddr = await deployContract(wallet, provider, tmCompiled, [EXISTING.registry, EXISTING.rps]);

  // Deploy CoinFlipArena
  console.log("\n🚀 Deploying CoinFlipArena...");
  const cfAddr = await deployContract(wallet, provider, cfCompiled, [EXISTING.registry]);

  // Authorize CoinFlipArena in GameRegistry
  console.log("\n🔑 Authorizing CoinFlipArena in GameRegistry...");
  const regAbi = ["function authorizeGame(address)"];
  const registry = new ethers.Contract(EXISTING.registry, regAbi, wallet);
  const authTx = await registry.authorizeGame(cfAddr);
  await authTx.wait();
  console.log("✅ Authorized");

  console.log("\n═══════════════════════════════════════════");
  console.log("DEPLOYED:");
  console.log(`  TournamentManager: ${tmAddr}`);
  console.log(`  CoinFlipArena:     ${cfAddr}`);
  console.log("═══════════════════════════════════════════");

  fs.writeFileSync("deployed-addresses.json", JSON.stringify({
    registry: EXISTING.registry,
    battleship: "0x7Aef76Fe7e58aAF799e6bFB4C8475652648284eC",
    rps: EXISTING.rps,
    tournament: tmAddr,
    coinFlip: cfAddr,
    chainId: 10143,
    deployer: wallet.address,
    timestamp: new Date().toISOString()
  }, null, 2));
}

main().catch(e => { console.error("FATAL:", e.message || e); process.exit(1); });
