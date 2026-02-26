const STAGE_META = {
  decomposition: {
    label: "Decomposition",
    description: "Breaking down the argument into thesis, claims, and causal chains",
  },
  stage2: {
    label: "Analysis Passes",
    description: "Running six parallel analytical lenses on the argument",
  },
  dedup: {
    label: "Dedup & Merge",
    description: "Consolidating overlapping findings into distinct annotations",
  },
  synthesis: {
    label: "Synthesis",
    description: "Generating the final analytical report",
  },
};

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-blue-500"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function Checkmark() {
  return (
    <svg className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PendingDot() {
  return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
}

export default function ProgressTracker({ stages, stageOrder }) {
  const completedSet = new Set(Object.keys(stages));

  // Find the current (first incomplete) stage
  let currentStage = null;
  for (const s of stageOrder) {
    if (!completedSet.has(s)) {
      currentStage = s;
      break;
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500 mb-4">
        Analysis in progress. This typically takes 5–10 minutes.
      </p>
      <div className="space-y-3">
        {stageOrder.map((key) => {
          const meta = STAGE_META[key];
          const done = completedSet.has(key);
          const active = key === currentStage;

          return (
            <div key={key} className="flex items-start gap-3">
              <div className="mt-0.5">
                {done ? <Checkmark /> : active ? <Spinner /> : <PendingDot />}
              </div>
              <div>
                <p
                  className={`text-sm font-medium ${
                    done
                      ? "text-green-700"
                      : active
                      ? "text-blue-700"
                      : "text-gray-400"
                  }`}
                >
                  {meta.label}
                </p>
                {active && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {meta.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
