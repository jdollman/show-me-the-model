import { useState } from "react";

const METHOD_LABELS = {
  pymupdf: "PyMuPDF (basic)",
  pymupdf4llm: "PyMuPDF4LLM",
  marker: "Marker",
  docling: "Docling (IBM)",
};

export default function ExtractionPreview({ results, onUseExtraction }) {
  const methodIds = Object.keys(results);
  const [activeTab, setActiveTab] = useState(methodIds[0]);

  if (methodIds.length === 0) return null;

  const inputBase = {
    background: "var(--smtm-bg-input)",
    color: "var(--smtm-text-primary)",
    borderColor: "var(--smtm-border-input)",
  };

  return (
    <div className="mt-4 rounded-lg border" style={{ borderColor: "var(--smtm-border-default)" }}>
      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: "var(--smtm-border-default)" }}>
        {methodIds.map((id) => {
          const r = results[id];
          const hasError = !!r.error;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className="px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors font-body"
              style={{
                borderColor: activeTab === id ? "var(--smtm-tab-active-border)" : "transparent",
                color: hasError
                  ? "var(--smtm-sev-critical-text)"
                  : activeTab === id
                    ? "var(--smtm-tab-active-text)"
                    : "var(--smtm-tab-inactive-text)",
              }}
            >
              {METHOD_LABELS[id] || id}
              {!hasError && r.time_ms != null && (
                <span className="ml-1.5 text-xs" style={{ color: "var(--smtm-text-muted)" }}>
                  {r.time_ms < 1000 ? `${Math.round(r.time_ms)}ms` : `${(r.time_ms / 1000).toFixed(1)}s`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {methodIds.map((id) => {
        if (id !== activeTab) return null;
        const r = results[id];
        if (r.error) {
          return (
            <div key={id} className="p-4 text-sm" style={{ color: "var(--smtm-sev-critical-text)" }}>
              Error: {r.error}
            </div>
          );
        }
        return (
          <div key={id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-body" style={{ color: "var(--smtm-text-muted)" }}>
                {r.char_count.toLocaleString()} characters
              </span>
              <button
                type="button"
                onClick={() => onUseExtraction(r.text)}
                className="px-3 py-1.5 rounded-md text-xs font-bold font-body transition-colors cursor-pointer"
                style={{
                  background: "var(--smtm-btn-primary-bg)",
                  color: "var(--smtm-btn-primary-text)",
                }}
              >
                Use this &rarr; Analyze
              </button>
            </div>
            <pre
              className="text-xs leading-relaxed overflow-auto max-h-[400px] rounded-md p-3 whitespace-pre-wrap"
              style={inputBase}
            >
              {r.text}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
