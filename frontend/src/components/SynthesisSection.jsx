const SEVERITY_ORDER = { Critical: 0, Moderate: 1, Minor: 2 };

function AssumptionBadge({ type }) {
  const isStated = type === "Stated";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        isStated
          ? "bg-gray-100 text-gray-600"
          : "bg-amber-100 text-amber-700"
      }`}
    >
      {type}
    </span>
  );
}

function Prose({ text }) {
  if (!text) return null;
  // Split on double newlines for paragraphs, render annotation references in bold
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-gray-700">
          {p.split(/(Annotation \d+|Strength \d+)/g).map((part, j) =>
            /^(Annotation|Strength) \d+$/.test(part) ? (
              <strong key={j} className="text-gray-900">{part}</strong>
            ) : (
              <span key={j}>{part}</span>
            )
          )}
        </p>
      ))}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-base font-semibold text-gray-900 mb-3">{title}</h3>
      {children}
    </section>
  );
}

export default function SynthesisSection({ synthesis }) {
  if (!synthesis) return null;

  return (
    <div className="space-y-8">
      {/* Central Claim Summary */}
      {synthesis.central_claim_summary && (
        <Section title="Central Claim">
          <Prose text={synthesis.central_claim_summary} />
        </Section>
      )}

      {/* Key Assumptions */}
      {synthesis.key_assumptions?.length > 0 && (
        <Section title="Key Assumptions">
          <div className="space-y-4">
            {synthesis.key_assumptions.map((a) => (
              <div
                key={a.number}
                className="rounded-md border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 text-xs font-mono text-gray-400 mt-0.5">
                    {a.number}.
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-900">
                        {a.assumption}
                      </p>
                    </div>
                    <div className="mb-2">
                      <AssumptionBadge type={a.stated_or_unstated} />
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {a.assessment}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* What the Essay Gets Right */}
      {synthesis.what_the_essay_gets_right && (
        <Section title="What the Essay Gets Right">
          <Prose text={synthesis.what_the_essay_gets_right} />
        </Section>
      )}

      {/* Internal Consistency */}
      {synthesis.internal_consistency && (
        <Section title="Internal Consistency">
          <Prose text={synthesis.internal_consistency} />
        </Section>
      )}

      {/* Rigorous Alternative */}
      {synthesis.rigorous_alternative && (
        <Section title="Rigorous Alternative">
          <Prose text={synthesis.rigorous_alternative} />
        </Section>
      )}
    </div>
  );
}
