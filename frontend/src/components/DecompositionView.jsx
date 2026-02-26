import { useState } from "react";

export default function DecompositionView({ decomposition }) {
  const [open, setOpen] = useState(false);

  if (!decomposition) return null;

  return (
    <section>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-base font-semibold text-gray-900 hover:text-gray-700"
      >
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
        Decomposition (Stage 1)
      </button>

      {open && (
        <div className="mt-4 space-y-6 pl-6">
          {/* Central Thesis */}
          {decomposition.central_thesis && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-1">Central Thesis</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                {decomposition.central_thesis}
              </p>
            </div>
          )}

          {/* Key Claims */}
          {decomposition.key_claims?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Key Claims</h4>
              <div className="space-y-3">
                {decomposition.key_claims.map((c, i) => (
                  <div key={i} className="text-sm">
                    <p className="text-gray-800 font-medium">{c.claim}</p>
                    {c.quoted_passage && (
                      <blockquote className="mt-1 border-l-3 border-gray-300 pl-3 text-xs italic text-gray-500 leading-relaxed">
                        {c.quoted_passage}
                      </blockquote>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stated Assumptions */}
          {decomposition.stated_assumptions?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Stated Assumptions</h4>
              <ul className="space-y-1.5">
                {decomposition.stated_assumptions.map((a, i) => (
                  <li key={i} className="text-sm text-gray-600 leading-relaxed flex gap-2">
                    <span className="text-gray-400 flex-shrink-0">&bull;</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Causal Chain */}
          {decomposition.causal_chain && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-1">Causal Chain</h4>
              <div className="space-y-2">
                {decomposition.causal_chain.split(/\n\n+/).map((p, i) => (
                  <p key={i} className="text-sm text-gray-600 leading-relaxed">{p}</p>
                ))}
              </div>
            </div>
          )}

          {/* Policy or Shock */}
          {decomposition.policy_or_shock && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-1">Exogenous Driver</h4>
              <p className="text-sm text-gray-600 leading-relaxed">
                {decomposition.policy_or_shock}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
