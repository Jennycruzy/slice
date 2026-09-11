import { useAccount, useConnect, useDisconnect } from "wagmi";
import type { Address } from "viem";

export interface WalletControls {
  address: Address | undefined;
  isConnected: boolean;
  chainId: number | undefined;
  connect: () => void;
  disconnect: () => void;
  /** Connects when disconnected, disconnects when connected. */
  toggle: () => void;
}

export function useWallet(): WalletControls {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const connectFirst = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };
  return {
    address,
    isConnected,
    chainId,
    connect: connectFirst,
    disconnect: () => disconnect(),
    toggle: () => (isConnected ? disconnect() : connectFirst()),
  };
}
