const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

interface LoginBucket {
  failures: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __loginRateLimit?: Map<string, LoginBucket>;
};

function buckets(): Map<string, LoginBucket> {
  if (!globalForRateLimit.__loginRateLimit) {
    globalForRateLimit.__loginRateLimit = new Map();
  }

  return globalForRateLimit.__loginRateLimit;
}

function bucketKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip}`;
}

export function loginBlockMessage(email: string, ip: string): string | null {
  const bucket = buckets().get(bucketKey(email, ip));

  if (!bucket || bucket.resetAt <= Date.now() || bucket.failures < MAX_FAILURES) {
    return null;
  }

  const minutes = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 60_000));
  return `Too many attempts, try again in ${minutes} minutes`;
}

export function recordLoginFailure(email: string, ip: string): void {
  const map = buckets();
  const key = bucketKey(email, ip);
  const now = Date.now();
  const existing = map.get(key);

  if (!existing || existing.resetAt <= now) {
    map.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }

  existing.failures += 1;
}

export function clearLoginFailures(email: string, ip: string): void {
  buckets().delete(bucketKey(email, ip));
}
