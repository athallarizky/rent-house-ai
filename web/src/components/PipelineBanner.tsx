import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { getPipelineStatus, type PipelineStatus } from "../lib/api";

interface Props {
  /** If true, start polling. Set false to force-stop. */
  active: boolean;
  onCompleted?: (message: string) => void;
}

export default function PipelineBanner({ active, onCompleted }: Props) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted; // keep callback fresh without re-creating interval

  useEffect(() => {
    if (!active) {
      setStatus(null);
      return;
    }

    const poll = async () => {
      try {
        const data = await getPipelineStatus();
        setStatus(data);

        // Pipeline just completed?
        if (data.running === null && data.status !== "idle" && data.progress) {
          onCompletedRef.current?.(data.progress);
        }
      } catch {
        // silently ignore network errors during polling
      }
    };

    poll(); // immediate first fetch
    intervalRef.current = setInterval(poll, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active]);

  if (!status || status.status === "idle") return null;

  const isRunning = status.running !== null;
  const isCompleted = status.status === "completed";
  const isError = status.progress?.toLowerCase().includes("failed");

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 text-sm border-b ${
        isError
          ? "border-red-800 bg-red-950/50 text-red-300"
          : isCompleted
          ? "border-green-800 bg-green-950/50 text-green-300"
          : "border-blue-800 bg-blue-950/50 text-blue-300"
      }`}
    >
      {isRunning ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : isError ? (
        <XCircle className="h-4 w-4 shrink-0" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      )}
      <span className="truncate">
        {isRunning && status.running ? (
          <>
            <strong>{status.running}</strong>: {status.progress || status.status}
          </>
        ) : (
          status.progress || status.status
        )}
      </span>
      {isRunning && status.elapsed_seconds != null && (
        <span className="text-xs opacity-60 ml-auto shrink-0">
          {Math.floor(status.elapsed_seconds)}s
        </span>
      )}
    </div>
  );
}
