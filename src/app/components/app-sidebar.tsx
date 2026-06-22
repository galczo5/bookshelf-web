"use client";

import Link from "next/link";
import { BookOpen, Tag, Trash2, LogOut, Settings, ChevronsUpDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
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

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <SidebarMenuButton size="lg" tooltip={email}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-sm font-semibold shrink-0">
                    {email[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium truncate">{email}</span>
                    <span className="text-xs text-muted-foreground">Owner</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="top"
                  align="start"
                  sideOffset={4}
                  className="z-50 min-w-56 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
                >
                  {/* User header */}
                  <div className="flex items-center gap-3 px-2 py-2 mb-1">
                    <div className="flex aspect-square size-9 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-sm font-semibold shrink-0">
                      {email[0].toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate">{email}</span>
                      <span className="text-xs text-muted-foreground">Owner</span>
                    </div>
                  </div>

                  <DropdownMenu.Separator className="my-1 -mx-1 h-px bg-border" />

                  <DropdownMenu.Item asChild>
                    <Link
                      href="/settings"
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none cursor-pointer select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                    >
                      <Settings className="size-4" />
                      Settings
                    </Link>
                  </DropdownMenu.Item>

                  <DropdownMenu.Separator className="my-1 -mx-1 h-px bg-border" />

                  <DropdownMenu.Item asChild>
                    <form action={signOutAction}>
                      <button
                        type="submit"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none cursor-pointer select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                      >
                        <LogOut className="size-4" />
                        Sign out
                      </button>
                    </form>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
