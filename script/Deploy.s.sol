// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/GameRegistry.sol";
import "../src/BattleshipArena.sol";
import "../src/RPSArena.sol";

contract DeployScript is Script {
    function run() external {
        vm.startBroadcast();

        // 1. Deploy GameRegistry
        GameRegistry registry = new GameRegistry();
        console.log("GameRegistry deployed at:", address(registry));

        // 2. Deploy BattleshipArena
        BattleshipArena battleship = new BattleshipArena(address(registry));
        console.log("BattleshipArena deployed at:", address(battleship));

        // 3. Deploy RPSArena
        RPSArena rps = new RPSArena(address(registry));
        console.log("RPSArena deployed at:", address(rps));

        // 4. Authorize game contracts in registry
        registry.authorizeGame(address(battleship));
        registry.authorizeGame(address(rps));
        console.log("Both games authorized in registry");

        vm.stopBroadcast();
    }
}
