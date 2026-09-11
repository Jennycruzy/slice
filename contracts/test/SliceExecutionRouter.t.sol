// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SliceExecutionRouter} from "../src/SliceExecutionRouter.sol";
import {SliceSessionPolicy} from "../src/SliceSessionPolicy.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
}

contract MockERC20 {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address sender, address receiver, uint256 amount) external returns (bool) {
        if (sender != msg.sender) {
            uint256 approved = allowance[sender][msg.sender];
            require(approved >= amount, "allowance");
            allowance[sender][msg.sender] = approved - amount;
        }
        require(balanceOf[sender] >= amount, "balance");
        balanceOf[sender] -= amount;
        balanceOf[receiver] += amount;
        return true;
    }

    function transfer(address receiver, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[receiver] += amount;
        return true;
    }
}

contract MockPool {
    bool public succeeds = true;
    address public collateral;
    uint256 public collateralToConsume;

    function setSucceeds(bool value) external {
        succeeds = value;
    }

    function setPartialCollateral(address collateral_, uint256 amount) external {
        collateral = collateral_;
        collateralToConsume = amount;
    }

    function placeBinaryOrder(
        uint8,
        uint256,
        uint256,
        uint64,
        uint8,
        uint8,
        address,
        uint96,
        uint64
    ) external payable returns (bool success, uint128 id) {
        if (collateralToConsume != 0) {
            MockERC20(collateral).transferFrom(msg.sender, address(this), collateralToConsume);
        }
        return (succeeds, 99);
    }
}

contract MockERC6909 {
    mapping(address owner => mapping(uint256 id => uint256 amount)) private balances;

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return balances[owner][id];
    }

    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) external returns (bool) {
        require(balances[sender][id] >= amount, "balance");
        balances[sender][id] -= amount;
        balances[receiver][id] += amount;
        return true;
    }

    function setOperator(address, bool) external pure returns (bool) {
        return true;
    }

    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool) {
        require(balances[msg.sender][id] >= amount, "balance");
        balances[msg.sender][id] -= amount;
        balances[receiver][id] += amount;
        return true;
    }
}

contract SliceExecutionRouterTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant OWNER_KEY = 0xA11CE;
    uint256 private constant EXECUTOR_KEY = 0xB0B;
    uint256 private constant ATTACKER_KEY = 0xC0DE;
    uint256 private constant ONE = 1_000_000;
    uint256 private constant CHILD = 10_000_000;

    SliceSessionPolicy private policy;
    SliceExecutionRouter private router;
    MockERC20 private collateral;
    MockERC6909 private outcomeToken;
    MockPool private pool;
    SliceExecutionRouter.ExecutionGrant private grant;
    bytes private signature;
    address private owner;
    address private executor;

    function setUp() public {
        owner = vm.addr(OWNER_KEY);
        executor = vm.addr(EXECUTOR_KEY);
        policy = new SliceSessionPolicy();
        router = new SliceExecutionRouter(address(policy));
        collateral = new MockERC20();
        outcomeToken = new MockERC6909();
        pool = new MockPool();
        grant = SliceExecutionRouter.ExecutionGrant({
            owner: owner,
            executor: executor,
            marketId: keccak256("market-a"),
            pool: address(pool),
            collateral: address(collateral),
            outcomeToken: address(outcomeToken),
            outcomeTokenId: 42,
            oneCollateral: ONE,
            outcome: 0,
            side: 0,
            maxContracts: CHILD * 2,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 3_600),
            nonce: 7
        });
        signature = _sign(policy.hashGrant(_policyGrant()));

        collateral.mint(owner, CHILD);
        vm.prank(owner);
        collateral.approve(address(router), type(uint256).max);
        vm.prank(executor);
        policy.registerGrant(_policyGrant(), signature);
    }

    function testWrongMarketAssetsAreRejected() public {
        MockPool wrongPool = new MockPool();

        vm.expectRevert(SliceExecutionRouter.InvalidOrder.selector);
        vm.prank(executor);
        router.executeBinaryOrder(
            grant,
            signature,
            address(wrongPool),
            address(collateral),
            grant.outcomeToken,
            0,
            500_000,
            CHILD,
            uint64((block.timestamp + 60) * 1_000_000_000),
            2,
            0,
            address(0),
            0,
            1,
            ONE,
            grant.outcomeTokenId
        );
    }

    function testRevokedGrantCannotRoute() public {
        bytes32 digest = policy.hashGrant(_policyGrant());
        vm.prank(owner);
        policy.revoke(digest);

        vm.expectRevert(SliceExecutionRouter.GrantNotActive.selector);
        vm.prank(executor);
        _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);
    }

    function testExpiredGrantCannotRoute() public {
        vm.warp(uint256(grant.expiresAt) + 1);

        vm.expectRevert(SliceExecutionRouter.GrantExpired.selector);
        vm.prank(executor);
        _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);
    }

    function testOnlyTheDelegatedExecutorCanRoute() public {
        vm.expectRevert(SliceExecutionRouter.InvalidGrant.selector);
        vm.prank(vm.addr(ATTACKER_KEY));
        _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);
    }

    function testGrantCapIsEnforcedAcrossChildren() public {
        vm.prank(executor);
        _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);

        vm.prank(executor);
        _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);

        vm.expectRevert(SliceExecutionRouter.GrantCapExceeded.selector);
        vm.prank(executor);
        _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);
    }

    function testUnfilledRouteResetsCapAndRefundsCollateral() public {
        pool.setSucceeds(false);
        uint256 beforeBalance = collateral.balanceOf(owner);

        vm.prank(executor);
        (bool success,) = _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);

        assertTrue(!success, "venue result should be false");
        assertEq(router.usedContracts(policy.hashGrant(_policyGrant())), 0, "failed route must release cap");
        assertEq(collateral.balanceOf(owner), beforeBalance, "unspent collateral must return");
    }

    function testSuccessfulRouteRefundsUnspentCollateral() public {
        uint256 beforeBalance = collateral.balanceOf(owner);

        vm.prank(executor);
        (bool success,) = _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);

        assertTrue(success, "venue result should be true");
        assertEq(collateral.balanceOf(owner), beforeBalance, "unspent collateral must return");
        assertEq(router.usedContracts(policy.hashGrant(_policyGrant())), CHILD, "successful route consumes the requested cap");
    }

    function testPartialFillRefundsUnusedCollateral() public {
        uint256 charged = 2_500_000;
        pool.setPartialCollateral(address(collateral), charged);
        uint256 beforeBalance = collateral.balanceOf(owner);

        vm.prank(executor);
        (bool success,) = _execute(address(pool), address(collateral), grant.outcomeToken, grant.outcomeTokenId, ONE);

        assertTrue(success, "partial venue fill should still succeed");
        assertEq(collateral.balanceOf(owner), beforeBalance - charged, "only consumed collateral may leave the router");
        assertEq(collateral.balanceOf(address(router)), 0, "partial fill must not strand collateral in the router");
        assertEq(collateral.balanceOf(address(pool)), charged, "mock venue should retain only the consumed collateral");
    }

    function _execute(address poolAddress, address collateralAddress, address outcomeTokenAddress, uint256 outcomeTokenId, uint256 oneCollateral) private returns (bool success, uint128 id) {
        return router.executeBinaryOrder(
            grant,
            signature,
            poolAddress,
            collateralAddress,
            outcomeTokenAddress,
            0,
            500_000,
            CHILD,
            uint64((block.timestamp + 60) * 1_000_000_000),
            2,
            0,
            address(0),
            0,
            1,
            oneCollateral,
            outcomeTokenId
        );
    }

    function _sign(bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _policyGrant() private view returns (SliceSessionPolicy.ExecutionGrant memory) {
        return SliceSessionPolicy.ExecutionGrant({
            owner: grant.owner,
            executor: grant.executor,
            marketId: grant.marketId,
            pool: grant.pool,
            collateral: grant.collateral,
            outcomeToken: grant.outcomeToken,
            outcomeTokenId: grant.outcomeTokenId,
            oneCollateral: grant.oneCollateral,
            outcome: grant.outcome,
            side: grant.side,
            maxContracts: grant.maxContracts,
            issuedAt: grant.issuedAt,
            expiresAt: grant.expiresAt,
            nonce: grant.nonce
        });
    }

    function assertTrue(bool value, string memory message) private pure {
        require(value, message);
    }

    function assertEq(uint256 left, uint256 right, string memory message) private pure {
        require(left == right, message);
    }
}
