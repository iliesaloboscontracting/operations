"use client";

import { use } from "react";
import AssetDetail from "@/components/assets/AssetDetail";

// Accounts -> Assets -> a tool (stage 6).
export default function ToolAssetPage({ params }: { params: Promise<{ id: string }> }) {
  return <AssetDetail kind="tool" id={use(params).id} />;
}
