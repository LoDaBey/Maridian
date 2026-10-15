"use client";

import type { DirectoryUser } from "@/components/grid/types";
import { tokenizeMentions } from "@/lib/updates/mentions";

export function MentionText({
  body,
  users,
}: {
  body: string;
  users: DirectoryUser[];
}) {
  const tokens = tokenizeMentions(body, users);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "mention" ? (
          <span
            key={`${token.value}-${index}`}
            className="inline rounded-md bg-[#c5e1ff] px-1 font-semibold text-primary [box-decoration-break:clone]"
          >
            {token.value}
          </span>
        ) : (
          <span key={`text-${index}`}>{token.value}</span>
        ),
      )}
    </>
  );
}
