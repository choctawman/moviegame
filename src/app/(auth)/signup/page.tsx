import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { AuthForm } from "@/components/AuthForm";
import { Card } from "@/components/Card";

export default function SignupPage() {
  return (
    <AppShell title="Sign Up">
      <Card>
        <AuthForm mode="signup" />
      </Card>
      <Card>
        <p className="text-sm">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold underline">
            Log in
          </Link>
        </p>
      </Card>
    </AppShell>
  );
}
