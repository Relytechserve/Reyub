import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { RegisterForm } from "./ui";

export default async function RegisterPage() {
  const session = await auth();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center px-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Create account
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Single-user MVP: first account seeds your workspace.
        </p>
        <div className="mt-8">
          <RegisterForm />
        </div>
        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
