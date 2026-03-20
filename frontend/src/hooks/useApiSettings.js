import { useState, useEffect } from "react";

const STORAGE_KEY_PROVIDER = "smtm_provider";

/**
 * Manages provider selection state.
 *
 * API keys are now handled server-side via environment variables,
 * so the frontend only needs to track which provider to use.
 */
export default function useApiSettings() {
  const [provider, setProvider] = useState(
    () => localStorage.getItem(STORAGE_KEY_PROVIDER) || "anthropic"
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_PROVIDER, provider);
  }, [provider]);

  return { provider, setProvider };
}
