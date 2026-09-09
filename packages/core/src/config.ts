import { z } from "zod";

export const sliceConfigSchema = z.object({
  scaleInCurvePower: z.coerce.number().positive().default(2),
  maxBookLevels: z.coerce.number().int().positive().default(100),
  minExpiryHeadroomSeconds: z.coerce.number().int().positive().default(300),
  childOrderExpirySeconds: z.coerce.number().int().positive().default(90),
  executionRetryLimit: z.coerce.number().int().nonnegative().default(4),
  executionRetryBaseMs: z.coerce.number().int().positive().default(750),
  heartbeatIntervalMs: z.coerce.number().int().positive().default(10_000),
});

export type SliceConfig = z.infer<typeof sliceConfigSchema>;

export const defaultSliceConfig: SliceConfig = sliceConfigSchema.parse({});

export const NETWORKS = {
  testnet: {
    name: "Somnia Shannon",
    chainId: 50312,
    rpcUrl: "https://dream-rpc.somnia.network",
    wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
    indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
    explorerUrl: "https://shannon-explorer.somnia.network",
  },
  mainnet: {
    name: "Somnia",
    chainId: 5031,
    rpcUrl: "https://api.infra.mainnet.somnia.network",
    wsRpcUrl: "wss://api.infra.mainnet.somnia.network/ws",
    indexerUrl: "https://prd.smk.somnia.host/v1/graphql",
    explorerUrl: "https://explorer.somnia.network",
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

export function networkConfig(name: string | undefined): (typeof NETWORKS)[NetworkName] {
  if (name === "mainnet") return NETWORKS.mainnet;
  return NETWORKS.testnet;
}

export const SESSION_GRANT_DOMAIN = {
  name: "Slice Execution Grant",
  version: "1",
} as const;
