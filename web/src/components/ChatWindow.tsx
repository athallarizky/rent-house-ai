import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User } from "lucide-react";
import type { Message } from "../lib/types";
import { cn, formatClock } from "../lib/utils";
import KecamatanPicker from "./KecamatanPicker";

interface ChatWindowProps {
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  onPickKecamatan: (name: string) => void;
  onPickAllKecamatan: () => void;
}

const markdownClass =
  "prose-chat break-words [&_a]:text-inherit [&_strong]:font-bold";

export default function ChatWindow({
  messages,
  isLoading,
  streamingContent,
  onPickKecamatan,
  onPickAllKecamatan,
}: ChatWindowProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, isLoading]);

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="flex-1 overflow-y-auto thin-scroll px-4 py-5 space-y-4">
      {isEmpty && (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            <Bot className="w-7 h-7 text-primary" />
          </div>
          <h3 className="text-base font-semibold">Mulai pencarian</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Ketik query atau pilih area untuk menemukan kos. Contoh:{" "}
            <span className="text-foreground font-medium">
              "kos di Cengkareng wifi kenceng"
            </span>
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}
        >
          {msg.role === "assistant" && (
            <div className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
          )}
          <div
            className={cn(
              "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-secondary text-secondary-foreground rounded-bl-sm"
            )}
          >
            {msg.isPicker ? (
              <div>
                <p className="mb-1">{msg.content}</p>
                <KecamatanPicker
                  districts={msg.districts || []}
                  onPick={onPickKecamatan}
                  onPickAll={onPickAllKecamatan}
                  disabled={isLoading}
                />
              </div>
            ) : (
              <div className={markdownClass}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
            {msg.timestamp && (
              <div
                className={cn(
                  "text-[10px] mt-1.5 opacity-60",
                  msg.role === "user" ? "text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {formatClock(msg.timestamp)}
              </div>
            )}
          </div>
          {msg.role === "user" && (
            <div className="w-7 h-7 shrink-0 rounded-lg bg-muted flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}

      {isLoading && streamingContent && (
        <div className="flex gap-2 justify-start">
          <div className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary text-secondary-foreground px-3.5 py-2.5 text-sm">
            <div className={markdownClass}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {streamingContent}
              </ReactMarkdown>
              <span className="streaming-cursor" />
            </div>
          </div>
        </div>
      )}

      {isLoading && !streamingContent && (
        <div className="flex gap-2 justify-start">
          <div className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div className="rounded-2xl rounded-bl-sm bg-secondary px-4 py-3.5">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce" />
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
