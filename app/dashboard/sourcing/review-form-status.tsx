"use client";

import { useFormStatus } from "react-dom";

export function ReviewSubmitButton({
  decision,
  idleLabel,
  pendingLabel,
  className,
}: {
  decision: "approve" | "reject";
  idleLabel: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="decision"
      value={decision}
      disabled={pending}
      aria-busy={pending}
      className={`${className} ${pending ? "opacity-70 cursor-not-allowed" : ""}`}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

export function ReviewPendingHint() {
  const { pending } = useFormStatus();
  if (!pending) {
    return null;
  }
  return (
    <p className="text-[10px] text-zinc-500 dark:text-zinc-400" aria-live="polite">
      Saving review decision...
    </p>
  );
}
