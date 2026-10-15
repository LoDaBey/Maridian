import { loadEnvConfig } from "@next/env";

if (!process.env.NODE_ENV) {
  Object.assign(process.env, { NODE_ENV: "development" });
}

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main(): Promise<void> {
  const { sendDueReminders } = await import("../lib/sheets/due-reminders");
  const created = await sendDueReminders();
  console.log(`Due reminders created: ${created}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Due reminders failed");
  process.exit(1);
});
