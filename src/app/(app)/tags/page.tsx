import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { listUserTagsWithCount } from "@/lib/tags";
import { TagsManager } from "./tags-manager";

export default async function TagsPage(): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);
  const tags = await listUserTagsWithCount(userId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h2 className="mb-6 text-lg font-semibold text-zinc-900">Tags</h2>
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <TagsManager initialTags={tags} />
      </div>
    </main>
  );
}
