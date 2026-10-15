import type { MentionToken } from "@/lib/db-types";

type MentionUser = { id: string; fullName: string };

export function tokenizeMentions(body: string, users: MentionUser[]): MentionToken[] {
  if (!body) {
    return [];
  }
  const names = uniqueNames(users);
  if (names.length === 0) {
    return [{ kind: "text", value: body }];
  }

  const tokens: MentionToken[] = [];
  let index = 0;
  while (index < body.length) {
    if (body[index] === "@") {
      const rest = body.slice(index + 1);
      const name = names.find((candidate) => rest.startsWith(candidate) && isMentionEnd(rest, candidate));
      if (name) {
        const user = users.find((item) => item.fullName.trim() === name);
        tokens.push({ kind: "mention", value: `@${name}`, userId: user?.id });
        index += name.length + 1;
        continue;
      }
    }
    const nextAt = body.indexOf("@", index + (body[index] === "@" ? 1 : 0));
    const end = nextAt === -1 ? body.length : nextAt;
    const sliceEnd = end === index ? index + 1 : end;
    tokens.push({ kind: "text", value: body.slice(index, sliceEnd) });
    index = sliceEnd;
  }
  return mergeText(tokens);
}

function uniqueNames(users: MentionUser[]): string[] {
  const names = new Set<string>();
  for (const user of users) {
    const name = user.fullName.trim();
    if (name) {
      names.add(name);
    }
  }
  return [...names].sort((left, right) => right.length - left.length);
}

function isMentionEnd(rest: string, name: string): boolean {
  const after = rest[name.length];
  return after === undefined || /[\s.,!?;:)"'\]}]/.test(after);
}

function mergeText(tokens: MentionToken[]): MentionToken[] {
  const merged: MentionToken[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (token.kind === "text" && last?.kind === "text") {
      last.value += token.value;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}
