// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/GameRegistry.sol";
import "../src/BattleshipArena.sol";
import "../src/RPSArena.sol";

/// @notice Script to simulate 5+ matches between two wallets (sparring)
contract PlayRPSMatch is Script {
    function run(
        address rpsArena,
        uint256 pkA,
        uint256 pkB,
        uint256 wagerWei
    ) external {
        address addrA = vm.addr(pkA);
        address addrB = vm.addr(pkB);

        // Player A creates match
        vm.startBroadcast(pkA);
        RPSArena rps = RPSArena(rpsArena);
        uint256 matchId = rps.createMatch{value: wagerWei}();
        vm.stopBroadcast();

        // Player B joins
        vm.startBroadcast(pkB);
        rps.joinMatch{value: wagerWei}(matchId);
        vm.stopBroadcast();

        // Play 3 rounds (best of 3)
        // Round 1: A=Rock, B=Scissors → A wins
        bytes32 saltA1 = keccak256("saltA1");
        bytes32 saltB1 = keccak256("saltB1");

        vm.startBroadcast(pkA);
        rps.commitChoice(matchId, keccak256(abi.encodePacked(uint8(1), saltA1))); // Rock
        vm.stopBroadcast();

        vm.startBroadcast(pkB);
        rps.commitChoice(matchId, keccak256(abi.encodePacked(uint8(3), saltB1))); // Scissors
        vm.stopBroadcast();

        vm.startBroadcast(pkA);
        rps.revealChoice(matchId, RPSArena.Choice.Rock, saltA1);
        vm.stopBroadcast();

        vm.startBroadcast(pkB);
        rps.revealChoice(matchId, RPSArena.Choice.Scissors, saltB1);
        vm.stopBroadcast();

        // Round 2: A=Paper, B=Rock → A wins (2-0, match over)
        bytes32 saltA2 = keccak256("saltA2");
        bytes32 saltB2 = keccak256("saltB2");

        vm.startBroadcast(pkA);
        rps.commitChoice(matchId, keccak256(abi.encodePacked(uint8(2), saltA2))); // Paper
        vm.stopBroadcast();

        vm.startBroadcast(pkB);
        rps.commitChoice(matchId, keccak256(abi.encodePacked(uint8(1), saltB2))); // Rock
        vm.stopBroadcast();

        vm.startBroadcast(pkA);
        rps.revealChoice(matchId, RPSArena.Choice.Paper, saltA2);
        vm.stopBroadcast();

        vm.startBroadcast(pkB);
        rps.revealChoice(matchId, RPSArena.Choice.Rock, saltB2);
        vm.stopBroadcast();

        console.log("RPS Match complete! A wins 2-0");
    }
}
