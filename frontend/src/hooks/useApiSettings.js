import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY_CONFIGS = "smtm_configurations";

const DEFAULT_CONFIGS = [
  { workhorse_model: "claude-sonnet-4-6", synthesis_model: "claude-opus-4-6" },
];

export default function useApiSettings() {
  const [configurations, setConfigurations] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONFIGS);
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_CONFIGS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CONFIGS, JSON.stringify(configurations));
  }, [configurations]);

  const addConfiguration = useCallback(() => {
    setConfigurations((prev) => [
      ...prev,
      { ...DEFAULT_CONFIGS[0] },
    ]);
  }, []);

  const removeConfiguration = useCallback((index) => {
    setConfigurations((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateConfiguration = useCallback((index, field, value) => {
    setConfigurations((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }, []);

  return { configurations, addConfiguration, removeConfiguration, updateConfiguration };
}
