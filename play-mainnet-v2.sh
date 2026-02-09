#!/bin/bash
export PATH="$HOME/.foundry/bin:$PATH"

RPS="0x97f5C4A90f182d15bdD70d656fcea575Db736571"
CF="0x3816C958cD6BfA65f538150922E26AEE9287A825"
PK_A="0x24743c04a4786f3c91fdb06d084f9f84b20cd38b3ebc1fdf14eadc1092a0980f"
PK_B="0x8989dc81f134572e66373d0c54b7152bbe33d408636b9096e3449c745e25693c"
RPC="https://rpc.monad.xyz"

echo "╔════════════════════════════════════════╗"
echo "║  MonadGladiator — Mainnet Batch v2     ║"
echo "╚════════════════════════════════════════╝"

echo "Balance A: $(cast balance 0x4Bf368009d5a6426995935D243577b40368ED8C6 --rpc-url $RPC --ether) MON"
echo "Balance B: $(cast balance 0x3E336C0052Ef2548ef012259459eD12E9a4Aa665 --rpc-url $RPC --ether) MON"

rps_count=0
cf_count=0
errors=0

play_rps() {
  local SALT_A=$(cast keccak "$(openssl rand -hex 32)")
  local SALT_B=$(cast keccak "$(openssl rand -hex 32)")
  local MOVE_A=$((RANDOM % 3 + 1))
  local MOVE_B=$((RANDOM % 3 + 1))
  
  local COMMIT_A=$(cast keccak $(cast abi-encode "f(uint8,bytes32)" $MOVE_A $SALT_A))
  local COMMIT_B=$(cast keccak $(cast abi-encode "f(uint8,bytes32)" $MOVE_B $SALT_B))
  
  # Create
  local TX=$(cast send $RPS "createMatch()" --value 0.01ether --private-key $PK_A --rpc-url $RPC --json 2>/dev/null)
  local STATUS=$(echo $TX | jq -r '.status')
  if [ "$STATUS" != "0x1" ]; then echo "  RPS create failed"; errors=$((errors+1)); return; fi
  
  # Get match ID from logs
  local MATCH_ID=$(echo $TX | jq -r '.logs[0].topics[1]')
  
  # Join
  cast send $RPS "joinMatch(uint256)" $MATCH_ID --value 0.01ether --private-key $PK_B --rpc-url $RPC --json >/dev/null 2>&1
  
  # Commit
  cast send $RPS "commitChoice(uint256,bytes32)" $MATCH_ID $COMMIT_A --private-key $PK_A --rpc-url $RPC --json >/dev/null 2>&1
  cast send $RPS "commitChoice(uint256,bytes32)" $MATCH_ID $COMMIT_B --private-key $PK_B --rpc-url $RPC --json >/dev/null 2>&1
  
  # Reveal
  cast send $RPS "revealChoice(uint256,uint8,bytes32)" $MATCH_ID $MOVE_A $SALT_A --private-key $PK_A --rpc-url $RPC --json >/dev/null 2>&1
  cast send $RPS "revealChoice(uint256,uint8,bytes32)" $MATCH_ID $MOVE_B $SALT_B --private-key $PK_B --rpc-url $RPC --json >/dev/null 2>&1
  
  local MOVES=("" "Rock" "Paper" "Scissors")
  local RESULT=""
  if [ $MOVE_A -eq $MOVE_B ]; then RESULT="Draw"
  elif [ $MOVE_A -eq 1 ] && [ $MOVE_B -eq 3 ]; then RESULT="A wins"
  elif [ $MOVE_A -eq 2 ] && [ $MOVE_B -eq 1 ]; then RESULT="A wins"
  elif [ $MOVE_A -eq 3 ] && [ $MOVE_B -eq 2 ]; then RESULT="A wins"
  else RESULT="B wins"; fi
  
  rps_count=$((rps_count+1))
  echo "  ✅ RPS #$rps_count: ${MOVES[$MOVE_A]} vs ${MOVES[$MOVE_B]} → $RESULT (match $MATCH_ID)"
}

play_coinflip() {
  local SECRET_A=$(openssl rand -hex 32)
  local SECRET_B=$(openssl rand -hex 32)
  local COMMIT_A=$(cast keccak "0x$SECRET_A")
  local COMMIT_B=$(cast keccak "0x$SECRET_B")
  
  # Create
  local TX=$(cast send $CF "createFlip(bytes32)" $COMMIT_A --value 0.005ether --private-key $PK_A --rpc-url $RPC --json 2>/dev/null)
  local STATUS=$(echo $TX | jq -r '.status')
  if [ "$STATUS" != "0x1" ]; then echo "  CF create failed"; errors=$((errors+1)); return; fi
  
  local FLIP_ID=$(echo $TX | jq -r '.logs[0].topics[1]')
  
  # Join
  cast send $CF "joinFlip(uint256,bytes32)" $FLIP_ID $COMMIT_B --value 0.005ether --private-key $PK_B --rpc-url $RPC --json >/dev/null 2>&1
  
  # Reveal both
  cast send $CF "revealSecret(uint256,bytes32)" $FLIP_ID "0x$SECRET_A" --private-key $PK_A --rpc-url $RPC --json >/dev/null 2>&1
  cast send $CF "revealSecret(uint256,bytes32)" $FLIP_ID "0x$SECRET_B" --private-key $PK_B --rpc-url $RPC --json >/dev/null 2>&1
  
  cf_count=$((cf_count+1))
  echo "  ✅ CoinFlip #$cf_count: resolved (flip $FLIP_ID)"
}

echo ""
echo "Playing matches..."

for i in $(seq 1 15); do
  if [ $((i % 3)) -eq 0 ]; then
    play_coinflip
  else
    play_rps
  fi
done

echo ""
echo "╔════════════════════════════════════════╗"
echo "║  Results: RPS=$rps_count CF=$cf_count Err=$errors"
echo "║  A: $(cast balance 0x4Bf368009d5a6426995935D243577b40368ED8C6 --rpc-url $RPC --ether) MON"
echo "║  B: $(cast balance 0x3E336C0052Ef2548ef012259459eD12E9a4Aa665 --rpc-url $RPC --ether) MON"
echo "╚════════════════════════════════════════╝"
