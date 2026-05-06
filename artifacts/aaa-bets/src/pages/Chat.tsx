import { useState, useRef, useEffect } from "react";
import { useGetChatHistory, useSendChatMessage, useGetRaces } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetChatHistoryQueryKey } from "@workspace/api-client-react";
import { MessageSquare, Send, Bot, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Chat() {
  const qc = useQueryClient();
  const { data: history, isLoading } = useGetChatHistory();
  const { data: races } = useGetRaces();
  const sendMessage = useSendChatMessage();

  const [input, setInput] = useState("");
  const [selectedRaceId, setSelectedRaceId] = useState<number | undefined>();
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{ role: string; content: string; id: number }>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allMessages = [
    ...(history ?? []),
    ...optimisticMessages,
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sendMessage.isPending) return;

    setInput("");
    const tempId = Date.now();
    setOptimisticMessages((prev) => [...prev, { role: "user", content: msg, id: tempId }]);

    try {
      await sendMessage.mutateAsync({
        data: { message: msg, raceId: selectedRaceId },
      });
      await qc.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
      setOptimisticMessages([]);
    } catch {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const SUGGESTIONS = [
    "Give more weight to odds movement",
    "Which horse has the best trainer/jockey combo?",
    "Explain the current prediction weights",
    "Make course form more important",
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen max-w-3xl mx-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-5 text-primary" />
          <h1 className="font-semibold text-foreground">AI Chat</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Race context:</span>
          <select
            value={selectedRaceId ?? ""}
            onChange={(e) => setSelectedRaceId(e.target.value ? Number(e.target.value) : undefined)}
            className="text-xs bg-card border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">None</option>
            {(races ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {isLoading ? (
          <div className="text-center text-muted-foreground text-sm pt-8">Loading chat history...</div>
        ) : allMessages.length === 0 ? (
          <div className="text-center pt-12 space-y-4">
            <div className="size-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
              <Bot className="size-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">AAA Bets AI Assistant</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                Ask me to adjust prediction weights, explain analyses, or discuss race strategy.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-primary/15 hover:text-primary transition-colors text-muted-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          allMessages.map((msg, i) => (
            <div
              key={(msg as any).id ?? `opt-${i}`}
              className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              <div className={cn(
                "size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}>
                {msg.role === "user" ? <User className="size-4" /> : <Bot className="size-4 text-primary" />}
              </div>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-card border border-card-border text-foreground rounded-tl-sm",
                )}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {sendMessage.isPending && (
          <div className="flex gap-3">
            <div className="size-8 rounded-full bg-muted flex items-center justify-center">
              <Bot className="size-4 text-primary" />
            </div>
            <div className="bg-card border border-card-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <span className="size-1.5 bg-muted-foreground rounded-full animate-bounce" />
                <span className="size-1.5 bg-muted-foreground rounded-full animate-bounce delay-100" />
                <span className="size-1.5 bg-muted-foreground rounded-full animate-bounce delay-200" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {allMessages.length > 0 && allMessages.length < 4 && (
        <div className="px-6 pb-2 flex flex-wrap gap-2">
          {SUGGESTIONS.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-primary/15 hover:text-primary transition-colors text-muted-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="px-6 py-4 border-t border-border">
        <div className="flex gap-3 items-end bg-card border border-card-border rounded-xl p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about predictions, weights, race strategy..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground resize-none focus:outline-none placeholder:text-muted-foreground min-h-[24px] max-h-[120px]"
            style={{ height: "auto" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMessage.isPending}
            className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {sendMessage.isPending ? <Zap className="size-4 animate-pulse" /> : <Send className="size-4" />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Press Enter to send · Shift+Enter for new line · Powered by Groq LLaMA 3
        </p>
      </div>
    </div>
  );
}
