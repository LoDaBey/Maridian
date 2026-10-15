import type { ReactNode } from "react";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth/current-user";

export const instant = false;

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname");

  if (pathname === "/change-password") {
    await requireUser();
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-bg px-4 py-10">
      {children}
    </div>
  );
}
