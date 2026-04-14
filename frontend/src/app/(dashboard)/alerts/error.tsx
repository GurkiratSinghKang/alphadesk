"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 rounded bg-primary text-white text-sm">Try Again</button>
    </div>
  );
}
