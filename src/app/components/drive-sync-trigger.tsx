"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function DriveSyncTrigger() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/drive-sync/trigger", { method: "POST", credentials: "include" })
      .then(() => router.refresh())
      .catch(() => {});
  }, [router]);

  return null;
}
