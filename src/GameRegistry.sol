// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title GameRegistry — Coordination, ELO ratings, stats, and leaderboard
/// @notice Tracks all matches across game types for MonadGladiator
contract GameRegistry {
    // ──────────────────── Types ────────────────────
    enum GameType { Battleship, RPS }
    enum Result  { PlayerAWin, PlayerBWin, Draw }

    struct PlayerStats {
        uint256 wins;
        uint256 losses;
        uint256 draws;
        uint256 totalWagered;
        uint256 totalWon;
        uint16  elo;           // starts at 1200
        bool    exists;
    }

    struct MatchRecord {
        GameType gameType;
        address  playerA;
        address  playerB;
        uint256  wager;
        Result   result;
        uint256  timestamp;
    }

    // ──────────────────── State ────────────────────
    address public owner;
    mapping(address => bool)        public authorizedGames;  // game contracts that can report
    mapping(address => PlayerStats) public stats;
    MatchRecord[]                   public matches;
    address[]                       public playerList;       // for leaderboard iteration

    // ──────────────────── Events ───────────────────
    event GameAuthorized(address indexed game);
    event MatchRecorded(uint256 indexed matchId, GameType gameType, address playerA, address playerB, Result result, uint256 wager);
    event PlayerRegistered(address indexed player);

    // ──────────────────── Modifiers ───────────────
    modifier onlyOwner()          { require(msg.sender == owner, "not owner"); _; }
    modifier onlyAuthorizedGame() { require(authorizedGames[msg.sender], "not authorized game"); _; }

    constructor() { owner = msg.sender; }

    // ──────────────────── Admin ───────────────────
    function authorizeGame(address game) external onlyOwner {
        authorizedGames[game] = true;
        emit GameAuthorized(game);
    }

    // ──────────────────── Registration ────────────
    function _ensureRegistered(address player) internal {
        if (!stats[player].exists) {
            stats[player] = PlayerStats(0, 0, 0, 0, 0, 1200, true);
            playerList.push(player);
            emit PlayerRegistered(player);
        }
    }

    // ──────────────────── Match Reporting ─────────
    function recordMatch(
        GameType gameType,
        address  playerA,
        address  playerB,
        uint256  wager,
        Result   result
    ) external onlyAuthorizedGame {
        _ensureRegistered(playerA);
        _ensureRegistered(playerB);

        uint256 matchId = matches.length;
        matches.push(MatchRecord(gameType, playerA, playerB, wager, result, block.timestamp));

        // Update stats
        stats[playerA].totalWagered += wager;
        stats[playerB].totalWagered += wager;

        if (result == Result.PlayerAWin) {
            stats[playerA].wins++;
            stats[playerA].totalWon += wager * 2; // won the pot
            stats[playerB].losses++;
            _updateElo(playerA, playerB, true);
        } else if (result == Result.PlayerBWin) {
            stats[playerB].wins++;
            stats[playerB].totalWon += wager * 2;
            stats[playerA].losses++;
            _updateElo(playerB, playerA, true);
        } else {
            stats[playerA].draws++;
            stats[playerB].draws++;
        }

        emit MatchRecorded(matchId, gameType, playerA, playerB, result, wager);
    }

    // ──────────────────── ELO ─────────────────────
    /// @dev Simplified ELO: K=32, integer math
    function _updateElo(address winner, address loser, bool decisive) internal {
        if (!decisive) return;
        uint16 rW = stats[winner].elo;
        uint16 rL = stats[loser].elo;

        // Expected score (scaled by 1000 for integer math)
        uint256 diff = rW >= rL ? uint256(rW - rL) : uint256(rL - rW);
        if (diff > 400) diff = 400; // cap

        // Winner expected ~= 1000 * 1/(1+10^(-diff/400))  ≈ linear approx
        // Simple linear approx: expectedW = 500 + diff * 500 / 400 when winner is higher rated
        uint256 expectedW;
        if (rW >= rL) {
            expectedW = 500 + (diff * 500) / 400;
        } else {
            expectedW = 500 - (diff * 500) / 400;
        }
        if (expectedW > 950) expectedW = 950;
        if (expectedW < 50)  expectedW = 50;

        // K * (actual - expected) / 1000
        uint256 deltaW = (32 * (1000 - expectedW)) / 1000;
        uint256 deltaL = (32 * expectedW) / 1000;

        if (deltaW < 1) deltaW = 1;
        if (deltaL < 1) deltaL = 1;

        stats[winner].elo = rW + uint16(deltaW);
        stats[loser].elo  = rL > uint16(deltaL) ? rL - uint16(deltaL) : 100;
    }

    // ──────────────────── Views ───────────────────
    function getPlayerStats(address player) external view returns (PlayerStats memory) {
        return stats[player];
    }

    function totalMatches() external view returns (uint256) {
        return matches.length;
    }

    function totalPlayers() external view returns (uint256) {
        return playerList.length;
    }

    function getMatch(uint256 id) external view returns (MatchRecord memory) {
        return matches[id];
    }

    /// @notice Return top N players by ELO (simple sort — fine for small sets)
    function leaderboard(uint256 topN) external view returns (address[] memory players, uint16[] memory elos) {
        uint256 len = playerList.length;
        if (topN > len) topN = len;

        // Copy to memory for sorting
        address[] memory all = new address[](len);
        uint16[]  memory allElo = new uint16[](len);
        for (uint256 i = 0; i < len; i++) {
            all[i] = playerList[i];
            allElo[i] = stats[playerList[i]].elo;
        }

        // Selection sort top N
        for (uint256 i = 0; i < topN; i++) {
            uint256 best = i;
            for (uint256 j = i + 1; j < len; j++) {
                if (allElo[j] > allElo[best]) best = j;
            }
            if (best != i) {
                (all[i], all[best]) = (all[best], all[i]);
                (allElo[i], allElo[best]) = (allElo[best], allElo[i]);
            }
        }

        players = new address[](topN);
        elos    = new uint16[](topN);
        for (uint256 i = 0; i < topN; i++) {
            players[i] = all[i];
            elos[i]    = allElo[i];
        }
    }

    /// @notice Win rate in basis points (0-10000)
    function winRate(address player) external view returns (uint256) {
        PlayerStats memory s = stats[player];
        uint256 total = s.wins + s.losses + s.draws;
        if (total == 0) return 0;
        return (s.wins * 10000) / total;
    }
}
