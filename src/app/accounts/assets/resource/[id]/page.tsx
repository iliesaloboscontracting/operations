"use client";

import { use } from "react";
import AssetDetail from "@/components/assets/AssetDetail";

// Accounts -> Assets -> a vehicle or plant item (stage 6).
export default function ResourceAssetPage({ params }: { params: Promise<{ id: string }> }) {
  return <AssetDetail kind="resource" id={use(params).id} />;
}
