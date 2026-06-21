"use client";

import Link from "next/link";
import { BookOpen, Tag, Trash2, LogOut, User, Settings } from "lucide-react";
import { signOutAction } from "@/app/actions/sign-out";
import { SidebarImport } from "@/app/components/sidebar-import";
import type { BookStats, RecentBook } from "@/lib/books";
import type { Tag as TagType } from "@/lib/tags";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

interface AppSidebarProps {
  email: string;
  stats: BookStats;
  tags: Array<TagType & { bookCount: number }>;
  recentBooks: RecentBook[];
}

export function AppSidebar({ email, stats, tags, recentBooks }: AppSidebarProps) {
  const navItems = [
    { href: "/", label: "Library", icon: BookOpen, badge: stats.untaggedBooks || undefined },
    { href: "/tags", label: "Tags", icon: Tag },
    { href: "/trash", label: "Trash", icon: Trash2 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const displayedTags = tags.slice(0, 8);
  const overflow = tags.length - 8;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none select-none">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <BookOpen className="size-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold">Bookshelf</span>
                <span className="text-xs text-muted-foreground">
                  {stats.totalBooks} books · {stats.totalTags} tags
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                      {item.badge !== undefined && (
                        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem>
                <SidebarImport />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {tags.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Tags</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {displayedTags.map((tag) => (
                  <SidebarMenuItem key={tag.id}>
                    <SidebarMenuButton asChild>
                      <Link href={`/?tags=${encodeURIComponent(tag.name)}`}>
                        <span>{tag.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {tag.bookCount}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {overflow > 0 && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/tags">
                        <span className="text-muted-foreground">+{overflow} more</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {recentBooks.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Recently Added</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentBooks.map((book) => (
                  <SidebarMenuItem key={book.id}>
                    <SidebarMenuButton asChild>
                      <Link href={`/books/${book.id}`} className="flex items-center gap-2">
                        {book.hasCover ? (
                          <img
                            src={`/api/books/${book.id}/cover`}
                            alt=""
                            className="size-6 shrink-0 rounded-sm object-cover"
                          />
                        ) : (
                          <div className="size-6 shrink-0 rounded-sm bg-muted" />
                        )}
                        <span className="truncate">{book.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={email} className="pointer-events-none select-none">
              <User />
              <span className="truncate text-xs">{email}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={signOutAction} className="w-full">
              <SidebarMenuButton type="submit" tooltip="Sign out">
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
