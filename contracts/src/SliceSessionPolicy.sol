// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title SliceSessionPolicy
/// @notice Publishes the revocation state for owner-signed Slice execution grants.
/// @dev The executor may register a valid owner signature, but only the grant owner
///      can revoke the resulting digest. The contract never receives custody of
///      collateral or outcome tokens.
contract SliceSessionPolicy {
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

    mapping(bytes32 digest => bool) public revoked;
    mapping(bytes32 digest => address ownerOf) public ownerOf;

    error InvalidGrant();
    error InvalidSignature();
    error GrantIsRevoked();
    error GrantOwnerOnly();

    event GrantRegistered(bytes32 indexed digest, address indexed owner, address indexed executor, bytes32 marketId, uint64 expiresAt);
    event GrantRevoked(bytes32 indexed digest, address indexed owner);

    function registerGrant(ExecutionGrant calldata grant, bytes calldata signature) external returns (bytes32 digest) {
        if (grant.owner == address(0) || grant.executor == address(0) || grant.marketId == bytes32(0)) revert InvalidGrant();
        if (msg.sender != grant.executor) revert InvalidGrant();
        if (grant.outcome > 1 || grant.side > 1 || grant.maxContracts == 0) revert InvalidGrant();
        if (grant.expiresAt <= block.timestamp || grant.expiresAt <= grant.issuedAt || grant.issuedAt > block.timestamp + 60) revert InvalidGrant();

        digest = hashGrant(grant);
        if (revoked[digest]) revert GrantIsRevoked();
        if (_recover(digest, signature) != grant.owner) revert InvalidSignature();

        address knownOwner = ownerOf[digest];
        if (knownOwner != address(0)) {
            if (knownOwner != grant.owner) revert InvalidGrant();
            return digest;
        }
        ownerOf[digest] = grant.owner;
        emit GrantRegistered(digest, grant.owner, grant.executor, grant.marketId, grant.expiresAt);
    }

    function revoke(bytes32 digest) external {
        address owner = ownerOf[digest];
        if (owner == address(0) || owner != msg.sender) revert GrantOwnerOnly();
        if (!revoked[digest]) {
            revoked[digest] = true;
            emit GrantRevoked(digest, msg.sender);
        }
    }

    function isActive(bytes32 digest) external view returns (bool) {
        return ownerOf[digest] != address(0) && !revoked[digest];
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPE_HASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function hashGrant(ExecutionGrant calldata grant) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
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
        ));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
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
}
