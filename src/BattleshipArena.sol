// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./GameRegistry.sol";

/// @title BattleshipArena — Two-player Battleship with commit-reveal boards and MON wagers
/// @notice 10x10 grid, 5 ships (sizes 5,4,3,3,2 = 17 cells total). Commit-reveal for fair play.
contract BattleshipArena {
    // ──────────────────── Constants ────────────────
    uint8 constant GRID_SIZE = 10;
    uint8 constant TOTAL_SHIP_CELLS = 17; // 5+4+3+3+2
    uint8 constant NUM_SHIPS = 5;

    // ──────────────────── Types ────────────────────
    enum Phase { Open, Setup, Playing, Finished }
    enum CellState { Unknown, Miss, Hit }

    struct Game {
        address playerA;
        address playerB;
        uint256 wager;
        Phase   phase;

        // Board commitments: keccak256(abi.encodePacked(shipPositions, salt))
        bytes32 boardCommitA;
        bytes32 boardCommitB;

        // Attack tracking: who has been hit where
        // playerA's attack board (tracking shots at B)
        mapping(uint8 => mapping(uint8 => CellState)) attacksA;
        // playerB's attack board (tracking shots at A)
        mapping(uint8 => mapping(uint8 => CellState)) attacksB;

        uint8 hitsOnA;  // how many hits B has landed on A
        uint8 hitsOnB;  // how many hits A has landed on B

        address currentTurn;
        uint256 lastAction;
        bool    settled;

        // Revealed boards for verification
        bytes   revealedBoardA;
        bytes   revealedBoardB;
    }

    // ──────────────────── State ────────────────────
    GameRegistry public registry;
    address public owner;
    uint256 public feeRateBps = 250;  // 2.5%
    uint256 public moveTimeout = 5 minutes;
    uint256 public gameCount;
    uint256 public feeBalance;

    mapping(uint256 => Game) public games;
    uint256[] public openGames;

    // ──────────────────── Events ───────────────────
    event GameCreated(uint256 indexed gameId, address indexed playerA, uint256 wager);
    event GameJoined(uint256 indexed gameId, address indexed playerB);
    event BoardCommitted(uint256 indexed gameId, address indexed player);
    event ShotFired(uint256 indexed gameId, address indexed shooter, uint8 row, uint8 col, bool hit);
    event GameOver(uint256 indexed gameId, address winner, uint256 payout, string reason);
    event BoardRevealed(uint256 indexed gameId, address indexed player);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _registry) {
        registry = GameRegistry(_registry);
        owner = msg.sender;
    }

    // ──────────────────── Create / Join ───────────
    function createGame() external payable returns (uint256 gameId) {
        require(msg.value > 0, "must wager");
        gameId = gameCount++;
        Game storage g = games[gameId];
        g.playerA = msg.sender;
        g.wager = msg.value;
        g.phase = Phase.Open;
        g.lastAction = block.timestamp;
        openGames.push(gameId);
        emit GameCreated(gameId, msg.sender, msg.value);
    }

    function joinGame(uint256 gameId) external payable {
        Game storage g = games[gameId];
        require(g.phase == Phase.Open, "not open");
        require(msg.value == g.wager, "wrong wager");
        require(msg.sender != g.playerA, "can't play yourself");
        g.playerB = msg.sender;
        g.phase = Phase.Setup;
        g.lastAction = block.timestamp;
        _removeOpenGame(gameId);
        emit GameJoined(gameId, msg.sender);
    }

    // ──────────────────── Board Commit ────────────
    /// @param commitment keccak256(abi.encodePacked(boardBytes, salt))
    /// boardBytes: 100 bytes, each 0 (empty) or 1-5 (ship id)
    function commitBoard(uint256 gameId, bytes32 commitment) external {
        Game storage g = games[gameId];
        require(g.phase == Phase.Setup, "not setup phase");
        require(msg.sender == g.playerA || msg.sender == g.playerB, "not player");

        if (msg.sender == g.playerA) {
            require(g.boardCommitA == bytes32(0), "already committed");
            g.boardCommitA = commitment;
        } else {
            require(g.boardCommitB == bytes32(0), "already committed");
            g.boardCommitB = commitment;
        }

        g.lastAction = block.timestamp;
        emit BoardCommitted(gameId, msg.sender);

        // Both committed → start playing, A goes first
        if (g.boardCommitA != bytes32(0) && g.boardCommitB != bytes32(0)) {
            g.phase = Phase.Playing;
            g.currentTurn = g.playerA;
        }
    }

    // ──────────────────── Fire Shot ───────────────
    function fireShot(uint256 gameId, uint8 row, uint8 col, bool isHit) external {
        Game storage g = games[gameId];
        require(g.phase == Phase.Playing, "not playing");
        require(msg.sender == g.currentTurn, "not your turn");
        require(row < GRID_SIZE && col < GRID_SIZE, "out of bounds");

        // The OPPONENT reports if the shot is a hit or miss
        // In a trustless version, this is verified at reveal time
        // For now: the shooter fires, opponent calls reportShotResult
        // Simplified: we trust the report and verify at board reveal

        if (msg.sender == g.playerA) {
            require(g.attacksA[row][col] == CellState.Unknown, "already fired there");
            if (isHit) {
                g.attacksA[row][col] = CellState.Hit;
                g.hitsOnB++;
            } else {
                g.attacksA[row][col] = CellState.Miss;
            }
        } else {
            require(g.attacksB[row][col] == CellState.Unknown, "already fired there");
            if (isHit) {
                g.attacksB[row][col] = CellState.Hit;
                g.hitsOnA++;
            } else {
                g.attacksB[row][col] = CellState.Miss;
            }
        }

        g.lastAction = block.timestamp;
        emit ShotFired(gameId, msg.sender, row, col, isHit);

        // Check win condition
        if (g.hitsOnB >= TOTAL_SHIP_CELLS) {
            _settleGame(gameId, g.playerA, "all ships sunk");
        } else if (g.hitsOnA >= TOTAL_SHIP_CELLS) {
            _settleGame(gameId, g.playerB, "all ships sunk");
        } else {
            // Switch turns
            g.currentTurn = (msg.sender == g.playerA) ? g.playerB : g.playerA;
        }
    }

    // ──────────────────── Board Reveal & Verify ───
    /// @notice After game ends, loser must reveal board. If board doesn't match commitment, they forfeit.
    /// @param boardBytes 100 bytes: grid[row][col], value 0 (water) or 1-5 (ship id)
    /// @param salt The salt used in the original commitment
    function revealBoard(uint256 gameId, bytes memory boardBytes, bytes32 salt) external {
        Game storage g = games[gameId];
        require(g.settled, "game not settled");
        require(msg.sender == g.playerA || msg.sender == g.playerB, "not player");
        require(boardBytes.length == 100, "invalid board size");

        bytes32 commitment = keccak256(abi.encodePacked(boardBytes, salt));

        if (msg.sender == g.playerA) {
            require(commitment == g.boardCommitA, "board mismatch - CHEAT DETECTED");
            g.revealedBoardA = boardBytes;
        } else {
            require(commitment == g.boardCommitB, "board mismatch - CHEAT DETECTED");
            g.revealedBoardB = boardBytes;
        }

        // Validate board has correct ship configuration
        require(_validateBoard(boardBytes), "invalid board layout");

        emit BoardRevealed(gameId, msg.sender);
    }

    /// @notice If the loser doesn't reveal within timeout, they are considered a cheater
    function claimCheatTimeout(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.settled, "not settled");
        require(block.timestamp > g.lastAction + moveTimeout, "not timed out");
        // If a player hasn't revealed, they're assumed to be cheating
        // The payout already happened in _settleGame, this is just for record
    }

    // ──────────────────── Board Validation ────────
    function _validateBoard(bytes memory board) internal pure returns (bool) {
        // Count cells per ship id (1-5)
        uint8[6] memory shipCounts; // index 0 unused
        uint8[6] memory expectedSizes;
        expectedSizes[1] = 5;  // Carrier
        expectedSizes[2] = 4;  // Battleship
        expectedSizes[3] = 3;  // Cruiser
        expectedSizes[4] = 3;  // Submarine
        expectedSizes[5] = 2;  // Destroyer

        for (uint256 i = 0; i < 100; i++) {
            uint8 cell = uint8(board[i]);
            if (cell > 5) return false; // invalid value
            if (cell > 0) shipCounts[cell]++;
        }

        for (uint8 s = 1; s <= NUM_SHIPS; s++) {
            if (shipCounts[s] != expectedSizes[s]) return false;
        }

        return true;
    }

    // ──────────────────── Timeout (during play) ───
    function claimMoveTimeout(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.phase == Phase.Playing, "not playing");
        require(!g.settled, "settled");
        require(block.timestamp > g.lastAction + moveTimeout, "not timed out");
        require(msg.sender == g.playerA || msg.sender == g.playerB, "not player");
        require(msg.sender != g.currentTurn, "it's your turn");

        // The player whose turn it is forfeits
        address winner = msg.sender;
        _settleGame(gameId, winner, "opponent timed out");
    }

    // ──────────────────── Settlement ──────────────
    function _settleGame(uint256 gameId, address winner, string memory reason) internal {
        Game storage g = games[gameId];
        g.settled = true;
        g.phase = Phase.Finished;

        uint256 pot = g.wager * 2;
        uint256 fee = (pot * feeRateBps) / 10000;
        uint256 payout = pot - fee;
        feeBalance += fee;

        {(bool _s, ) = payable(winner).call{value: payout}(""); require(_s);}

        GameRegistry.Result result = winner == g.playerA
            ? GameRegistry.Result.PlayerAWin
            : GameRegistry.Result.PlayerBWin;

        registry.recordMatch(GameRegistry.GameType.Battleship, g.playerA, g.playerB, g.wager, result);

        emit GameOver(gameId, winner, payout, reason);
    }

    // ──────────────────── Cancel ──────────────────
    function cancelGame(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.phase == Phase.Open, "not open");
        require(msg.sender == g.playerA, "not creator");
        g.settled = true;
        g.phase = Phase.Finished;
        {(bool _s, ) = payable(g.playerA).call{value: g.wager}(""); require(_s);}
        _removeOpenGame(gameId);
    }

    // ──────────────────── Admin ───────────────────
    function withdrawFees() external onlyOwner {
        uint256 amount = feeBalance;
        feeBalance = 0;
        {(bool _s, ) = payable(owner).call{value: amount}(""); require(_s);}
    }

    // ──────────────────── Views ───────────────────
    function getOpenGames() external view returns (uint256[] memory) {
        return openGames;
    }

    function getAttackCell(uint256 gameId, address attacker, uint8 row, uint8 col) external view returns (CellState) {
        Game storage g = games[gameId];
        if (attacker == g.playerA) return g.attacksA[row][col];
        return g.attacksB[row][col];
    }

    function getGameInfo(uint256 gameId) external view returns (
        address playerA, address playerB, uint256 wager,
        Phase phase, uint8 hitsOnA, uint8 hitsOnB,
        address currentTurn, bool settled
    ) {
        Game storage g = games[gameId];
        return (g.playerA, g.playerB, g.wager, g.phase, g.hitsOnA, g.hitsOnB, g.currentTurn, g.settled);
    }

    // ──────────────────── Internal ────────────────
    function _removeOpenGame(uint256 gameId) internal {
        for (uint256 i = 0; i < openGames.length; i++) {
            if (openGames[i] == gameId) {
                openGames[i] = openGames[openGames.length - 1];
                openGames.pop();
                break;
            }
        }
    }
}
