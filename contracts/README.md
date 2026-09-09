# Slice contracts

These contracts are the on-chain boundary for the two autonomous controls:

- `SliceSessionPolicy` verifies the same EIP-712 execution grant the API verifies, records its digest, and lets only the grant owner revoke it on-chain.
- `SliceExitHandler` inherits Somnia's `SomniaEventHandler`, listens to DreamDEX `OrderFilled` events through an on-chain subscription, and attempts an IOC exit when a take-profit, stop-loss, or book-thinning rule is crossed.

Build with Foundry:

```sh
forge build --root contracts
```

The repository also pins `solc` so the artifacts can be checked without Foundry downloading a compiler:

```sh
npm run contracts:compile
```

Deploy with a funded deployer outside the API process. Do not put a deployer key in the repository or in the API environment:

```sh
forge create --root contracts --rpc-url "$SOMNIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" src/SliceSessionPolicy.sol:SliceSessionPolicy
forge create --root contracts --rpc-url "$SOMNIA_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" src/SliceExitHandler.sol:SliceExitHandler
```

Record the returned addresses in deployment configuration only after verifying them on the Somnia explorer. The handler subscription requires the owner wallet to maintain the protocol's current minimum balance; the subscription creation script uses the live SDK and refuses missing fee/filter configuration.
