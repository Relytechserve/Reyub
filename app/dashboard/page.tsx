import { auth, signOut } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-4xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Reyub
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Dashboard
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {session.user.email}
          </span>
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          className="mt-2"
        >
          <button
            type="submit"
            className="text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-8 dark:border-zinc-700 dark:bg-zinc-900/40">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Next steps
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>Connect Neon and run database migrations.</li>
          <li>Add Qogita, Keepa, and eBay sync jobs (see docs).</li>
          <li>Build Top 20 and watchlist views from scored SKUs.</li>
        </ul>
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          Product requirements: <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-800">docs/REQUIREMENTS.md</code>
        </p>
      </section>
    </div>
  );
}
