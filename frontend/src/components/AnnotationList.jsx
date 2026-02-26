import AnnotationCard from "./AnnotationCard";

const SEVERITY_ORDER = { Critical: 0, Moderate: 1, Minor: 2 };

function StrengthCard({ strength }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
          {strength.category === "legitimate_concern"
            ? "Legitimate Concern"
            : strength.category === "right_question"
            ? "Right Question"
            : strength.category === "conditionally_sound"
            ? "Conditionally Sound"
            : strength.category}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-900 mb-2">{strength.title}</p>
      {strength.quoted_passage && (
        <blockquote className="border-l-3 border-gray-300 pl-3 text-sm italic text-gray-600 leading-relaxed mb-3">
          {strength.quoted_passage}
        </blockquote>
      )}
      <div className="space-y-2">
        {strength.explanation.split(/\n\n+/).map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-gray-700">{p}</p>
        ))}
      </div>
      {strength.conditionality && (
        <p className="mt-3 text-xs text-gray-500 italic">
          {strength.conditionality}
        </p>
      )}
    </div>
  );
}

export default function AnnotationList({ annotations }) {
  if (!annotations) return null;

  const items = annotations.annotations || [];
  const strengths = annotations.strengths || [];

  // Sort annotations by severity
  const sorted = [...items].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold text-gray-900 mb-3">
          Annotations ({sorted.length})
        </h3>
        <div className="space-y-2">
          {sorted.map((a) => (
            <AnnotationCard key={a.number} annotation={a} />
          ))}
        </div>
      </section>

      {strengths.length > 0 && (
        <section>
          <h3 className="text-base font-semibold text-gray-900 mb-3">
            Strengths ({strengths.length})
          </h3>
          <div className="space-y-3">
            {strengths.map((s, i) => (
              <StrengthCard key={i} strength={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
