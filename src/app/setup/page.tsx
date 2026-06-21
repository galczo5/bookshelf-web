import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isConfigured } from "@/lib/config/env-file";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  const configured = isConfigured();

  // Post-config re-entry requires the owner to be signed in
  if (configured) {
    const session = await auth();
    if (!session?.user?.email) redirect("/signin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Configure Bookshelf</CardTitle>
          <CardDescription>
            {configured
              ? "Update your configuration. Changes take effect after the app restarts."
              : "Welcome! Set up your credentials to get started."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm />
        </CardContent>
      </Card>
    </div>
  );
}
