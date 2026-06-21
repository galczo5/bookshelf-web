"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const labels: Record<string, string> = {
  "": "Library",
  tags: "Tags",
  trash: "Trash",
  books: "Library",
  settings: "Settings",
};

type Crumb = { label: string; href?: string };

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return [{ label: "Library" }];

  // Book detail: /books/[id] → Library (link) / Book
  if (segments[0] === "books") {
    return [{ label: "Library", href: "/" }, { label: "Book" }];
  }

  const [first] = segments;
  return [{ label: labels[first] ?? first }];
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 text-zinc-400" aria-hidden />}
            {crumb.href && !isLast ? (
              <Link href={crumb.href} className="text-zinc-500 hover:text-zinc-900">
                {crumb.label}
              </Link>
            ) : (
              <span className={isLast ? "font-medium text-zinc-900" : "text-zinc-500"}>
                {crumb.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
