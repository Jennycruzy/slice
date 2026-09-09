import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, injected } from "wagmi";
import { SOMNIA_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { SomniaMarketsProvider } from "@somnia-chain/markets-sdk/react";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import App from "./App.js";
import "./styles.css";

const queryClient = new QueryClient();
const somniaClient = new SomniaMarkets({
  indexerUrl: import.meta.env.VITE_SOMNIA_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: import.meta.env.VITE_SOMNIA_WS_RPC_URL ?? "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const wagmiConfig = createConfig({
  chains: [somniaShannon],
  connectors: [injected()],
  transports: { [somniaShannon.id]: http(import.meta.env.VITE_SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network") },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SomniaMarketsProvider client={somniaClient.client}>
          <App />
        </SomniaMarketsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
