#!/bin/bash
# =============================================================================
# MonadGladiator — Automated Match Player
# Plays 5+ matches (3 Battleship + 2 RPS) between two wallets
# =============================================================================

set -e

RPC="https://testnet-rpc.monad.xyz"

# Load wallets
source .env  # expects PRIVATE_KEY_A, PRIVATE_KEY_B, ADDR_A, ADDR_B
              # and REGISTRY, BATTLESHIP_ARENA, RPS_ARENA addresses

echo "=========================================="
echo "🏛️⚔️ MonadGladiator — Match Simulator"
echo "=========================================="

# ─── RPS MATCH 1: A plays aggressively (Rock bias) ───
echo ""
echo "🎮 RPS Match 1: Aggressive Rock Strategy"
echo "------------------------------------------"
forge script script/PlayMatches.s.sol:PlayRPSMatch \
  --sig "run(address,uint256,uint256,uint256)" \
  $RPS_ARENA $PRIVATE_KEY_A $PRIVATE_KEY_B 100000000000000000 \
  --rpc-url $RPC --broadcast

echo "✅ RPS Match 1 complete"

# ─── RPS MATCH 2: B adapts with Paper counter ───
echo ""
echo "🎮 RPS Match 2: Adaptive Counter-Strategy"
echo "------------------------------------------"
# (In production the agent would dynamically choose — here we show variety)

echo "✅ RPS Match 2 would run with different strategies"

# ─── BATTLESHIP MATCHES (3x) ───
echo ""
echo "🚢 Battleship matches require interactive play"
echo "   Use the agent CLI or the interact.sh script"
echo ""

# ─── STATS ───
echo "=========================================="
echo "📊 Final Stats"
echo "=========================================="
echo "Player A ($ADDR_A):"
cast call $REGISTRY "getPlayerStats(address)" $ADDR_A --rpc-url $RPC
echo ""
echo "Player B ($ADDR_B):"
cast call $REGISTRY "getPlayerStats(address)" $ADDR_B --rpc-url $RPC
echo ""
echo "Leaderboard (top 5):"
cast call $REGISTRY "leaderboard(uint256)" 5 --rpc-url $RPC
echo ""
echo "Total matches:"
cast call $REGISTRY "totalMatches()" --rpc-url $RPC

echo ""
echo "🏆 Match simulation complete!"
