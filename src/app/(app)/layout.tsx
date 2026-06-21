import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isConfigured } from "@/lib/config/env-file";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/app/components/app-sidebar";
import { Breadcrumbs } from "@/app/components/breadcrumbs";
import { upsertUserByEmail, getUserIdByEmail } from "@/lib/users";
import { listUserBookStats, listRecentBooks } from "@/lib/books";
import { listUserTagsWithCount } from "@/lib/tags";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) redirect("/setup");

  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  let userId: string;
  try {
    await upsertUserByEmail(session.user.email);
    userId = await getUserIdByEmail(session.user.email);
  } catch {
    redirect("/signin");
  }

  const [stats, tags, recentBooks] = await Promise.all([
    listUserBookStats(userId),
    listUserTagsWithCount(userId),
    listRecentBooks(userId),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar email={session.user.email} stats={stats} tags={tags} recentBooks={recentBooks} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Breadcrumbs />
        </header>
        <div className="flex flex-1 flex-col bg-white">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
