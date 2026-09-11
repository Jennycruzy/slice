// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ISliceRouterERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address sender, address receiver, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address receiver, uint256 amount) external returns (bool);
}

interface ISliceRouterERC6909 {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) external returns (bool);
    function setOperator(address spender, bool approved) external returns (bool);
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
}

interface ISliceRouterBinaryPool {
    function placeBinaryOrder(
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

/// @title SliceExecutionRouter
/// @notice Owner-approved, non-custodial execution bridge for DreamDEX binary pools.
/// @dev The venue's `placeBinaryOrderFor` route is allowlisted. This router calls
///      the public `placeBinaryOrder` route as itself, using an owner-signed Slice
///      grant to authorize each child. It never intentionally retains user assets.
contract SliceExecutionRouter {
    struct ExecutionGrant {
        address owner;
        address executor;
        bytes32 marketId;
        uint8 outcome;
        uint8 side;
        uint256 maxContracts;
        uint64 issuedAt;
        uint64 expiresAt;
        uint256 nonce;
    }

    bytes32 private constant DOMAIN_TYPE_HASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant GRANT_TYPE_HASH = keccak256("ExecutionGrant(address owner,address executor,bytes32 marketId,uint8 outcome,uint8 side,uint256 maxContracts,uint64 issuedAt,uint64 expiresAt,uint256 nonce)");
    bytes32 private constant NAME_HASH = keccak256("Slice Execution Grant");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    uint8 private constant BUY_YES = 0;
    uint8 private constant SELL_YES = 1;
    uint8 private constant BUY_NO = 2;
    uint8 private constant SELL_NO = 3;
    uint8 private constant MARKET_ORDER = 2;

    address public immutable sessionPolicy;
    mapping(bytes32 digest => uint256 usedContracts) public usedContracts;
    mapping(address owner => bool knownOwner) public knownOwner;

    error InvalidGrant();
    error InvalidSignature();
    error GrantExpired();
    error GrantCapExceeded();
    error InvalidOrder();
    error OutstandingBalance();
    error TransferFailed();
    error OwnerOnly();

    event ChildOrderRouted(bytes32 indexed digest, address indexed owner, address indexed pool, uint8 kind, uint256 quantity, bool success, uint128 orderId);

    constructor(address sessionPolicy_) {
        if (sessionPolicy_ == address(0)) revert InvalidGrant();
        sessionPolicy = sessionPolicy_;
    }

    function executeBinaryOrder(
        ExecutionGrant calldata grant,
        bytes calldata signature,
        address pool,
        address collateral,
        address outcomeToken,
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData,
        uint256 oneCollateral,
        uint256 outcomeTokenId
    ) external payable returns (bool success, uint128 id) {
        if (msg.value != 0) revert InvalidOrder();
        bytes32 digest = _validateGrant(grant, signature);
        if (pool == address(0) || collateral == address(0) || outcomeToken == address(0) || quantity == 0 || oneCollateral == 0 || price == 0 || price >= oneCollateral || orderType != MARKET_ORDER) revert InvalidOrder();
        if (kind > SELL_NO) revert InvalidOrder();
        if (grant.outcome != (kind >= BUY_NO ? 1 : 0) || grant.side != (kind == SELL_YES || kind == SELL_NO ? 1 : 0)) revert InvalidOrder();

        uint256 used = usedContracts[digest];
        if (used > grant.maxContracts || quantity > grant.maxContracts - used) revert GrantCapExceeded();
        usedContracts[digest] = used + quantity;
        knownOwner[grant.owner] = true;

        if (kind == BUY_YES || kind == BUY_NO) {
            _buy(grant.owner, pool, collateral, kind == BUY_YES ? price : oneCollateral - price, quantity, oneCollateral);
        } else {
            _sell(grant.owner, pool, outcomeToken, outcomeTokenId, quantity);
        }

        (success, id) = ISliceRouterBinaryPool(pool).placeBinaryOrder(
            kind,
            price,
            quantity,
            expireTimestampNs,
            orderType,
            selfMatchingOption,
            builder,
            builderFeeBpsTimes1k,
            userData
        );

        // A binary pool settles through this router because it is the caller.
        // Return both asset classes after every route: buys receive outcome
        // tokens and may leave collateral dust; sells receive collateral and
        // may leave outcome tokens after a partial or rejected fill.
        _refundCollateral(grant.owner, collateral);
        _refundOutcome(grant.owner, outcomeToken, outcomeTokenId);
        if (!success) usedContracts[digest] = used;
        emit ChildOrderRouted(digest, grant.owner, pool, kind, quantity, success, id);
    }

    /// @notice Recover an accidental donation or an asset returned after a venue upgrade.
    ///         Only an owner that has used this router can call it, and recovery goes to them.
    function recoverERC20(address token) external {
        if (!knownOwner[msg.sender]) revert OwnerOnly();
        uint256 amount = ISliceRouterERC20(token).balanceOf(address(this));
        if (amount != 0 && !ISliceRouterERC20(token).transfer(msg.sender, amount)) revert TransferFailed();
    }

    function recoverERC6909(address token, uint256 tokenId) external {
        if (!knownOwner[msg.sender]) revert OwnerOnly();
        uint256 amount = ISliceRouterERC6909(token).balanceOf(address(this), tokenId);
        if (amount != 0 && !ISliceRouterERC6909(token).transfer(msg.sender, tokenId, amount)) revert TransferFailed();
    }

    function _buy(address owner, address pool, address collateral, uint256 unitPrice, uint256 quantity, uint256 oneCollateral) private {
        if (ISliceRouterERC20(collateral).balanceOf(address(this)) != 0) revert OutstandingBalance();
        uint256 amount = _ceilDiv(quantity * unitPrice, oneCollateral);
        if (!ISliceRouterERC20(collateral).transferFrom(owner, address(this), amount)) revert TransferFailed();
        if (!ISliceRouterERC20(collateral).approve(pool, amount)) revert TransferFailed();
    }

    function _sell(address owner, address pool, address outcomeToken, uint256 tokenId, uint256 quantity) private {
        if (ISliceRouterERC6909(outcomeToken).balanceOf(address(this), tokenId) != 0) revert OutstandingBalance();
        if (!ISliceRouterERC6909(outcomeToken).transferFrom(owner, address(this), tokenId, quantity)) revert TransferFailed();
        if (!ISliceRouterERC6909(outcomeToken).setOperator(pool, true)) revert TransferFailed();
    }

    function _refundCollateral(address owner, address collateral) private {
        uint256 amount = ISliceRouterERC20(collateral).balanceOf(address(this));
        if (amount != 0 && !ISliceRouterERC20(collateral).transfer(owner, amount)) revert TransferFailed();
    }

    function _refundOutcome(address owner, address outcomeToken, uint256 tokenId) private {
        uint256 amount = ISliceRouterERC6909(outcomeToken).balanceOf(address(this), tokenId);
        if (amount != 0 && !ISliceRouterERC6909(outcomeToken).transfer(owner, tokenId, amount)) revert TransferFailed();
    }

    function _validateGrant(ExecutionGrant calldata grant, bytes calldata signature) private view returns (bytes32 digest) {
        if (grant.owner == address(0) || grant.executor == address(0) || grant.marketId == bytes32(0) || grant.maxContracts == 0 || msg.sender != grant.executor) revert InvalidGrant();
        if (grant.expiresAt <= block.timestamp) revert GrantExpired();
        if (grant.expiresAt <= grant.issuedAt || grant.issuedAt > block.timestamp + 60) revert InvalidGrant();
        if (grant.outcome > 1 || grant.side > 1) revert InvalidGrant();
        digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), keccak256(abi.encode(
            GRANT_TYPE_HASH,
            grant.owner,
            grant.executor,
            grant.marketId,
            grant.outcome,
            grant.side,
            grant.maxContracts,
            grant.issuedAt,
            grant.expiresAt,
            grant.nonce
        ))));
        if (_recover(digest, signature) != grant.owner) revert InvalidSignature();
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPE_HASH, NAME_HASH, VERSION_HASH, block.chainid, sessionPolicy));
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if ((v != 27 && v != 28) || uint256(s) > SECP256K1_HALF_ORDER) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        return numerator == 0 ? 0 : (numerator - 1) / denominator + 1;
    }
}
