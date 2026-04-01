"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

import { registerUser } from "@/app/actions/register";

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await registerUser({ name, email, password });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const sign = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/dashboard",
    });
    if (sign?.error) {
      setError("Account created but sign-in failed. Try logging in.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Name (optional)
        <input
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
