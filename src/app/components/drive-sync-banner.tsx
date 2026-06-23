"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TriangleAlertIcon, XIcon } from "lucide-react";

interface DriveSyncBannerProps {
  untrackedCount: number;
  missingCount: number;
}

export function DriveSyncBanner({ untrackedCount, missingCount }: DriveSyncBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const total = untrackedCount + missingCount;
  if (dismissed || total === 0) return null;

  const parts: string[] = [];
  if (untrackedCount > 0)
    parts.push(`${untrackedCount} untracked file${untrackedCount > 1 ? "s" : ""}`);
  if (missingCount > 0) parts.push(`${missingCount} missing file${missingCount > 1 ? "s" : ""}`);

  return (
    <Alert className="mb-6">
      <TriangleAlertIcon />
      <AlertDescription>
        Drive sync issues detected: {parts.join(", ")}.{" "}
        <Link href="/settings" className="font-medium underline underline-offset-2">
          Review in Settings
        </Link>
      </AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <XIcon className="size-4" />
        </Button>
      </AlertAction>
    </Alert>
  );
}
