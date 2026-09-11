import { shortAddress } from "../../lib/format.js";
import type { WalletControls } from "../../hooks/useWallet.js";

export function WalletBar({ wallet }: { wallet: WalletControls }) {
  return (
    <div className="wallet-bar">
      <div>
        <span className="section-kicker">Non-custodial controls</span>
        <p>
          {wallet.isConnected
            ? `Connected ${shortAddress(wallet.address)}. Your wallet signs scope; the server never receives your key.`
            : "Preview is public. Starting an execution requires one scoped wallet signature."}
        </p>
      </div>
      <button className="secondary-button" onClick={wallet.toggle}>
        {wallet.isConnected ? "Disconnect" : "Connect wallet"}
      </button>
    </div>
  );
}
