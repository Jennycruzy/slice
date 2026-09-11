export type AppView = "landing" | "trade" | "executions" | "proof" | "integrations";

export const VIEW_PATHS: Record<AppView, string> = {
  landing: "/",
  trade: "/trade",
  executions: "/executions",
  proof: "/proof",
  integrations: "/integrations",
};

export const NAV_VIEWS: Array<{ view: AppView; label: string }> = [
  { view: "trade", label: "Trade" },
  { view: "executions", label: "Executions" },
  { view: "proof", label: "Proof" },
  { view: "integrations", label: "Integrations" },
];

export function viewFromPath(pathname: string): AppView {
  if (pathname.startsWith("/trade")) return "trade";
  if (pathname.startsWith("/executions")) return "executions";
  if (pathname.startsWith("/proof")) return "proof";
  if (pathname.startsWith("/integrations")) return "integrations";
  return "landing";
}
