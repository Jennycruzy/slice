import { ExplorerLink } from "../ui/ExplorerLink.js";

interface DeploymentCardProps {
  label: string;
  address: string | null | undefined;
  explorerUrl: string;
  note?: string;
}

export function DeploymentCard({ label, address, explorerUrl, note }: DeploymentCardProps) {
  return (
    <article>
      <span>{label}</span>
      {address ? <ExplorerLink explorerUrl={explorerUrl} hash={address} kind="address" full /> : <strong>Unavailable</strong>}
      {note && <small>{note}</small>}
    </article>
  );
}
