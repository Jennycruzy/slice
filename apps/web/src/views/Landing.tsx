import { Hero } from "../components/landing/Hero.js";
import { HowSliceWorks } from "../components/landing/HowSliceWorks.js";
import { ProofRail } from "../components/landing/ProofRail.js";
import { VerifiedReceiptShowcase } from "../components/landing/VerifiedReceiptShowcase.js";
import type { SliceData } from "../hooks/useSliceData.js";
import { showcaseReceipt } from "../lib/receipts.js";
import type { AppView } from "../lib/routes.js";

interface LandingViewProps {
  data: SliceData;
  onNavigate: (view: AppView) => void;
}

export function LandingView({ data, onNavigate }: LandingViewProps) {
  const receipt = showcaseReceipt(data.receipts);
  return (
    <main className="landing-view">
      <Hero health={data.health} receipt={receipt} receiptsLoading={data.receiptsLoading} onNavigate={onNavigate} />
      <ProofRail health={data.health} healthLoading={data.healthLoading} receiptCount={data.receipts.length} receiptsLoading={data.receiptsLoading} />
      <HowSliceWorks />
      {receipt && <VerifiedReceiptShowcase receipt={receipt} />}
    </main>
  );
}
