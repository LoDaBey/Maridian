import { generatePassword } from "@/lib/auth/password";
import { requirePermission } from "@/lib/auth/current-user";
import { CreateUserPage } from "./_components/CreateUserPage";

export const instant = false;

export default async function AdminCreateUserPage() {
  await requirePermission("user.manage");

  return <CreateUserPage suggestedPassword={generatePassword()} />;
}
