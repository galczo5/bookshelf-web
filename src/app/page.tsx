import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import { CheckDriveButton } from "@/app/components/check-drive-button";
import { ImportDropzone } from "@/app/components/import-dropzone";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-50 pt-20">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900">Bookshelf</h1>
        <p className="mb-6 text-sm text-zinc-500">
          Signed in as{" "}
          <span className="font-medium text-zinc-700">{session.user.email}</span>
        </p>

        <div className="mb-6">
          <ImportDropzone />
        </div>

        <div className="mb-6">
          <CheckDriveButton />
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
