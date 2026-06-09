import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/app/components/app-sidebar";
import { Breadcrumbs } from "@/app/components/breadcrumbs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  return (
    <SidebarProvider>
      <AppSidebar email={session.user.email} />
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
