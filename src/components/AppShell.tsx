import Link from "next/link";
import { BackButton } from "@/components/BackButton";

export function AppShell({
  title,
  children,
  showBack = true,
  subtitle,
  hideHeaderText = false,
  headerActions,
}: {
  title: string;
  children: React.ReactNode;
  showBack?: boolean;
  subtitle?: string;
  hideHeaderText?: boolean;
  headerActions?: React.ReactNode;
}) {
  return (
    <div className="app-shell min-h-screen text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-5 border-b border-white/10 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm font-medium text-slate-300">
              Movie Fantasy League
            </Link>
            <div className="flex items-center gap-2">
              {headerActions}
              {showBack ? <BackButton /> : null}
            </div>
          </div>
          {!hideHeaderText ? (
            <div className="mt-4">
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
            </div>
          ) : null}
        </header>
        <main className="flex-1 space-y-4 pb-6">{children}</main>
      </div>
    </div>
  );
}
