import { useEffect, useState } from "react";

export interface SSEEvent {
  type: string;
  data: any;
}

export function useSSE(url: string | null) {
  const [events, setEvents] = useState<SSEEvent[]>([]);

  useEffect(() => {
    if (!url) return;
    const source = new EventSource(url);
    const handler = (e: MessageEvent) => {
      try {
        setEvents(prev => [...prev, { type: e.type, data: JSON.parse(e.data) }]);
      } catch {
        // ignore malformed events
      }
    };
    source.addEventListener("result_started", handler);
    source.addEventListener("result_completed", handler);
    source.addEventListener("result_failed", handler);
    source.addEventListener("run_completed", handler);
    source.addEventListener("run_failed", handler);
    source.onerror = () => {
      source.close();
    };
    return () => source.close();
  }, [url]);

  return events;
}
