# MonadGladiator — Strategy Engine

## 🚢 Battleship Strategy

### Ship Placement (Probability-Based)
- **Avoid edges**: Ships placed 1+ cells from borders are harder to find
- **Avoid clustering**: Minimum 1 cell gap between ships
- **Diagonal bias**: Ships oriented to break standard search patterns
- **Randomized rotation**: 50/50 horizontal vs vertical placement per ship

### Shot Selection — Hunt & Target Algorithm

**Hunt Mode** (no active target):
- Fire in **checkerboard pattern** (only cells where (row+col) % 2 == 0)
- This guarantees finding every ship in max 50 shots (vs 100 for random)
- Prioritize center cells (higher probability of containing ships)
- Probability heat map: center cells weighted 1.5x vs corners

**Target Mode** (after a hit):
1. Fire at all 4 adjacent cells (up, down, left, right)
2. Once 2+ hits align, follow the line in both directions
3. After sinking a ship, return to Hunt Mode
4. If adjacent shots all miss, mark as isolated hit and resume hunting

### Adaptive Behavior
- Track opponent's ship placement patterns across matches
- If opponent clusters ships → narrow search to clusters
- If opponent uses edges → sweep edges earlier
- If opponent uses random/spread → stick to checkerboard

## 🪨📄✂️ RPS Strategy

### Round-by-Round Logic

**Round 1** — Weighted Random:
- Rock: 30%, Paper: 40%, Scissors: 30%
- Slight Paper bias (most humans/agents open Rock — "Rock is strong")

**Round 2** — Frequency Counter:
- Track opponent's Round 1 choice
- Play the choice that beats their most common pick
- If they played Rock → play Paper
- Add 20% random noise to avoid being predictable

**Round 3** — Meta-Game:
- If opponent is counter-adapting (they beat our last choice), go level-2
  - Level-2: they expect us to counter their counter, so counter THAT
- If score is 1-0 (we're winning): play conservatively (repeat winning choice)
- If score is 0-1 (we're losing): play aggressively (switch strategy entirely)

### Pattern Detection
- Track choice history across multiple matches vs same opponent
- Detect sequences: RRPS → likely R next (repetition bias)
- Detect anti-patterns: if opponent always counters our last move, exploit it
- Nash equilibrium fallback: if no pattern detected, play true 33/33/33

## 💰 Bankroll Management (Kelly Criterion)

### Position Sizing
```
Optimal wager = Bankroll × (edge / odds)

Where:
  edge = (win_rate × payout_ratio) - (1 - win_rate)
  odds = payout_ratio (1.95 after 2.5% fee on 2x pot)
```

### Rules
| Win Rate | Max Wager (% of bankroll) |
|----------|--------------------------|
| > 60%    | 15%                      |
| 40-60%   | 10%                      |
| < 40%    | 5%                       |

### Guardrails
- **Hard floor**: Always keep minimum 0.5 MON in reserve
- **Stop-loss**: Stop playing if bankroll drops 30% in a session
- **Hot streak**: After 3+ consecutive wins, increase aggression by 5%
- **Cold streak**: After 2+ consecutive losses, decrease by 5% and switch game type
- **Session tracking**: Log P&L per session and per opponent

## 🧠 Psychological Tactics

### Pre-Match
- Send trash talk: "Ready to lose your MON? 😈"
- Display win streak if > 2: "On a 5-game streak. You sure about this? 🔥"
- Name: **MonadGladiator 🏛️⚔️** in all interactions

### During Battleship
- Occasionally delay moves by 30-60s (within timeout) to create pressure
- After sinking a ship, send: "That's [N] down, [5-N] to go 💀"

### During RPS
- Establish a pattern intentionally in early rounds, then break it
- After a win: "Too easy 🥱"
- After a loss: "Interesting... adjusting 🎯"

### Post-Match
- Post win streaks publicly to attract challengers
- Share ELO after significant gains: "ELO: 1350 📈 Who's next?"
