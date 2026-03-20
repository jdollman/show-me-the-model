import { useState } from "react";
import useApiSettings from "../hooks/useApiSettings";

const TABS = [
  { key: "text", label: "Paste Text" },
  { key: "url", label: "URL" },
  { key: "file", label: "Upload PDF" },
];

const PROVIDERS = [
  { key: "anthropic", label: "Claude (Sonnet + Opus)" },
  { key: "openai", label: "OpenAI (GPT-5 mini + GPT-5.4)" },
  { key: "xai", label: "Grok (4.1 Fast + 4.20)" },
];

const TEXT_TEMPLATE = "# Notes for AI agents:\n# Source URL: \n# Author: \n# Title: \n\n";

export default function InputForm({ onSubmit }) {
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(TEXT_TEMPLATE);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const { provider, setProvider } = useApiSettings();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const hasInput =
    (tab === "text" && text.trim().length > 0 && text.trim() !== TEXT_TEMPLATE.trim()) ||
    (tab === "url" && url.trim().length > 0) ||
    (tab === "file" && file !== null);

  const canSubmit = hasInput && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        text: tab === "text" ? text : undefined,
        url: tab === "url" ? url : undefined,
        file: tab === "file" ? file : undefined,
        email: email || undefined,
        provider,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const [lookupId, setLookupId] = useState("");

  const handleLookup = (e) => {
    e.preventDefault();
    const id = lookupId.trim();
    if (id) {
      window.history.pushState(null, "", `#/results/${id}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };

  const inputBase = {
    background: "var(--smtm-bg-input)",
    color: "var(--smtm-text-primary)",
    borderColor: "var(--smtm-border-input)",
  };

  const inputFocus = "focus:outline-none";

  return (
    <div className="space-y-8">
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-1 font-body" style={{ color: "var(--smtm-text-secondary)" }}>
          Workflow
        </label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputFocus}`}
          style={{
            ...inputBase,
            borderColor: "var(--smtm-border-input)",
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 border-b" style={{ borderColor: "var(--smtm-border-default)" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors font-body"
              style={{
                borderColor: tab === t.key ? "var(--smtm-tab-active-border)" : "transparent",
                color: tab === t.key ? "var(--smtm-tab-active-text)" : "var(--smtm-tab-inactive-text)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "text" && (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder="Paste the essay or article text here..."
                className={`w-full rounded-md border px-3 py-2 text-sm resize-y ${inputFocus}`}
                style={inputBase}
              />
              <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--smtm-text-muted)" }}>
                X/Twitter threads must be copied and pasted manually for now. Fill in the source URL, author, and title in the placeholder lines above so they appear in the analysis results.
              </p>
            </>
          )}

          {tab === "url" && (
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputFocus}`}
              style={inputBase}
            />
          )}

          {tab === "file" && (
            <div className="flex items-center gap-3">
              <label
                className="cursor-pointer rounded-md border px-4 py-2 text-sm font-medium font-body"
                style={{
                  background: "var(--smtm-btn-secondary-bg)",
                  borderColor: "var(--smtm-btn-secondary-border)",
                  color: "var(--smtm-btn-secondary-text)",
                }}
              >
                Choose PDF
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files[0] || null)}
                />
              </label>
              <span className="text-sm" style={{ color: "var(--smtm-text-muted)" }}>
                {file ? file.name : "No file selected"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 font-body" style={{ color: "var(--smtm-text-secondary)" }}>
          Email (optional)
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Get notified when analysis is complete"
          className={`w-full rounded-md border px-3 py-2 text-sm ${inputFocus}`}
          style={inputBase}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-md px-4 py-2.5 text-sm font-bold font-body transition-colors cursor-pointer disabled:cursor-not-allowed"
        style={{
          background: canSubmit ? "var(--smtm-btn-primary-bg)" : "var(--smtm-btn-disabled-bg)",
          color: canSubmit ? "var(--smtm-btn-primary-text)" : "var(--smtm-btn-disabled-text)",
        }}
      >
        {submitting ? "Submitting..." : "Analyze"}
      </button>
    </form>

    {/* Lookup previous analysis */}
    <div className="border-t pt-6" style={{ borderColor: "var(--smtm-border-default)" }}>
      <p className="text-sm font-medium mb-2 font-body" style={{ color: "var(--smtm-text-secondary)" }}>
        Look up a previous analysis
      </p>
      <form onSubmit={handleLookup} className="flex gap-2">
        <input
          type="text"
          value={lookupId}
          onChange={(e) => setLookupId(e.target.value)}
          placeholder="Enter analysis ID"
          className={`flex-1 rounded-md border px-3 py-2 text-sm ${inputFocus}`}
          style={inputBase}
        />
        <button
          type="submit"
          disabled={!lookupId.trim()}
          className="rounded-md border px-4 py-2 text-sm font-medium font-body transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          style={{
            background: "var(--smtm-btn-secondary-bg)",
            borderColor: "var(--smtm-btn-secondary-border)",
            color: "var(--smtm-btn-secondary-text)",
          }}
        >
          Look up
        </button>
      </form>
    </div>
    </div>
  );
}
