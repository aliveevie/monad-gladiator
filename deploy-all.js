#!/usr/bin/env node
/**
 * MonadGladiator — Full Deployment Script
 * Compiles and deploys all contracts using solc + ethers
 */

const { ethers } = require("ethers");
const solc = require("solc");
const fs = require("fs");
const path = require("path");

const RPC = "https://testnet-rpc.monad.xyz";
const CHAIN_ID = 10143;
const PK_A = "0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f";

// Existing deployed contracts
const EXISTING = {
  registry: "0x2A1dAdFe8f95987bC7225D4dCFAD2FB530A1Cc45",
  battleship: "0x7Aef76Fe7e58aAF799e6bFB4C8475652648284eC",
  rps: "0x14A0559A19a724919D7CfEFF7BAFc42740d631F0"
};

function readSolFile(name) {
  return fs.readFileSync(path.join(__dirname, "src", name), "utf8");
}

function compile(contractName, sources) {
  const input = {
    language: "Solidity",
    sources: {},
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
    }
  };
  for (const [name, content] of Object.entries(sources)) {
    input.sources[name] = { content };
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  
  if (output.errors) {
    const errs = output.errors.filter(e => e.severity === "error");
    if (errs.length > 0) {
      console.error("Compilation errors:");
      errs.forEach(e => console.error(e.formattedMessage));
      throw new Error("Compilation failed");
    }
    // Show warnings
    output.errors.filter(e => e.severity === "warning").forEach(e => {
      console.log("⚠️", e.message.split("\n")[0]);
    });
  }

  // Find the contract in output
  for (const [file, contracts] of Object.entries(output.contracts)) {
    if (contracts[contractName]) {
      const c = contracts[contractName];
      return {
        abi: c.abi,
        bytecode: "0x" + c.evm.bytecode.object
      };
    }
  }
  throw new Error(`Contract ${contractName} not found in compilation output`);
}

async function deploy(wallet, name, compiled, args = []) {
  console.log(`\n🚀 Deploying ${name}...`);
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  const contract = await factory.deploy(...args, { gasLimit: 8000000 });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`✅ ${name} deployed at: ${addr}`);
  return { address: addr, contract, abi: compiled.abi };
}

async function verify(address, contractName) {
  console.log(`🔍 Verifying ${contractName} at ${address}...`);
  try {
    const resp = await fetch("https://agents.devnads.com/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: CHAIN_ID, address, contractName })
    });
    const data = await resp.json();
    console.log(`  Verify response:`, JSON.stringify(data).slice(0, 200));
  } catch (e) {
    console.log(`  Verify failed: ${e.message}`);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK_A, provider);
  console.log(`Deployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} MON`);

  // Read all source files
  const sources = {
    "GameRegistry.sol": readSolFile("GameRegistry.sol"),
    "RPSArena.sol": readSolFile("RPSArena.sol"),
    "BattleshipArena.sol": readSolFile("BattleshipArena.sol"),
    "TournamentManager.sol": readSolFile("TournamentManager.sol"),
    "CoinFlipArena.sol": readSolFile("CoinFlipArena.sol")
  };

  // Compile new contracts
  console.log("\n📦 Compiling TournamentManager...");
  const tournamentCompiled = compile("TournamentManager", sources);
  console.log("✅ TournamentManager compiled");

  console.log("\n📦 Compiling CoinFlipArena...");
  const coinFlipCompiled = compile("CoinFlipArena", sources);
  console.log("✅ CoinFlipArena compiled");

  // Deploy
  const tournament = await deploy(wallet, "TournamentManager", tournamentCompiled, [EXISTING.registry, EXISTING.rps]);
  const coinFlip = await deploy(wallet, "CoinFlipArena", coinFlipCompiled, [EXISTING.registry]);

  // Authorize new contracts in GameRegistry
  console.log("\n🔑 Authorizing new contracts in GameRegistry...");
  const registryAbi = ["function authorizeGame(address)"];
  const registry = new ethers.Contract(EXISTING.registry, registryAbi, wallet);
  
  let tx = await registry.authorizeGame(coinFlip.address);
  await tx.wait();
  console.log("✅ CoinFlipArena authorized");

  // Verify
  await verify(tournament.address, "TournamentManager");
  await verify(coinFlip.address, "CoinFlipArena");

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("═".repeat(60));
  console.log(`GameRegistry:      ${EXISTING.registry} (existing)`);
  console.log(`BattleshipArena:   ${EXISTING.battleship} (existing)`);
  console.log(`RPSArena:          ${EXISTING.rps} (existing)`);
  console.log(`TournamentManager: ${tournament.address} (NEW)`);
  console.log(`CoinFlipArena:     ${coinFlip.address} (NEW)`);
  console.log("═".repeat(60));

  // Save addresses
  const addresses = {
    ...EXISTING,
    tournament: tournament.address,
    coinFlip: coinFlip.address,
    chainId: CHAIN_ID,
    deployer: wallet.address,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync("deployed-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\n📁 Addresses saved to deployed-addresses.json");
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
