// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./GameRegistry.sol";
import "./RPSArena.sol";

/// @title TournamentManager — Single-elimination bracket tournaments with prize pools
/// @notice Create and manage automated tournaments. Players register, brackets are generated,
///         matches are played through RPSArena, and prizes are distributed automatically.
contract TournamentManager {
    // ──────────────────── Types ────────────────────
    enum TournamentPhase { Registration, InProgress, Completed, Cancelled }

    struct Tournament {
        string   name;
        address  creator;
        uint256  entryFee;          // per player
        uint256  prizePool;         // total collected
        uint8    maxPlayers;        // must be power of 2 (4, 8, 16)
        uint8    registeredCount;
        uint8    currentRound;      // 0-based
        uint8    totalRounds;       // log2(maxPlayers)
        TournamentPhase phase;
        uint256  registrationDeadline;
        address  champion;
        bool     settled;

        // Prize distribution (basis points: 6000 = 60%)
        uint16 firstPlaceBps;      // default 6000 (60%)
        uint16 secondPlaceBps;     // default 3000 (30%)
        uint16 feeBps;             // default 1000 (10%)
    }

    struct BracketSlot {
        address player;
        bool    advanced;
        uint256 matchId;           // RPS match ID (0 = not yet created)
    }

    // ──────────────────── State ────────────────────
    GameRegistry public registry;
    RPSArena    public rpsArena;
    address     public owner;
    uint256     public feeBalance;

    Tournament[] public tournaments;

    // tournamentId => round => slot index => BracketSlot
    mapping(uint256 => mapping(uint8 => mapping(uint8 => BracketSlot))) public brackets;

    // tournamentId => player => registered
    mapping(uint256 => mapping(address => bool)) public isRegistered;

    // tournamentId => registered players list
    mapping(uint256 => address[]) public registeredPlayers;

    // ──────────────────── Events ───────────────────
    event TournamentCreated(uint256 indexed tournamentId, string name, uint256 entryFee, uint8 maxPlayers);
    event PlayerRegistered(uint256 indexed tournamentId, address indexed player, uint8 slot);
    event TournamentStarted(uint256 indexed tournamentId, uint8 totalRounds);
    event BracketMatchCreated(uint256 indexed tournamentId, uint8 round, uint8 matchIndex, uint256 rpsMatchId);
    event PlayerAdvanced(uint256 indexed tournamentId, uint8 round, address indexed player);
    event TournamentCompleted(uint256 indexed tournamentId, address champion, uint256 firstPrize, uint256 secondPrize);
    event TournamentCancelled(uint256 indexed tournamentId);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _registry, address _rpsArena) {
        registry = GameRegistry(_registry);
        rpsArena = RPSArena(_rpsArena);
        owner = msg.sender;
    }

    // ──────────────────── Create Tournament ───────
    function createTournament(
        string calldata name,
        uint256 entryFee,
        uint8 maxPlayers,
        uint256 registrationDuration
    ) external returns (uint256 tournamentId) {
        require(maxPlayers == 4 || maxPlayers == 8 || maxPlayers == 16, "must be 4/8/16 players");
        require(entryFee > 0, "entry fee required");

        tournamentId = tournaments.length;
        tournaments.push();
        Tournament storage t = tournaments[tournamentId];
        t.name = name;
        t.creator = msg.sender;
        t.entryFee = entryFee;
        t.maxPlayers = maxPlayers;
        t.registrationDeadline = block.timestamp + registrationDuration;
        t.phase = TournamentPhase.Registration;
        t.firstPlaceBps = 6000;
        t.secondPlaceBps = 3000;
        t.feeBps = 1000;

        // Calculate total rounds
        if (maxPlayers == 4) t.totalRounds = 2;
        else if (maxPlayers == 8) t.totalRounds = 3;
        else t.totalRounds = 4;

        emit TournamentCreated(tournamentId, name, entryFee, maxPlayers);
    }

    // ──────────────────── Register ────────────────
    function register(uint256 tournamentId) external payable {
        Tournament storage t = tournaments[tournamentId];
        require(t.phase == TournamentPhase.Registration, "not registering");
        require(block.timestamp <= t.registrationDeadline, "registration closed");
        require(msg.value == t.entryFee, "wrong entry fee");
        require(!isRegistered[tournamentId][msg.sender], "already registered");
        require(t.registeredCount < t.maxPlayers, "tournament full");

        isRegistered[tournamentId][msg.sender] = true;
        registeredPlayers[tournamentId].push(msg.sender);
        t.registeredCount++;
        t.prizePool += msg.value;

        emit PlayerRegistered(tournamentId, msg.sender, t.registeredCount - 1);

        // Auto-start when full
        if (t.registeredCount == t.maxPlayers) {
            _startTournament(tournamentId);
        }
    }

    // ──────────────────── Start Tournament ────────
    function startTournament(uint256 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        require(t.phase == TournamentPhase.Registration, "not registering");
        require(block.timestamp > t.registrationDeadline, "registration still open");
        require(t.registeredCount >= 4, "need at least 4 players");

        // Adjust maxPlayers down if needed
        if (t.registeredCount < t.maxPlayers) {
            // Find nearest power of 2
            if (t.registeredCount >= 8) {
                t.maxPlayers = 8;
                t.totalRounds = 3;
            } else {
                t.maxPlayers = 4;
                t.totalRounds = 2;
            }
        }

        _startTournament(tournamentId);
    }

    function _startTournament(uint256 tournamentId) internal {
        Tournament storage t = tournaments[tournamentId];
        t.phase = TournamentPhase.InProgress;

        // Seed bracket (simple sequential for now, could add randomization)
        address[] storage players = registeredPlayers[tournamentId];
        for (uint8 i = 0; i < t.maxPlayers; i++) {
            brackets[tournamentId][0][i].player = players[i];
        }

        emit TournamentStarted(tournamentId, t.totalRounds);
    }

    // ──────────────────── Report Match Result ─────
    /// @notice Called after an RPS match finishes. Advances the winner in the bracket.
    /// @param tournamentId The tournament
    /// @param round Current round (0-based)
    /// @param matchIndex Which match in this round (0,1,2,3...)
    /// @param winner The address that won the RPS match
    function reportMatchResult(
        uint256 tournamentId,
        uint8 round,
        uint8 matchIndex,
        address winner
    ) external {
        Tournament storage t = tournaments[tournamentId];
        require(t.phase == TournamentPhase.InProgress, "not in progress");
        require(round == t.currentRound, "wrong round");

        uint8 slotA = matchIndex * 2;
        uint8 slotB = matchIndex * 2 + 1;

        BracketSlot storage a = brackets[tournamentId][round][slotA];
        BracketSlot storage b = brackets[tournamentId][round][slotB];

        require(winner == a.player || winner == b.player, "winner not in match");
        require(!a.advanced && !b.advanced, "match already resolved");

        // Mark winner as advanced
        if (winner == a.player) {
            a.advanced = true;
        } else {
            b.advanced = true;
        }

        // Place winner in next round
        if (round + 1 < t.totalRounds) {
            brackets[tournamentId][round + 1][matchIndex].player = winner;
        }

        emit PlayerAdvanced(tournamentId, round, winner);

        // Check if all matches in this round are done
        uint8 matchesInRound = t.maxPlayers >> (round + 1);
        bool allDone = true;
        for (uint8 i = 0; i < matchesInRound; i++) {
            uint8 sA = i * 2;
            uint8 sB = i * 2 + 1;
            if (!brackets[tournamentId][round][sA].advanced && 
                !brackets[tournamentId][round][sB].advanced) {
                allDone = false;
                break;
            }
        }

        if (allDone) {
            if (round + 1 == t.totalRounds) {
                // Tournament complete!
                _completeTournament(tournamentId, winner);
            } else {
                t.currentRound = round + 1;
            }
        }
    }

    // ──────────────────── Complete ────────────────
    function _completeTournament(uint256 tournamentId, address champion) internal {
        Tournament storage t = tournaments[tournamentId];
        t.phase = TournamentPhase.Completed;
        t.champion = champion;
        t.settled = true;

        uint256 firstPrize = (t.prizePool * t.firstPlaceBps) / 10000;
        uint256 fee = (t.prizePool * t.feeBps) / 10000;
        uint256 secondPrize = t.prizePool - firstPrize - fee;

        // Find second place (the other finalist)
        address secondPlace;
        uint8 finalRound = t.totalRounds - 1;
        BracketSlot storage finalA = brackets[tournamentId][finalRound][0];
        BracketSlot storage finalB = brackets[tournamentId][finalRound][1];
        secondPlace = (finalA.player == champion) ? finalB.player : finalA.player;

        feeBalance += fee;
        payable(champion).transfer(firstPrize);
        if (secondPlace != address(0)) {
            payable(secondPlace).transfer(secondPrize);
        }

        emit TournamentCompleted(tournamentId, champion, firstPrize, secondPrize);
    }

    // ──────────────────── Cancel ──────────────────
    function cancelTournament(uint256 tournamentId) external {
        Tournament storage t = tournaments[tournamentId];
        require(msg.sender == t.creator || msg.sender == owner, "not authorized");
        require(t.phase == TournamentPhase.Registration, "can only cancel during registration");

        t.phase = TournamentPhase.Cancelled;

        // Refund all registered players
        address[] storage players = registeredPlayers[tournamentId];
        for (uint256 i = 0; i < players.length; i++) {
            payable(players[i]).transfer(t.entryFee);
        }

        emit TournamentCancelled(tournamentId);
    }

    // ──────────────────── Admin ───────────────────
    function withdrawFees() external onlyOwner {
        uint256 amount = feeBalance;
        feeBalance = 0;
        payable(owner).transfer(amount);
    }

    // ──────────────────── Views ───────────────────
    function totalTournaments() external view returns (uint256) {
        return tournaments.length;
    }

    function getTournamentPlayers(uint256 tournamentId) external view returns (address[] memory) {
        return registeredPlayers[tournamentId];
    }

    function getBracketSlot(uint256 tournamentId, uint8 round, uint8 slot) 
        external view returns (address player, bool advanced, uint256 matchId) 
    {
        BracketSlot storage s = brackets[tournamentId][round][slot];
        return (s.player, s.advanced, s.matchId);
    }

    /// @notice Get full bracket for a round
    function getRoundBracket(uint256 tournamentId, uint8 round) 
        external view returns (address[] memory players, bool[] memory advanced) 
    {
        Tournament storage t = tournaments[tournamentId];
        uint8 slots = t.maxPlayers >> round;
        players = new address[](slots);
        advanced = new bool[](slots);
        for (uint8 i = 0; i < slots; i++) {
            players[i] = brackets[tournamentId][round][i].player;
            advanced[i] = brackets[tournamentId][round][i].advanced;
        }
    }
}
