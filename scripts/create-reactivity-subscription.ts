import "dotenv/config";
import { DEFAULT_SUBSCRIPTION_OPTIONS, createReactivity, SomniaReactivityPrecompileABI, unwrap } from "@somnia-chain/markets-sdk/reactivity";
import { NETWORKS } from "@slice/core";
import { createPublicClient, createWalletClient, http, keccak256, parseEventLogs, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required for subscription creation`);
  return value;
}

function address(name: string): Address {
  const value = required(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${name} must be an EVM address`);
  return value as Address;
}

function feeOption(name: string, fallback: bigint): bigint {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer number of wei`);
  return BigInt(value);
}

const network = NETWORKS.testnet;
const owner = privateKeyToAccount(required("REACTIVITY_OWNER_PRIVATE_KEY") as Hex);
const handlerContractAddress = address("REACTIVITY_HANDLER_ADDRESS");
const emitter = address("REACTIVITY_EMITTER_ADDRESS");
const orderFilledTopic = keccak256(toBytes("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)"));
const exchange = new SomniaMarkets({
  indexerUrl: network.indexerUrl,
  chain: somniaShannon,
  wsRpcUrl: network.wsRpcUrl,
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const publicClient = createPublicClient({ chain: somniaShannon, transport: http(network.rpcUrl) });
const wallet = createWalletClient({ account: owner, chain: somniaShannon, transport: http(network.rpcUrl) });
const reactivity = createReactivity(exchange.client, { wallet });
const options = {
  priorityFeePerGas: feeOption("REACTIVITY_PRIORITY_FEE_PER_GAS", DEFAULT_SUBSCRIPTION_OPTIONS.priorityFeePerGas),
  maxFeePerGas: feeOption("REACTIVITY_MAX_FEE_PER_GAS", DEFAULT_SUBSCRIPTION_OPTIONS.maxFeePerGas),
  gasLimit: feeOption("REACTIVITY_GAS_LIMIT", DEFAULT_SUBSCRIPTION_OPTIONS.gasLimit),
};

type SubscriptionInfo = {
  subscriptionData: {
    eventTopics: Hex[];
    emitter: Address;
    handlerContractAddress: Address;
  };
  owner: Address;
};

function normalizeSubscriptionInfo(value: unknown): SubscriptionInfo {
  if (Array.isArray(value)) {
    return {
      subscriptionData: value[0] as SubscriptionInfo["subscriptionData"],
      owner: value[1] as Address,
    };
  }
  return value as SubscriptionInfo;
}

async function verifySubscription(subscriptionId: bigint): Promise<void> {
  const info = normalizeSubscriptionInfo(unwrap(await reactivity.getSubscriptionInfo(subscriptionId)));
  if (!info.owner || info.owner.toLowerCase() !== owner.address.toLowerCase()) throw new Error("Somnia returned a subscription owned by a different account");
  if (info.subscriptionData.handlerContractAddress.toLowerCase() !== handlerContractAddress.toLowerCase()) throw new Error("Somnia returned a different handler address");
  if (info.subscriptionData.emitter.toLowerCase() !== emitter.toLowerCase()) throw new Error("Somnia returned a different event emitter");
  if (info.subscriptionData.eventTopics[0].toLowerCase() !== orderFilledTopic.toLowerCase()) throw new Error("Somnia returned a different event topic");
}

const configuredSubscriptionId = process.env.REACTIVITY_SUBSCRIPTION_ID;
if (configuredSubscriptionId !== undefined && configuredSubscriptionId.trim() !== "") {
  if (!/^\d+$/.test(configuredSubscriptionId)) throw new Error("REACTIVITY_SUBSCRIPTION_ID must be a decimal integer");
  const subscriptionId = BigInt(configuredSubscriptionId);
  await verifySubscription(subscriptionId);
  console.log(JSON.stringify({
    network: network.name,
    chainId: network.chainId,
    owner: owner.address,
    handlerContractAddress,
    emitter,
    eventTopic: orderFilledTopic,
    subscriptionId: subscriptionId.toString(),
    existing: true,
  }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
  process.exit(0);
}

const subscriptionHash = unwrap(await reactivity.subscribe({
  handlerContractAddress,
  filter: { emitter, eventTopics: [orderFilledTopic] },
  options,
}));
const receipt = await publicClient.waitForTransactionReceipt({ hash: subscriptionHash });
if (receipt.status !== "success") throw new Error(`Subscription transaction did not confirm: ${subscriptionHash}`);
const created = parseEventLogs({
  abi: SomniaReactivityPrecompileABI,
  eventName: "SubscriptionCreated",
  logs: receipt.logs,
  strict: false,
})[0];
if (created === undefined) throw new Error(`Subscription confirmed without a SubscriptionCreated event: ${subscriptionHash}`);
const subscriptionId = created.args.subscriptionId;
await verifySubscription(subscriptionId);

console.log(JSON.stringify({
  network: network.name,
  chainId: network.chainId,
  owner: owner.address,
  handlerContractAddress,
  emitter,
  eventTopic: orderFilledTopic,
  subscriptionId: subscriptionId.toString(),
  transactionHash: subscriptionHash,
  explorerUrl: `${network.explorerUrl}/tx/${subscriptionHash}`,
  callbackOptions: options,
}, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
