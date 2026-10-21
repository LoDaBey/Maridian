import Link from "next/link";

export default function WorkspaceNotFound() {
  return (
    <main className="flex h-full flex-col items-start gap-3 p-8">
      <h1 className="text-xl font-semibold">Workspace not found</h1>
      <p className="text-sm text-muted">That workspace is missing, or you aren&apos;t a member of it.</p>
      <Link href="/" className="cursor-pointer rounded-lg bg-primary px-3 py-2 text-sm text-white">
        Back to your workspaces
      </Link>
    </main>
  );
}
