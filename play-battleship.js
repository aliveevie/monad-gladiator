const { ethers } = require("ethers");

const RPC = "https://testnet-rpc.monad.xyz";
const PK_A = "0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f";
const PK_B = "0x8989dc81f134572e66373d0c54b7152bbe33d408636b9096e3449c745e25693c";
const BS = "0x7Aef76Fe7e58aAF799e6bFB4C8475652648284eC";
const REGISTRY = "0x2A1dAdFe8f95987bC7225D4dCFAD2FB530A1Cc45";

const BS_ABI = [
  "function createGame() payable returns (uint256)",
  "function joinGame(uint256) payable",
  "function commitBoard(uint256,bytes32)",
  "function fireShot(uint256,uint8,uint8,bool)",
  "function getGameInfo(uint256) view returns (address,address,uint256,uint8,uint8,uint8,address,bool)",
  "function gameCount() view returns (uint256)"
];
const REG_ABI = ["function totalMatches() view returns (uint256)"];

function makeBoard(layout) {
  const b = new Uint8Array(100);
  for (const [shipId, cells] of Object.entries(layout)) {
    for (const [r,c] of cells) b[r*10+c] = parseInt(shipId);
  }
  return b;
}

async function playGame(provider, walletA, walletB, bsA, bsB, reg, gameNum) {
  const gc = await bsA.gameCount();
  const gameId = gc;
  
  console.log(`\n🚢 === BATTLESHIP GAME ${gameNum} (ID: ${gameId}) ===`);
  
  let tx = await bsA.createGame({ value: ethers.parseEther("0.01") });
  await tx.wait();
  console.log("✅ Created");
  
  tx = await bsB.joinGame(gameId, { value: ethers.parseEther("0.01") });
  await tx.wait();
  console.log("✅ Joined");

  // Board layouts
  const boardALayout = {
    1: [[0,0],[0,1],[0,2],[0,3],[0,4]],     // Carrier 5
    2: [[2,0],[2,1],[2,2],[2,3]],             // Battleship 4
    3: [[4,0],[4,1],[4,2]],                   // Cruiser 3
    4: [[6,0],[6,1],[6,2]],                   // Submarine 3
    5: [[8,0],[8,1]]                          // Destroyer 2
  };
  const boardBLayout = {
    1: [[1,5],[1,6],[1,7],[1,8],[1,9]],
    2: [[3,6],[3,7],[3,8],[3,9]],
    3: [[5,7],[5,8],[5,9]],
    4: [[7,3],[7,4],[7,5]],
    5: [[9,8],[9,9]]
  };

  if (gameNum === 2) {
    // Different layout for game 2 variety
    boardBLayout[1] = [[0,5],[0,6],[0,7],[0,8],[0,9]];
    boardBLayout[2] = [[2,6],[2,7],[2,8],[2,9]];
    boardBLayout[3] = [[4,7],[4,8],[4,9]];
    boardBLayout[4] = [[6,4],[6,5],[6,6]];
    boardBLayout[5] = [[8,8],[8,9]];
  }

  const boardA = makeBoard(boardALayout);
  const boardB = makeBoard(boardBLayout);

  const saltA = ethers.randomBytes(32);
  const saltB = ethers.randomBytes(32);
  const commitA = ethers.keccak256(ethers.solidityPacked(["bytes","bytes32"], [boardA, saltA]));
  const commitB = ethers.keccak256(ethers.solidityPacked(["bytes","bytes32"], [boardB, saltB]));

  tx = await bsA.commitBoard(gameId, commitA);
  await tx.wait();
  tx = await bsB.commitBoard(gameId, commitB);
  await tx.wait();
  console.log("✅ Boards committed — FIGHT!");

  // Build shot sequences
  // A fires at B's board: some misses (hunt mode), then hits (target mode)
  const bShipCells = [];
  for (const cells of Object.values(boardBLayout)) bShipCells.push(...cells);
  
  const aShipCells = [];
  for (const cells of Object.values(boardALayout)) aShipCells.push(...cells);

  // A's shots: hunt mode misses, then systematic targeting
  const aShotsQueue = [];
  // Hunt mode: checkerboard pattern misses
  const aMisses = [[0,1],[2,5],[4,3],[6,7],[8,5]].filter(
    ([r,c]) => !bShipCells.some(([sr,sc]) => sr===r && sc===c)
  );
  aShotsQueue.push(...aMisses.slice(0,3).map(([r,c]) => ({r,c,hit:false})));
  // Then hits
  for (const [r,c] of bShipCells) aShotsQueue.push({r,c,hit:true});

  // B's shots: similar pattern
  const bMisses = [[1,1],[3,3],[5,5],[7,7],[9,5]].filter(
    ([r,c]) => !aShipCells.some(([sr,sc]) => sr===r && sc===c)
  );
  const bShotsQueue = [];
  bShotsQueue.push(...bMisses.slice(0,3).map(([r,c]) => ({r,c,hit:false})));
  for (const [r,c] of aShipCells) bShotsQueue.push({r,c,hit:true});

  let ai = 0, bi = 0;
  let hitsOnB = 0, hitsOnA = 0;

  const delay = ms => new Promise(r => setTimeout(r, ms));
  
  while (hitsOnB < 17 && hitsOnA < 17) {
    // Check whose turn it is
    const info = await bsA.getGameInfo(gameId);
    if (info[7]) { console.log("Game already settled!"); break; }
    const currentTurn = info[6];
    
    if (currentTurn.toLowerCase() === walletA.address.toLowerCase()) {
      if (ai >= aShotsQueue.length) break;
      const s = aShotsQueue[ai++];
      process.stdout.write(`  A→(${s.r},${s.c}) ${s.hit?'💥':'•'} `);
      tx = await bsA.fireShot(gameId, s.r, s.c, s.hit);
      await tx.wait();
      if (s.hit) hitsOnB++;
      if (hitsOnB >= 17) { console.log("\n🏆 A WINS!"); break; }
    } else {
      if (bi >= bShotsQueue.length) break;
      const s = bShotsQueue[bi++];
      process.stdout.write(`B→(${s.r},${s.c}) ${s.hit?'💥':'•'}\n`);
      tx = await bsB.fireShot(gameId, s.r, s.c, s.hit);
      await tx.wait();
      if (s.hit) hitsOnA++;
      if (hitsOnA >= 17) { console.log("🏆 B WINS!"); break; }
    }
    await delay(500);
  }

  const info = await bsA.getGameInfo(gameId);
  console.log(`Game settled: ${info[7]}, HitsOnA: ${info[4]}, HitsOnB: ${info[5]}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const walletA = new ethers.Wallet(PK_A, provider);
  const walletB = new ethers.Wallet(PK_B, provider);
  const bsA = new ethers.Contract(BS, BS_ABI, walletA);
  const bsB = new ethers.Contract(BS, BS_ABI, walletB);
  const reg = new ethers.Contract(REGISTRY, REG_ABI, provider);

  console.log("🏛️⚔️ MonadGladiator — Battleship Matches");
  console.log("A:", walletA.address, "Balance:", ethers.formatEther(await provider.getBalance(walletA.address)));
  console.log("B:", walletB.address, "Balance:", ethers.formatEther(await provider.getBalance(walletB.address)));

  // Play 2 battleship games
  await playGame(provider, walletA, walletB, bsA, bsB, reg, 1);
  await playGame(provider, walletA, walletB, bsA, bsB, reg, 2);

  const total = await reg.totalMatches();
  console.log(`\n📊 Total registry matches: ${total}`);
  console.log("✅ Battleship matches complete!");
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
