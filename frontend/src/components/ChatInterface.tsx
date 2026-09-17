"use client";

import { useState, useRef, useEffect } from "react";

export default function ChatInterface() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string; sources?: any[] }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = { role: "user", content: query };
    setMessages((prev) => [...prev, userMessage]);
    setQuery("");
    setIsLoading(true);

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "", sources: undefined },
    ]);

    try {
      const response = await fetch("http://127.0.0.1:5000/api/retrieve_and_generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMessage.content }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        
        buffer = events.pop() || ""; 

        for (const event of events) {
          if (event.startsWith("data: ")) {
            const dataStr = event.slice(6); 
            
            try {
              const data = JSON.parse(dataStr);

              if (data.type === "context") {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  lastMsg.sources = data.retrieved;
                  return newMessages;
                });
              } else if (data.type === "token") {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  lastMsg.content += data.text;
                  return newMessages;
                });
              } else if (data.type === "done") {
                setIsLoading(false);
              }
            } catch (err) {
              console.warn("Failed to parse SSE JSON chunk:", dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error("Stream error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 bg-gray-50 text-gray-900">
      <div className="flex-1 overflow-y-auto space-y-6 pb-24">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] p-4 rounded-xl shadow-sm ${msg.role === "user" ? "bg-blue-600 text-white" : "bg-white border border-gray-200"}`}>
              <div className="whitespace-pre-wrap leading-relaxed">
                {msg.content || (msg.role === "assistant" && <span className="animate-pulse text-gray-400">Searching scientific corpus...</span>)}
              </div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Sources Used:</p>
                  <ul className="space-y-2">
                    {msg.sources.map((source, i) => (
                      <li key={i} className="text-sm bg-gray-50 p-2 rounded text-gray-700 border border-gray-100">
                        <span className="font-medium text-blue-600 mr-2">[Doc {i + 1}]</span>
                        {source.text.substring(0, 100)}...
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="fixed bottom-0 left-0 right-0 max-w-4xl mx-auto p-4 bg-gray-50 pb-8">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isLoading}
            placeholder="Ask a question about your scientific dataset..."
            className="flex-1 p-4 rounded-full border border-gray-300 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="px-6 py-4 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Sending..." : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}