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

function readSol(name) { return fs.readFileSync(path.join(__dirname, "src", name), "utf8"); }

function compile(contractName) {
  const sources = {};
  for (const f of fs.readdirSync(path.join(__dirname, "src"))) {
    if (f.endsWith(".sol")) sources[f] = { content: readSol(f) };
  }
  const input = {
    language: "Solidity", sources,
    settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: "paris",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } }
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

async function deployContract(wallet, provider, name, compiled, args) {
  console.log(`\n🚀 Deploying ${name}...`);
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, wallet);
  
  const iface = new ethers.Interface(compiled.abi);
  const deployData = compiled.bytecode + iface.encodeDeploy(args).slice(2);
  
  const nonce = await provider.getTransactionCount(wallet.address);
  const feeData = await provider.getFeeData();
  console.log(`  Nonce: ${nonce}, gasPrice: ${feeData.gasPrice}`);
  
  // Use exact gasPrice, don't let ethers double it
  const rawTx = {
    to: null,
    data: deployData,
    gasLimit: 2000000,
    gasPrice: feeData.gasPrice,
    nonce: nonce,
    chainId: 10143,
    value: 0,
    type: 0
  };
  
  const signedTx = await wallet.signTransaction(rawTx);
  
  const resp = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_sendRawTransaction", params: [signedTx], id: 1 })
  });
  const result = await resp.json();
  
  if (result.error) {
    console.log(`  RPC error:`, result.error);
    throw new Error(result.error.message);
  }
  
  console.log(`  Tx: ${result.result}`);
  let receipt;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    receipt = await provider.getTransactionReceipt(result.result);
    if (receipt) break;
  }
  if (!receipt) throw new Error("Tx not mined");
  console.log(`✅ ${name}: ${receipt.contractAddress} (gas: ${receipt.gasUsed})`);
  return receipt.contractAddress;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK_A, provider);
  
  const bal = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(bal)} MON`);

  // Check chain ID
  const network = await provider.getNetwork();
  console.log(`Chain: ${network.chainId}`);

  console.log("\nCompiling...");
  const tmCompiled = compile("TournamentManager");
  console.log(`TournamentManager bytecode: ${tmCompiled.bytecode.length} chars`);
  const cfCompiled = compile("CoinFlipArena");
  console.log(`CoinFlipArena bytecode: ${cfCompiled.bytecode.length} chars`);

  const tmAddr = await deployContract(wallet, provider, "TournamentManager", tmCompiled, [EXISTING.registry, EXISTING.rps]);
  const cfAddr = await deployContract(wallet, provider, "CoinFlipArena", cfCompiled, [EXISTING.registry]);

  // Authorize
  console.log("\n🔑 Authorizing CoinFlipArena...");
  const reg = new ethers.Contract(EXISTING.registry, ["function authorizeGame(address)"], wallet);
  const tx = await reg.authorizeGame(cfAddr);
  await tx.wait();
  console.log("✅ Authorized");

  console.log("\n═══════════════════════════════════");
  console.log(`TournamentManager: ${tmAddr}`);
  console.log(`CoinFlipArena:     ${cfAddr}`);
  
  fs.writeFileSync("deployed-addresses.json", JSON.stringify({
    registry: EXISTING.registry,
    battleship: "0x7Aef76Fe7e58aAF799e6bFB4C8475652648284eC",
    rps: EXISTING.rps,
    tournament: tmAddr,
    coinFlip: cfAddr
  }, null, 2));
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
