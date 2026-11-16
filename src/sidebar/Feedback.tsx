import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const FeedbackContext = createContext<{
  message: string;
  error: string;
  setMessage: (message: string) => void;
  setError: (error: string) => void;
} | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const value = useMemo(() => ({ message, error, setMessage, setError }), [message, error]);
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("Feedback must be used within FeedbackProvider.");
  return feedback;
}

export function FeedbackMessages() {
  const { message, error, setMessage, setError } = useFeedback();
  return (
    <>
      {error && (
        <div className="feedback error" role="alert">
          <span>{error}</span>
          <button type="button" className="feedback-dismiss" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
        </div>
      )}
      {message && (
        <div className="feedback success" role="status">
          <span>{message}</span>
          <button type="button" className="feedback-dismiss" aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button>
        </div>
      )}
    </>
  );
}
