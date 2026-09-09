// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";

interface ISliceBinaryPool {
    struct Level {
        uint256 price;
        uint256 quantity;
    }

    function getBookLevels(bool isBid, uint64 numLevels) external view returns (Level[] memory levels);

    function placeBinaryOrderFor(
        address owner,
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 id);
}

/// @title SliceExitHandler
/// @notice On-chain take-profit, stop-loss, and book-thinning rules for binary pools.
/// @dev A Somnia subscription invokes `onEvent` from the reactivity precompile.
///      The handler reads the post-fill book and submits an IOC exit for the rule
///      owner. Token approvals remain with the owner and the venue pool.
contract SliceExitHandler is SomniaEventHandler {
    enum Trigger { TAKE_PROFIT, STOP_LOSS, BOOK_THINS }

    struct Rule {
        address owner;
        address pool;
        uint8 exitKind;
        Trigger trigger;
        uint256 oneCollateral;
        uint256 triggerPrice;
        uint256 minimumBestLevelQuantity;
        uint256 quantity;
        uint64 expireTimestampNs;
        bool active;
    }

    bytes32 public constant ORDER_FILLED_TOPIC = keccak256("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)");
    uint256 private constant NANOSECONDS_PER_SECOND = 1_000_000_000;
    uint8 private constant IOC_ORDER = 2;
    uint8 private constant CANCEL_TAKER = 0;

    mapping(bytes32 ruleId => Rule) public rules;
    mapping(address pool => bytes32[] ruleIds) private poolRules;
    mapping(address owner => uint256 nextNonce) private ownerNonces;

    error InvalidRule();
    error RuleOwnerOnly();

    event RuleRegistered(bytes32 indexed ruleId, address indexed owner, address indexed pool, uint8 exitKind, Trigger trigger, uint256 quantity);
    event RuleTriggered(bytes32 indexed ruleId, uint128 indexed fillTakerOrderId, uint256 observedPrice, uint128 exitOrderId);
    event RuleAttemptFailed(bytes32 indexed ruleId, uint128 indexed fillTakerOrderId, uint256 observedPrice);
    event RuleCancelled(bytes32 indexed ruleId, address indexed owner);

    function registerRule(
        address pool,
        uint8 exitKind,
        Trigger trigger,
        uint256 oneCollateral,
        uint256 triggerPrice,
        uint256 minimumBestLevelQuantity,
        uint256 quantity,
        uint64 expireTimestampNs
    ) external returns (bytes32 ruleId) {
        if (pool == address(0) || exitKind > 3 || oneCollateral == 0 || quantity == 0 || expireTimestampNs <= block.timestamp * NANOSECONDS_PER_SECOND) revert InvalidRule();
        if (trigger != Trigger.BOOK_THINS && (triggerPrice == 0 || triggerPrice >= oneCollateral)) revert InvalidRule();
        if (trigger == Trigger.BOOK_THINS && minimumBestLevelQuantity == 0) revert InvalidRule();

        uint256 nonce = ownerNonces[msg.sender]++;
        ruleId = keccak256(abi.encodePacked(address(this), msg.sender, pool, nonce));
        rules[ruleId] = Rule({
            owner: msg.sender,
            pool: pool,
            exitKind: exitKind,
            trigger: trigger,
            oneCollateral: oneCollateral,
            triggerPrice: triggerPrice,
            minimumBestLevelQuantity: minimumBestLevelQuantity,
            quantity: quantity,
            expireTimestampNs: expireTimestampNs,
            active: true
        });
        poolRules[pool].push(ruleId);
        emit RuleRegistered(ruleId, msg.sender, pool, exitKind, trigger, quantity);
    }

    function cancelRule(bytes32 ruleId) external {
        Rule storage rule = rules[ruleId];
        if (rule.owner != msg.sender) revert RuleOwnerOnly();
        if (rule.active) {
            rule.active = false;
            emit RuleCancelled(ruleId, msg.sender);
        }
    }

    function getPoolRuleIds(address pool) external view returns (bytes32[] memory) {
        return poolRules[pool];
    }

    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) internal override {
        if (eventTopics.length == 0 || eventTopics[0] != ORDER_FILLED_TOPIC || data.length < 128) return;
        (uint256 quantityFilled, , , uint256 fillPrice) = abi.decode(data, (uint256, uint256, uint256, uint256));
        if (quantityFilled == 0) return;
        uint128 takerOrderId = uint128(uint256(eventTopics.length > 1 ? eventTopics[1] : bytes32(0)));

        bytes32[] storage ids = poolRules[emitter];
        for (uint256 index = 0; index < ids.length; index++) {
            Rule storage rule = rules[ids[index]];
            if (!rule.active || rule.expireTimestampNs <= block.timestamp * NANOSECONDS_PER_SECOND) continue;
            if (!_triggered(rule, quantityFilled, fillPrice)) continue;
            _tryExit(ids[index], rule, takerOrderId, fillPrice);
        }
    }

    function _triggered(Rule storage rule, uint256, uint256 fillPrice) private view returns (bool) {
        if (rule.trigger == Trigger.BOOK_THINS) {
            ISliceBinaryPool.Level[] memory levels = ISliceBinaryPool(rule.pool).getBookLevels(_isBid(rule.exitKind), 1);
            return levels.length == 0 || levels[0].quantity < rule.minimumBestLevelQuantity;
        }
        uint256 observedPrice = _outcomePrice(rule, fillPrice);
        if (rule.trigger == Trigger.TAKE_PROFIT) return observedPrice >= rule.triggerPrice;
        return observedPrice <= rule.triggerPrice;
    }

    function _tryExit(bytes32 ruleId, Rule storage rule, uint128 takerOrderId, uint256 observedYesPrice) private {
        ISliceBinaryPool.Level[] memory levels = ISliceBinaryPool(rule.pool).getBookLevels(_isBid(rule.exitKind), 1);
        if (levels.length == 0) {
            emit RuleAttemptFailed(ruleId, takerOrderId, _outcomePrice(rule, observedYesPrice));
            return;
        }
        (bool success, uint128 exitOrderId) = _placeExit(rule, levels[0].price, uint64(uint256(ruleId)));
        if (!success) {
            emit RuleAttemptFailed(ruleId, takerOrderId, _outcomePrice(rule, observedYesPrice));
            return;
        }
        rule.active = false;
        emit RuleTriggered(ruleId, takerOrderId, _outcomePrice(rule, observedYesPrice), exitOrderId);
    }

    function _placeExit(Rule storage rule, uint256 price, uint64 userData) private returns (bool success, uint128 exitOrderId) {
        return ISliceBinaryPool(rule.pool).placeBinaryOrderFor(
            rule.owner,
            rule.exitKind,
            price,
            rule.quantity,
            rule.expireTimestampNs,
            IOC_ORDER,
            CANCEL_TAKER,
            address(0),
            0,
            userData
        );
    }

    function _outcomePrice(Rule storage rule, uint256 yesPrice) private view returns (uint256) {
        return rule.exitKind >= 2 ? rule.oneCollateral - yesPrice : yesPrice;
    }

    function _isBid(uint8 kind) private pure returns (bool) {
        // BinaryPool keeps one YES-price book. YES sells consume bids; NO
        // buys also consume YES bids because a NO buy is the complement of a
        // YES sell. The other two exit kinds consume asks.
        return kind == 1 || kind == 2;
    }
}
