export function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/70 p-4 sm:p-5">
      {children}
    </section>
  );
}
