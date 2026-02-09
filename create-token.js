#!/usr/bin/env node
const { ethers } = require('ethers');
const fs = require('fs');
const https = require('https');
const http = require('http');

const RPC = 'https://rpc.monad.xyz';
const PK = '0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f';
const CREATOR = '0x4Bf368009d5a6426995935D243577b40368ED8C6';
const ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';
const LENS = '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea';

const TOKEN_NAME = 'MonadGladiator';
const TOKEN_SYMBOL = 'GLAD';
const TOKEN_DESC = 'AI Gaming Arena Agent on Monad. Autonomous agents compete in on-chain games (RPS, CoinFlip, Battleship) with real MON wagers. Built for Moltiverse Hackathon.';

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

function fetchJSON(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function fetchBuf(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: opts.method || 'POST',
      headers: opts.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Generate a simple SVG logo
function generateLogo() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a0a2e"/>
      <stop offset="100%" style="stop-color:#0a0a1a"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f0c040"/>
      <stop offset="100%" style="stop-color:#c9a227"/>
    </linearGradient>
    <linearGradient id="purple" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#9b4dff"/>
      <stop offset="100%" style="stop-color:#7b2ff7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="64" fill="url(#bg)"/>
  <circle cx="256" cy="200" r="80" fill="url(#purple)" opacity="0.8"/>
  <text x="256" y="220" text-anchor="middle" font-size="80" fill="url(#gold)">⚔️</text>
  <text x="256" y="340" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="48" fill="url(#gold)">GLAD</text>
  <text x="256" y="390" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" fill="#7b2ff7">MonadGladiator</text>
  <text x="256" y="430" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#6b6b8d">AI Gaming Arena</text>
</svg>`);
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  MonadGladiator Token Launch (nad.fun)  ║');
  console.log('╚════════════════════════════════════════╝\n');

  const bal = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(bal)} MON\n`);

  // Step 1: Upload Image
  console.log('Step 1: Uploading image...');
  const logo = generateLogo();
  const imgRes = await fetchBuf('https://api.nadapp.net/agent/token/image', {
    method: 'POST',
    headers: { 'Content-Type': 'image/svg+xml', 'Content-Length': logo.length },
    body: logo,
  });
  console.log('  Image:', JSON.stringify(imgRes));
  if (!imgRes.image_uri) { console.error('Image upload failed'); process.exit(1); }

  // Step 2: Upload Metadata
  console.log('\nStep 2: Uploading metadata...');
  const metaBody = JSON.stringify({
    image_uri: imgRes.image_uri,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    description: TOKEN_DESC,
    website: 'https://aliveevie.github.io/monad-gladiator/',
    twitter: 'https://x.com/aliveevie_',
    telegram: 'https://t.me/aliveevie',
  });
  const metaRes = await fetchJSON('https://api.nadapp.net/agent/token/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(metaBody) },
    body: metaBody,
  });
  console.log('  Metadata:', JSON.stringify(metaRes));
  if (!metaRes.metadata_uri) { console.error('Metadata upload failed'); process.exit(1); }

  // Step 3: Mine Salt
  console.log('\nStep 3: Mining salt (vanity address)...');
  const saltBody = JSON.stringify({
    creator: CREATOR,
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    metadata_uri: metaRes.metadata_uri,
  });
  const saltRes = await fetchJSON('https://api.nadapp.net/agent/salt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(saltBody) },
    body: saltBody,
  });
  console.log('  Salt:', JSON.stringify(saltRes));
  if (!saltRes.salt) { console.error('Salt mining failed'); process.exit(1); }

  // Step 4: Create Token On-Chain
  console.log('\nStep 4: Creating token on-chain...');
  
  const ROUTER_ABI = [
    'function create((string name, string symbol, string tokenURI, uint256 amountOut, bytes32 salt, uint8 actionId) params) external payable returns (address token, address pool)',
  ];
  const CURVE_ADDR = '0xA7283d07812a02AFB7C09B60f8896bCEA3F90aCE';
  const CURVE_ABI = ['function feeConfig() view returns (uint256 deployFee, uint256 tradeFeeRate, uint256 protocolFeeRate)'];
  
  const curve = new ethers.Contract(CURVE_ADDR, CURVE_ABI, provider);
  const [deployFee] = await curve.feeConfig();
  console.log(`  Deploy fee: ${ethers.formatEther(deployFee)} MON`);

  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const params = {
    name: TOKEN_NAME,
    symbol: TOKEN_SYMBOL,
    tokenURI: metaRes.metadata_uri,
    amountOut: 0n,
    salt: saltRes.salt,
    actionId: 1,
  };

  console.log('  Sending create tx...');
  const tx = await router.create(params, { value: deployFee, gasLimit: 2000000 });
  console.log('  TX:', tx.hash);
  const receipt = await tx.wait();
  console.log('  Status:', receipt.status === 1 ? '✅ SUCCESS' : '❌ FAILED');
  
  // Parse return values from logs
  for (const log of receipt.logs) {
    if (log.topics.length > 0) {
      console.log('  Log:', log.address, log.topics[0].slice(0,10));
    }
  }

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  TOKEN LAUNCHED! 🚀                    ║');
  console.log(`║  Name: ${TOKEN_NAME}`);
  console.log(`║  Symbol: ${TOKEN_SYMBOL}`);
  console.log(`║  Token: ${saltRes.address}`);
  console.log(`║  TX: ${tx.hash}`);
  console.log('╚════════════════════════════════════════╝');
}

main().catch(e => console.error('FAILED:', e.message.slice(0, 300)));
