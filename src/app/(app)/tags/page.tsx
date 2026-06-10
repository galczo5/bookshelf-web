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
    <main className="w-full px-6 py-6">
      <TagsManager initialTags={tags} />
    </main>
  );
}
