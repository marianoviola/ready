import { SourcesPanel, type SourcesPanelProps } from "./SourcesPanel";

export function SourceDiscover({ initialTag = "", ...props }: Omit<SourcesPanelProps, "mode" | "initialTag"> & { initialTag?: string }) {
  return <SourcesPanel {...props} initialTag={initialTag} mode="discover" />;
}
