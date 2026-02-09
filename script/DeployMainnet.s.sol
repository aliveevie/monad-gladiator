// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/GameRegistry.sol";
import "../src/RPSArena.sol";
import "../src/BattleshipArena.sol";
import "../src/CoinFlipArena.sol";
import "../src/TournamentManager.sol";

contract DeployMainnet is Script {
    function run() external {
        vm.startBroadcast();

        // Deploy all contracts
        GameRegistry registry = new GameRegistry();
        console.log("GameRegistry:", address(registry));

        RPSArena rps = new RPSArena(address(registry));
        console.log("RPSArena:", address(rps));

        BattleshipArena battleship = new BattleshipArena(address(registry));
        console.log("BattleshipArena:", address(battleship));

        CoinFlipArena coinflip = new CoinFlipArena(address(registry));
        console.log("CoinFlipArena:", address(coinflip));

        TournamentManager tournament = new TournamentManager(address(registry), address(rps));
        console.log("TournamentManager:", address(tournament));

        // Authorize all arenas
        registry.authorizeGame(address(rps));
        registry.authorizeGame(address(battleship));
        registry.authorizeGame(address(coinflip));
        registry.authorizeGame(address(tournament));

        console.log("All arenas authorized!");

        vm.stopBroadcast();
    }
}
