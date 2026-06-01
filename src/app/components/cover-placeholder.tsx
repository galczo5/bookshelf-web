import React from "react";

function hashHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function CoverPlaceholder({
  title,
  className,
}: {
  title: string;
  className?: string;
}): React.JSX.Element {
  const hue = hashHue(title);
  return (
    <div
      className={className}
      style={{
        backgroundColor: `hsl(${hue}, 55%, 65%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          color: `hsl(${hue}, 40%, 25%)`,
          fontWeight: 700,
          fontSize: "1.25em",
          userSelect: "none",
        }}
      >
        {initials(title)}
      </span>
    </div>
  );
}
