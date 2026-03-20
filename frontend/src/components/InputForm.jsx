import { useState, useEffect, useMemo } from "react";
import useApiSettings from "../hooks/useApiSettings";
import { fetchModels, fetchTrajectories } from "../api";

const TABS = [
  { key: "text", label: "Paste Text" },
  { key: "url", label: "URL" },
  { key: "file", label: "Upload PDF" },
];

const TEXT_TEMPLATE = "# Notes for AI agents:\n# Source URL: \n# Author: \n# Title: \n\n";

const MAX_CONFIGURATIONS = 5;

function ModelSelect({ value, onChange, models, preferTier, style, inputFocus }) {
  const providers = [...new Set(models.map((m) => m.provider))];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border px-3 py-2 text-sm ${inputFocus}`}
      style={style}
    >
      {providers.map((prov) => {
        const group = models
          .filter((m) => m.provider === prov)
          .sort((a, b) => (a.tier === preferTier ? -1 : 1) - (b.tier === preferTier ? -1 : 1));
        return (
          <optgroup key={prov} label={prov.charAt(0).toUpperCase() + prov.slice(1)}>
            {group.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.short_name}{!m.available ? " (no key)" : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export default function InputForm({ onSubmit }) {
  const [tab, setTab] = useState("text");
  const [text, setText] = useState(TEXT_TEMPLATE);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const { configurations, addConfiguration, removeConfiguration, updateConfiguration } = useApiSettings();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    fetchModels()
      .then((data) => setModels(data))
      .catch(() => {
        // If /api/models is unavailable, leave models empty — selects will be hidden
      })
      .finally(() => setModelsLoading(false));
  }, []);

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
        configurations,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const [pastAnalyses, setPastAnalyses] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchTrajectories()
      .then((data) => setPastAnalyses(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Group by source_text_hash, pick the most recent trajectory per group for display
  const articleGroups = useMemo(() => {
    const byHash = {};
    for (const t of pastAnalyses) {
      const hash = t.source_text_hash || t.trajectory_id;
      if (!byHash[hash]) byHash[hash] = [];
      byHash[hash].push(t);
    }
    return Object.values(byHash)
      .map((runs) => {
        const sorted = runs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        const first = sorted[0];
        return {
          title: first.essay_title || "Untitled",
          author: first.essay_author || "",
          runs: sorted,
          latestDate: first.created_at,
          analysisId: first.analysis_id,
        };
      })
      .sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""));
  }, [pastAnalyses]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return articleGroups;
    const q = searchQuery.toLowerCase();
    return articleGroups.filter(
      (g) => g.title.toLowerCase().includes(q) || g.author.toLowerCase().includes(q)
    );
  }, [articleGroups, searchQuery]);

  const navigateTo = (analysisId) => {
    window.history.pushState(null, "", `#/results/${analysisId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
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

      {/* Model configuration section */}
      <div>
        <div className="grid grid-cols-2 gap-3 mb-1">
          <label className="block text-sm font-medium font-body" style={{ color: "var(--smtm-text-secondary)" }}>
            Workhorse Model (Stages 1–2.5)
          </label>
          <label className="block text-sm font-medium font-body" style={{ color: "var(--smtm-text-secondary)" }}>
            Synthesis Model (Stage 3)
          </label>
        </div>

        {modelsLoading ? (
          <p className="text-sm" style={{ color: "var(--smtm-text-muted)" }}>Loading models…</p>
        ) : (
          <div className="space-y-2">
            {configurations.map((config, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <ModelSelect
                    value={config.workhorse_model}
                    onChange={(val) => updateConfiguration(index, "workhorse_model", val)}
                    models={models}
                    preferTier="workhorse"
                    style={inputBase}
                    inputFocus={inputFocus}
                  />
                  <ModelSelect
                    value={config.synthesis_model}
                    onChange={(val) => updateConfiguration(index, "synthesis_model", val)}
                    models={models}
                    preferTier="synthesis"
                    style={inputBase}
                    inputFocus={inputFocus}
                  />
                </div>
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => removeConfiguration(index)}
                    className="flex-shrink-0 rounded-md px-2 py-1 text-sm font-medium font-body transition-colors cursor-pointer"
                    style={{
                      background: "var(--smtm-btn-secondary-bg)",
                      borderColor: "var(--smtm-btn-secondary-border)",
                      color: "var(--smtm-text-muted)",
                      border: "1px solid",
                    }}
                    title="Remove this configuration"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}

            {configurations.length < MAX_CONFIGURATIONS && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addConfiguration}
                  className="text-sm font-medium font-body transition-colors cursor-pointer"
                  style={{ color: "var(--smtm-tab-active-text)" }}
                >
                  + Add another configuration
                </button>
              </div>
            )}
          </div>
        )}
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

    {/* Past analyses */}
    {articleGroups.length > 0 && (
    <div className="border-t pt-6" style={{ borderColor: "var(--smtm-border-default)" }}>
      <p className="text-sm font-medium mb-3 font-body" style={{ color: "var(--smtm-text-secondary)" }}>
        Past analyses
      </p>
      {articleGroups.length > 3 && (
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title or author..."
          className={`w-full rounded-md border px-3 py-2 text-sm mb-3 ${inputFocus}`}
          style={inputBase}
        />
      )}
      <div className="space-y-1">
        {filteredGroups.map((group) => (
          <div key={group.runs[0].source_text_hash || group.runs[0].trajectory_id}>
            <button
              onClick={() => navigateTo(group.analysisId)}
              className="w-full text-left px-3 py-2.5 rounded-md text-sm font-body transition-colors cursor-pointer hover:brightness-95"
              style={{ background: "var(--smtm-bg-input)", border: "1px solid var(--smtm-border-input)" }}
            >
              <span className="font-medium" style={{ color: "var(--smtm-text-primary)" }}>
                {group.title}
              </span>
              {group.author && (
                <span className="ml-1.5" style={{ color: "var(--smtm-text-muted)" }}>
                  by {group.author}
                </span>
              )}
              <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: "var(--smtm-text-muted)" }}>
                <span>
                  {group.runs.length} version{group.runs.length !== 1 ? "s" : ""}
                </span>
                <span>
                  {group.runs.map((r) => {
                    const w = r.workhorse_model?.split("-")[0] || "";
                    return w.charAt(0).toUpperCase() + w.slice(1);
                  }).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                </span>
                {group.latestDate && (
                  <span>{new Date(group.latestDate).toLocaleDateString()}</span>
                )}
              </div>
            </button>
          </div>
        ))}
        {filteredGroups.length === 0 && searchQuery && (
          <p className="text-sm py-2 px-3 font-body" style={{ color: "var(--smtm-text-muted)" }}>
            No matches for &ldquo;{searchQuery}&rdquo;
          </p>
        )}
      </div>
    </div>
    )}
    </div>
  );
}
