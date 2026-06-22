"use client";

import { useEffect } from "react";

export function BackupTrigger() {
  useEffect(() => {
    fetch("/api/backup/trigger", { method: "POST", credentials: "include" }).catch(() => {});
  }, []);

  return null;
}
