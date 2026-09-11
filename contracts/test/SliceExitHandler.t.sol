// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SliceExecutionGrant, SliceExitHandler} from "../src/SliceExitHandler.sol";

interface HandlerVm {
    function prank(address sender) external;
}

contract RevertingTestRouter {
    fallback() external payable {
        revert("route rejected");
    }
}

contract AcceptingTestPolicy {
    function registerGrant(SliceExecutionGrant calldata, bytes calldata) external pure returns (bytes32) {
        return bytes32(uint256(1));
    }
}

contract HandlerTestPool {
    struct Level {
        uint256 price;
        uint256 quantity;
    }

    function getBookLevels(bool, uint64) external pure returns (Level[] memory levels) {
        levels = new Level[](1);
        levels[0] = Level({ price: 500_000, quantity: 1_000 });
    }
}

contract SliceExitHandlerTest {
    HandlerVm private constant vm = HandlerVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant REACTIVITY_PRECOMPILE = 0x0000000000000000000000000000000000000100;

    function testRejectedRuleDoesNotRevertTheReactivityCallback() public {
        RevertingTestRouter router = new RevertingTestRouter();
        AcceptingTestPolicy policy = new AcceptingTestPolicy();
        HandlerTestPool pool = new HandlerTestPool();
        SliceExitHandler handler = new SliceExitHandler(address(router), address(policy));
        SliceExecutionGrant memory grant = SliceExecutionGrant({
            owner: address(this),
            executor: address(handler),
            marketId: keccak256("handler-test-market"),
            pool: address(pool),
            collateral: address(0xCA11),
            outcomeToken: address(0x6909),
            outcomeTokenId: 7,
            oneCollateral: 1_000_000,
            outcome: 0,
            side: 1,
            maxContracts: 1_000,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 3_600),
            nonce: 1
        });
        bytes32 ruleId = handler.registerRule(
            address(pool),
            1,
            SliceExitHandler.Trigger.STOP_LOSS,
            1_000_000,
            990_000,
            0,
            1_000,
            uint64((block.timestamp + 3_600) * 1_000_000_000),
            grant.collateral,
            grant.outcomeToken,
            grant.outcomeTokenId,
            grant,
            hex"01"
        );

        bytes32[] memory topics = new bytes32[](3);
        topics[0] = handler.ORDER_FILLED_TOPIC();
        topics[1] = bytes32(uint256(91));
        topics[2] = bytes32(uint256(92));
        vm.prank(REACTIVITY_PRECOMPILE);
        handler.onEvent(address(pool), topics, abi.encode(uint256(1_000), uint256(0), uint256(0), uint256(505_000)));

        (,,,,,,,,, bool active) = handler.rules(ruleId);
        require(active, "a failed attempt stays available for a future fill");
    }
}
