"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type Role } from "@/lib/rbac";

export function AdminNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = [
    ...(can(role, "user.manage")
      ? [
          { href: "/admin/users", label: "Users", match: (path: string) => path === "/admin/users" },
          {
            href: "/admin/users/new",
            label: "New user",
            match: (path: string) => path.startsWith("/admin/users/new"),
          },
        ]
      : []),
    ...(can(role, "team.manage")
      ? [{ href: "/admin/teams", label: "Teams", match: (path: string) => path.startsWith("/admin/teams") }]
      : []),
  ];
  if (links.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Admin" className="flex items-center gap-1">
      {links.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-label={link.label}
            aria-current={active ? "page" : undefined}
            className={`cursor-pointer rounded-lg px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              active ? "bg-primary/10 font-medium text-primary" : "text-muted hover:bg-row hover:text-text"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
