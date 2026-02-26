import { useState } from "react";

const SEVERITY_COLORS = {
  Critical: "bg-red-100 text-red-700",
  Moderate: "bg-amber-100 text-amber-700",
  Minor: "bg-gray-100 text-gray-600",
};

const ISSUE_TYPE_LABELS = {
  IDENTITY_VIOLATION: "Identity Violation",
  INTERNAL_CONTRADICTION: "Contradiction",
  PARTIAL_EQUILIBRIUM: "Partial Equilibrium",
  COMPOSITION_FALLACY: "Composition Fallacy",
  EXOG_ENDO_CONFUSION: "Exog/Endo Confusion",
  MISSING_AGENT: "Missing Agent",
  MISSING_MECHANISM: "Missing Mechanism",
  LUCAS_CRITIQUE: "Lucas Critique",
};

function ChevronIcon({ open }) {
  return (
    <svg
      className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function AnnotationCard({ annotation }) {
  const [open, setOpen] = useState(false);
  const { number, title, severity, issue_types, quoted_passage, explanation, dig_deeper, source_passes } = annotation;
  const severityClass = SEVERITY_COLORS[severity] || SEVERITY_COLORS.Minor;

  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <ChevronIcon open={open} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-gray-400">#{number}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityClass}`}>
              {severity}
            </span>
            {issue_types?.map((t) => (
              <span
                key={t}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
              >
                {ISSUE_TYPE_LABELS[t] || t}
              </span>
            ))}
          </div>
          <p className="mt-1 text-sm font-medium text-gray-900">{title}</p>
        </div>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 ml-7 space-y-4">
          {quoted_passage && (
            <blockquote className="border-l-3 border-gray-300 pl-3 text-sm italic text-gray-600 leading-relaxed">
              {quoted_passage}
            </blockquote>
          )}

          {explanation && (
            <div className="space-y-2">
              {explanation.split(/\n\n+/).map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-gray-700">{p}</p>
              ))}
            </div>
          )}

          {dig_deeper && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-700">
                Dig Deeper
              </summary>
              <div className="mt-2 space-y-2">
                {dig_deeper.split(/\n\n+/).map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-gray-600">{p}</p>
                ))}
              </div>
            </details>
          )}

          {source_passes?.length > 0 && (
            <p className="text-xs text-gray-400">
              Source passes: {source_passes.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
