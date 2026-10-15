import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.url("APP_URL must be a valid URL"),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

export type Env = z.infer<typeof envSchema>;

const globalForEnv = globalThis as typeof globalThis & {
  __env?: Env;
};

function readEnv(): Env {
  if (globalForEnv.__env) {
    return globalForEnv.__env;
  }

  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_SSL: process.env.DATABASE_SSL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    APP_URL: process.env.APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const name = issue.path.join(".") || "environment";
        return `${name}: ${issue.message}`;
      })
      .join("\n");

    console.error(`Invalid environment variables:\n${details}`);
    process.exit(1);
  }

  globalForEnv.__env = parsed.data;
  return parsed.data;
}

export const env = readEnv();
