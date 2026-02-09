// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./GameRegistry.sol";

/// @title CoinFlipArena — Provably fair coin flip using commit-reveal randomness
/// @notice Both players commit secrets, combined hash determines the flip.
///         Neither player can predict or manipulate the outcome.
contract CoinFlipArena {
    // ──────────────────── Types ────────────────────
    enum Phase { Open, BothCommitted, Revealed, Finished }

    struct Flip {
        address playerA;
        address playerB;
        uint256 wager;
        Phase   phase;
        bytes32 commitA;
        bytes32 commitB;
        bytes32 secretA;
        bytes32 secretB;
        bool    revealedA;
        bool    revealedB;
        bool    resultHeads;    // true = heads (playerA wins), false = tails (playerB wins)
        address winner;
        uint256 lastAction;
        bool    settled;
    }

    // ──────────────────── State ────────────────────
    GameRegistry public registry;
    address public owner;
    uint256 public feeRateBps = 250;  // 2.5%
    uint256 public revealTimeout = 5 minutes;
    uint256 public feeBalance;

    Flip[] public flips;
    uint256[] public openFlips;

    // ──────────────────── Events ───────────────────
    event FlipCreated(uint256 indexed flipId, address indexed playerA, uint256 wager);
    event FlipJoined(uint256 indexed flipId, address indexed playerB);
    event SecretCommitted(uint256 indexed flipId, address indexed player);
    event SecretRevealed(uint256 indexed flipId, address indexed player);
    event FlipResult(uint256 indexed flipId, bool heads, address winner, uint256 payout);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _registry) {
        registry = GameRegistry(_registry);
        owner = msg.sender;
    }

    // ──────────────────── Create / Join ───────────
    /// @notice Create a flip and commit your secret in one tx
    /// @param commitment keccak256(abi.encodePacked(secret))
    function createFlip(bytes32 commitment) external payable returns (uint256 flipId) {
        require(msg.value > 0, "must wager");
        require(commitment != bytes32(0), "empty commitment");

        flipId = flips.length;
        flips.push();
        Flip storage f = flips[flipId];
        f.playerA = msg.sender;
        f.wager = msg.value;
        f.phase = Phase.Open;
        f.commitA = commitment;
        f.lastAction = block.timestamp;
        openFlips.push(flipId);

        emit FlipCreated(flipId, msg.sender, msg.value);
        emit SecretCommitted(flipId, msg.sender);
    }

    /// @notice Join and commit your secret in one tx
    function joinFlip(uint256 flipId, bytes32 commitment) external payable {
        Flip storage f = flips[flipId];
        require(f.phase == Phase.Open, "not open");
        require(msg.value == f.wager, "wrong wager");
        require(msg.sender != f.playerA, "can't play yourself");
        require(commitment != bytes32(0), "empty commitment");

        f.playerB = msg.sender;
        f.commitB = commitment;
        f.phase = Phase.BothCommitted;
        f.lastAction = block.timestamp;
        _removeOpenFlip(flipId);

        emit FlipJoined(flipId, msg.sender);
        emit SecretCommitted(flipId, msg.sender);
    }

    // ──────────────────── Reveal ──────────────────
    function revealSecret(uint256 flipId, bytes32 secret) external {
        Flip storage f = flips[flipId];
        require(f.phase == Phase.BothCommitted || f.phase == Phase.Revealed, "not in reveal phase");
        require(!f.settled, "settled");

        bytes32 commitment = keccak256(abi.encodePacked(secret));

        if (msg.sender == f.playerA) {
            require(!f.revealedA, "already revealed");
            require(commitment == f.commitA, "commitment mismatch");
            f.secretA = secret;
            f.revealedA = true;
        } else if (msg.sender == f.playerB) {
            require(!f.revealedB, "already revealed");
            require(commitment == f.commitB, "commitment mismatch");
            f.secretB = secret;
            f.revealedB = true;
        } else {
            revert("not player");
        }

        f.lastAction = block.timestamp;
        f.phase = Phase.Revealed;
        emit SecretRevealed(flipId, msg.sender);

        // Both revealed → determine outcome
        if (f.revealedA && f.revealedB) {
            _resolveFlip(flipId);
        }
    }

    // ──────────────────── Resolution ──────────────
    function _resolveFlip(uint256 flipId) internal {
        Flip storage f = flips[flipId];

        // Combine both secrets for provably fair randomness
        bytes32 combined = keccak256(abi.encodePacked(f.secretA, f.secretB));
        f.resultHeads = uint256(combined) % 2 == 0;

        address winner = f.resultHeads ? f.playerA : f.playerB;
        f.winner = winner;
        f.settled = true;
        f.phase = Phase.Finished;

        uint256 pot = f.wager * 2;
        uint256 fee = (pot * feeRateBps) / 10000;
        uint256 payout = pot - fee;
        feeBalance += fee;

        payable(winner).transfer(payout);

        // Record in registry
        GameRegistry.Result result = winner == f.playerA
            ? GameRegistry.Result.PlayerAWin
            : GameRegistry.Result.PlayerBWin;

        // Use Battleship type slot for CoinFlip (or we could add a new type)
        // For now, record as a match — the registry supports it
        registry.recordMatch(GameRegistry.GameType.Battleship, f.playerA, f.playerB, f.wager, result);

        emit FlipResult(flipId, f.resultHeads, winner, payout);
    }

    // ──────────────────── Timeout ─────────────────
    function claimRevealTimeout(uint256 flipId) external {
        Flip storage f = flips[flipId];
        require(f.phase == Phase.BothCommitted || f.phase == Phase.Revealed, "wrong phase");
        require(!f.settled, "settled");
        require(block.timestamp > f.lastAction + revealTimeout, "not timed out");
        require(msg.sender == f.playerA || msg.sender == f.playerB, "not player");

        // Player who revealed wins; if neither revealed, caller wins
        address winner;
        if (f.revealedA && !f.revealedB) winner = f.playerA;
        else if (f.revealedB && !f.revealedA) winner = f.playerB;
        else winner = msg.sender;

        f.winner = winner;
        f.settled = true;
        f.phase = Phase.Finished;

        uint256 pot = f.wager * 2;
        uint256 fee = (pot * feeRateBps) / 10000;
        uint256 payout = pot - fee;
        feeBalance += fee;

        payable(winner).transfer(payout);

        GameRegistry.Result result = winner == f.playerA
            ? GameRegistry.Result.PlayerAWin
            : GameRegistry.Result.PlayerBWin;
        registry.recordMatch(GameRegistry.GameType.Battleship, f.playerA, f.playerB, f.wager, result);

        emit FlipResult(flipId, false, winner, payout);
    }

    // ──────────────────── Cancel ──────────────────
    function cancelFlip(uint256 flipId) external {
        Flip storage f = flips[flipId];
        require(f.phase == Phase.Open, "not open");
        require(msg.sender == f.playerA, "not creator");
        f.settled = true;
        f.phase = Phase.Finished;
        payable(f.playerA).transfer(f.wager);
        _removeOpenFlip(flipId);
    }

    // ──────────────────── Admin ───────────────────
    function withdrawFees() external onlyOwner {
        uint256 amount = feeBalance;
        feeBalance = 0;
        payable(owner).transfer(amount);
    }

    // ──────────────────── Views ───────────────────
    function getOpenFlips() external view returns (uint256[] memory) {
        return openFlips;
    }

    function totalFlips() external view returns (uint256) {
        return flips.length;
    }

    // ──────────────────── Internal ────────────────
    function _removeOpenFlip(uint256 flipId) internal {
        for (uint256 i = 0; i < openFlips.length; i++) {
            if (openFlips[i] == flipId) {
                openFlips[i] = openFlips[openFlips.length - 1];
                openFlips.pop();
                break;
            }
        }
    }
}
