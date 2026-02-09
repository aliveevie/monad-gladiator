#!/bin/bash
# =============================================================================
# MonadGladiator — Full Deploy Script
# Generates wallet, funds via faucet, deploys, verifies all contracts
# =============================================================================

set -e

RPC="https://testnet-rpc.monad.xyz"
CHAIN_ID=10143
VERIFY_API="https://agents.devnads.com/v1/verify"
FAUCET_API="https://agents.devnads.com/v1/faucet"

echo "=========================================="
echo "🏛️⚔️ MonadGladiator — Deployment"
echo "=========================================="

# ─── Step 1: Generate Wallets ───
echo ""
echo "🔑 Step 1: Generating wallets..."

if [ -f ~/.monad-wallet ]; then
    echo "   Wallet A already exists at ~/.monad-wallet"
    source ~/.monad-wallet
else
    WALLET_A=$(cast wallet new 2>/dev/null)
    ADDR_A=$(echo "$WALLET_A" | grep "Address" | awk '{print $2}')
    PK_A=$(echo "$WALLET_A" | grep "Private key" | awk '{print $3}')
    echo "ADDR_A=$ADDR_A" > ~/.monad-wallet
    echo "PK_A=$PK_A" >> ~/.monad-wallet
    chmod 600 ~/.monad-wallet
    echo "   Wallet A: $ADDR_A (saved to ~/.monad-wallet)"
fi

if [ -f ~/.monad-wallet-b ]; then
    echo "   Wallet B already exists at ~/.monad-wallet-b"
    source ~/.monad-wallet-b
else
    WALLET_B=$(cast wallet new 2>/dev/null)
    ADDR_B=$(echo "$WALLET_B" | grep "Address" | awk '{print $2}')
    PK_B=$(echo "$WALLET_B" | grep "Private key" | awk '{print $3}')
    echo "ADDR_B=$ADDR_B" > ~/.monad-wallet-b
    echo "PK_B=$PK_B" >> ~/.monad-wallet-b
    chmod 600 ~/.monad-wallet-b
    echo "   Wallet B: $ADDR_B (saved to ~/.monad-wallet-b)"
fi

source ~/.monad-wallet
source ~/.monad-wallet-b

# ─── Step 2: Fund Wallets ───
echo ""
echo "💰 Step 2: Funding wallets via faucet..."

echo "   Funding A ($ADDR_A)..."
curl -s -X POST $FAUCET_API \
  -H "Content-Type: application/json" \
  -d "{\"chainId\": $CHAIN_ID, \"address\": \"$ADDR_A\"}" | jq .

echo "   Funding B ($ADDR_B)..."
curl -s -X POST $FAUCET_API \
  -H "Content-Type: application/json" \
  -d "{\"chainId\": $CHAIN_ID, \"address\": \"$ADDR_B\"}" | jq .

echo "   Waiting 5s for confirmations..."
sleep 5

# ─── Step 3: Build ───
echo ""
echo "🔨 Step 3: Building contracts..."
forge build

# ─── Step 4: Deploy ───
echo ""
echo "🚀 Step 4: Deploying to Monad Testnet..."
DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $RPC \
  --private-key $PK_A \
  --broadcast 2>&1)

echo "$DEPLOY_OUTPUT"

# Extract addresses from output
REGISTRY=$(echo "$DEPLOY_OUTPUT" | grep "GameRegistry deployed" | awk '{print $NF}')
BATTLESHIP=$(echo "$DEPLOY_OUTPUT" | grep "BattleshipArena deployed" | awk '{print $NF}')
RPS=$(echo "$DEPLOY_OUTPUT" | grep "RPSArena deployed" | awk '{print $NF}')

echo ""
echo "📋 Deployed Addresses:"
echo "   GameRegistry:    $REGISTRY"
echo "   BattleshipArena: $BATTLESHIP"
echo "   RPSArena:        $RPS"

# Save addresses
cat > .env << EOF
PRIVATE_KEY_A=$PK_A
PRIVATE_KEY_B=$PK_B
ADDR_A=$ADDR_A
ADDR_B=$ADDR_B
REGISTRY=$REGISTRY
BATTLESHIP_ARENA=$BATTLESHIP
RPS_ARENA=$RPS
EOF

# ─── Step 5: Verify All Contracts ───
echo ""
echo "✅ Step 5: Verifying contracts on all explorers..."

verify_contract() {
    local addr=$1
    local name=$2
    local constructor_args=$3

    echo "   Verifying $name at $addr..."

    forge verify-contract $addr $name \
      --chain $CHAIN_ID \
      --show-standard-json-input > /tmp/standard-input.json

    COMPILER_VERSION=$(jq -r '.metadata | fromjson | .compiler.version' out/$(echo $name | cut -d: -f1 | sed 's|src/||')/$(echo $name | cut -d: -f2).json)

    METADATA=$(cat out/$(echo $name | cut -d: -f1 | sed 's|src/||')/$(echo $name | cut -d: -f2).json | jq '.metadata')

    local payload="{
      \"chainId\": $CHAIN_ID,
      \"contractAddress\": \"$addr\",
      \"contractName\": \"$name\",
      \"compilerVersion\": \"v${COMPILER_VERSION}\",
      \"standardJsonInput\": $(cat /tmp/standard-input.json),
      \"foundryMetadata\": $METADATA"

    if [ -n "$constructor_args" ]; then
        payload="$payload, \"constructorArgs\": \"$constructor_args\""
    fi
    payload="$payload }"

    echo "$payload" > /tmp/verify.json
    curl -s -X POST $VERIFY_API \
      -H "Content-Type: application/json" \
      -d @/tmp/verify.json | jq .
}

# GameRegistry — no constructor args
verify_contract $REGISTRY "src/GameRegistry.sol:GameRegistry" ""

# BattleshipArena — constructor(address)
BATTLESHIP_ARGS=$(cast abi-encode "constructor(address)" $REGISTRY | sed 's/0x//')
verify_contract $BATTLESHIP "src/BattleshipArena.sol:BattleshipArena" "$BATTLESHIP_ARGS"

# RPSArena — constructor(address)
RPS_ARGS=$(cast abi-encode "constructor(address)" $REGISTRY | sed 's/0x//')
verify_contract $RPS "src/RPSArena.sol:RPSArena" "$RPS_ARGS"

echo ""
echo "=========================================="
echo "🏆 Deployment & verification complete!"
echo "=========================================="
echo ""
echo "Contracts:"
echo "  GameRegistry:    $REGISTRY"
echo "  BattleshipArena: $BATTLESHIP"
echo "  RPSArena:        $RPS"
echo ""
echo "Explorer links:"
echo "  https://monad-testnet.socialscan.io/address/$REGISTRY"
echo "  https://monad-testnet.socialscan.io/address/$BATTLESHIP"
echo "  https://monad-testnet.socialscan.io/address/$RPS"
