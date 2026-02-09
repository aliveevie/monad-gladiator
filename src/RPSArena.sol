// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./GameRegistry.sol";

/// @title RPSArena — Best-of-3 Rock Paper Scissors with commit-reveal and MON wagers
contract RPSArena {
    // ──────────────────── Types ────────────────────
    enum Choice   { None, Rock, Paper, Scissors }
    enum Phase    { Open, BothCommitted, BothRevealed, Finished }

    struct Round {
        bytes32 commitA;
        bytes32 commitB;
        Choice  choiceA;
        Choice  choiceB;
        bool    revealedA;
        bool    revealedB;
    }

    struct Match {
        address playerA;
        address playerB;
        uint256 wager;
        Phase   phase;
        uint8   scoreA;
        uint8   scoreB;
        uint8   currentRound;   // 0, 1, 2
        uint256 lastAction;     // timestamp for timeout
        bool    settled;
        Round[3] rounds;
    }

    // ──────────────────── State ────────────────────
    GameRegistry public registry;
    address public owner;
    uint256 public feeRateBps = 250;  // 2.5%
    uint256 public moveTimeout = 5 minutes;

    Match[] public matches;
    uint256 public feeBalance;

    // Open matches waiting for opponent
    uint256[] public openMatches;

    // ──────────────────── Events ───────────────────
    event MatchCreated(uint256 indexed matchId, address indexed playerA, uint256 wager);
    event MatchJoined(uint256 indexed matchId, address indexed playerB);
    event RoundCommitted(uint256 indexed matchId, uint8 round, address indexed player);
    event RoundRevealed(uint256 indexed matchId, uint8 round, address indexed player, Choice choice);
    event RoundResult(uint256 indexed matchId, uint8 round, address winner);
    event MatchSettled(uint256 indexed matchId, address winner, uint256 payout);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address _registry) {
        registry = GameRegistry(_registry);
        owner = msg.sender;
    }

    // ──────────────────── Create / Join ───────────
    function createMatch() external payable returns (uint256 matchId) {
        require(msg.value > 0, "must wager");
        matchId = matches.length;
        matches.push();
        Match storage m = matches[matchId];
        m.playerA = msg.sender;
        m.wager = msg.value;
        m.phase = Phase.Open;
        m.lastAction = block.timestamp;
        openMatches.push(matchId);
        emit MatchCreated(matchId, msg.sender, msg.value);
    }

    function joinMatch(uint256 matchId) external payable {
        Match storage m = matches[matchId];
        require(m.phase == Phase.Open, "not open");
        require(msg.value == m.wager, "wrong wager");
        require(msg.sender != m.playerA, "can't play yourself");
        m.playerB = msg.sender;
        m.phase = Phase.BothCommitted; // move to commit phase
        m.lastAction = block.timestamp;
        _removeOpenMatch(matchId);
        emit MatchJoined(matchId, msg.sender);
    }

    // ──────────────────── Commit ──────────────────
    /// @param commitment keccak256(abi.encodePacked(uint8(choice), salt))
    function commitChoice(uint256 matchId, bytes32 commitment) external {
        Match storage m = matches[matchId];
        require(!m.settled, "settled");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "not player");
        uint8 r = m.currentRound;
        Round storage rd = m.rounds[r];

        if (msg.sender == m.playerA) {
            require(rd.commitA == bytes32(0), "already committed");
            rd.commitA = commitment;
        } else {
            require(rd.commitB == bytes32(0), "already committed");
            rd.commitB = commitment;
        }
        m.lastAction = block.timestamp;
        emit RoundCommitted(matchId, r, msg.sender);
    }

    // ──────────────────── Reveal ──────────────────
    function revealChoice(uint256 matchId, Choice choice, bytes32 salt) external {
        Match storage m = matches[matchId];
        require(!m.settled, "settled");
        require(choice != Choice.None, "invalid choice");
        uint8 r = m.currentRound;
        Round storage rd = m.rounds[r];

        bytes32 expected = keccak256(abi.encodePacked(uint8(choice), salt));

        if (msg.sender == m.playerA) {
            require(!rd.revealedA, "already revealed");
            require(rd.commitA == expected, "commitment mismatch");
            rd.choiceA = choice;
            rd.revealedA = true;
        } else if (msg.sender == m.playerB) {
            require(!rd.revealedB, "already revealed");
            require(rd.commitB == expected, "commitment mismatch");
            rd.choiceB = choice;
            rd.revealedB = true;
        } else {
            revert("not player");
        }

        m.lastAction = block.timestamp;
        emit RoundRevealed(matchId, r, msg.sender, choice);

        // If both revealed, resolve round
        if (rd.revealedA && rd.revealedB) {
            _resolveRound(matchId);
        }
    }

    // ──────────────────── Resolution ──────────────
    function _resolveRound(uint256 matchId) internal {
        Match storage m = matches[matchId];
        uint8 r = m.currentRound;
        Round storage rd = m.rounds[r];

        address roundWinner;
        if (rd.choiceA == rd.choiceB) {
            roundWinner = address(0); // draw — replay
        } else if (
            (rd.choiceA == Choice.Rock     && rd.choiceB == Choice.Scissors) ||
            (rd.choiceA == Choice.Paper    && rd.choiceB == Choice.Rock)     ||
            (rd.choiceA == Choice.Scissors && rd.choiceB == Choice.Paper)
        ) {
            m.scoreA++;
            roundWinner = m.playerA;
        } else {
            m.scoreB++;
            roundWinner = m.playerB;
        }

        emit RoundResult(matchId, r, roundWinner);

        // Check for best-of-3 winner
        if (m.scoreA >= 2 || m.scoreB >= 2) {
            _settleMatch(matchId, m.scoreA >= 2 ? m.playerA : m.playerB);
        } else if (r < 2) {
            m.currentRound = r + 1;
        } else {
            // All 3 rounds played — higher score wins, or draw
            if (m.scoreA > m.scoreB) {
                _settleMatch(matchId, m.playerA);
            } else if (m.scoreB > m.scoreA) {
                _settleMatch(matchId, m.playerB);
            } else {
                _settleMatchDraw(matchId);
            }
        }
    }

    function _settleMatch(uint256 matchId, address winner) internal {
        Match storage m = matches[matchId];
        m.settled = true;
        m.phase = Phase.Finished;

        uint256 pot = m.wager * 2;
        uint256 fee = (pot * feeRateBps) / 10000;
        uint256 payout = pot - fee;
        feeBalance += fee;

        {(bool _s, ) = payable(winner).call{value: payout}(""); require(_s);}

        GameRegistry.Result result = winner == m.playerA
            ? GameRegistry.Result.PlayerAWin
            : GameRegistry.Result.PlayerBWin;

        registry.recordMatch(GameRegistry.GameType.RPS, m.playerA, m.playerB, m.wager, result);

        emit MatchSettled(matchId, winner, payout);
    }

    function _settleMatchDraw(uint256 matchId) internal {
        Match storage m = matches[matchId];
        m.settled = true;
        m.phase = Phase.Finished;

        // Return wagers
        {(bool _s, ) = payable(m.playerA).call{value: m.wager}(""); require(_s);}
        {(bool _s, ) = payable(m.playerB).call{value: m.wager}(""); require(_s);}

        registry.recordMatch(GameRegistry.GameType.RPS, m.playerA, m.playerB, m.wager, GameRegistry.Result.Draw);

        emit MatchSettled(matchId, address(0), 0);
    }

    // ──────────────────── Timeout ─────────────────
    function claimTimeout(uint256 matchId) external {
        Match storage m = matches[matchId];
        require(!m.settled, "settled");
        require(m.playerB != address(0), "no opponent");
        require(block.timestamp > m.lastAction + moveTimeout, "not timed out");
        require(msg.sender == m.playerA || msg.sender == m.playerB, "not player");

        // Whoever has acted more recently wins
        uint8 r = m.currentRound;
        Round storage rd = m.rounds[r];

        address winner;
        if (rd.commitA != bytes32(0) && rd.commitB == bytes32(0)) {
            winner = m.playerA;
        } else if (rd.commitB != bytes32(0) && rd.commitA == bytes32(0)) {
            winner = m.playerB;
        } else if (rd.revealedA && !rd.revealedB) {
            winner = m.playerA;
        } else if (rd.revealedB && !rd.revealedA) {
            winner = m.playerB;
        } else {
            // Both in same state — caller wins (they're the active one)
            winner = msg.sender;
        }

        _settleMatch(matchId, winner);
    }

    // ──────────────────── Cancel ──────────────────
    function cancelMatch(uint256 matchId) external {
        Match storage m = matches[matchId];
        require(m.phase == Phase.Open, "not open");
        require(msg.sender == m.playerA, "not creator");
        m.settled = true;
        m.phase = Phase.Finished;
        {(bool _s, ) = payable(m.playerA).call{value: m.wager}(""); require(_s);}
        _removeOpenMatch(matchId);
    }

    // ──────────────────── Admin ───────────────────
    function withdrawFees() external onlyOwner {
        uint256 amount = feeBalance;
        feeBalance = 0;
        {(bool _s, ) = payable(owner).call{value: amount}(""); require(_s);}
    }

    // ──────────────────── Views ───────────────────
    function getOpenMatches() external view returns (uint256[] memory) {
        return openMatches;
    }

    function totalMatches() external view returns (uint256) {
        return matches.length;
    }

    function getRound(uint256 matchId, uint8 round) external view returns (
        bytes32 commitA, bytes32 commitB,
        Choice choiceA, Choice choiceB,
        bool revealedA, bool revealedB
    ) {
        Round storage rd = matches[matchId].rounds[round];
        return (rd.commitA, rd.commitB, rd.choiceA, rd.choiceB, rd.revealedA, rd.revealedB);
    }

    // ──────────────────── Internal ────────────────
    function _removeOpenMatch(uint256 matchId) internal {
        for (uint256 i = 0; i < openMatches.length; i++) {
            if (openMatches[i] == matchId) {
                openMatches[i] = openMatches[openMatches.length - 1];
                openMatches.pop();
                break;
            }
        }
    }
}
