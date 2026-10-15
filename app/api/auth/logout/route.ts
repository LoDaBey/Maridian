import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { deleteSession, SESSION_COOKIE, clearSessionCookie } from "@/lib/auth/session";
import { env } from "@/lib/env";

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  if (origin === env.APP_URL) {
    return true;
  }
  try {
    const app = new URL(env.APP_URL);
    const claimed = new URL(origin);
    const localHosts = new Set(["localhost", "127.0.0.1"]);
    if (
      claimed.protocol === app.protocol &&
      claimed.port === app.port &&
      localHosts.has(claimed.hostname) &&
      localHosts.has(app.hostname)
    ) {
      return true;
    }
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return host === claimed.host;
  } catch {
    return false;
  }
}

async function endSession(): Promise<never> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token) {
    await deleteSession(token);
  } else {
    await clearSessionCookie();
  }

  redirect("/login");
}

export function GET() {
  return endSession();
}

export async function POST(request: Request) {
  await connection();
  if (!originAllowed(request)) {
    return new Response("Cross-origin request refused.", { status: 403 });
  }
  return endSession();
}
