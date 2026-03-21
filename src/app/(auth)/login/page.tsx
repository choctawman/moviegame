import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { AuthForm } from "@/components/AuthForm";
import { Card } from "@/components/Card";

export default function LoginPage() {
  return (
    <AppShell title="Log In">
      <Card>
        <AuthForm mode="login" />
      </Card>
      <Card>
        <p className="text-sm">
          New here?{" "}
          <Link href="/signup" className="font-semibold underline">
            Create account
          </Link>
        </p>
      </Card>
    </AppShell>
  );
}
