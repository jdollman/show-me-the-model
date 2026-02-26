const STAGE_LABELS = {
  decomposition: "Decomposition",
  stage2: "Analysis Passes",
  dedup: "Dedup & Merge",
  synthesis: "Synthesis",
};

export default function ErrorMessage({ error, onRetry }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 className="text-lg font-semibold text-red-800">Analysis Failed</h2>
      {error.stage && (
        <p className="mt-1 text-sm text-red-600">
          Failed during: {STAGE_LABELS[error.stage] || error.stage}
        </p>
      )}
      <p className="mt-3 text-sm text-red-700">{error.message}</p>
      <button
        onClick={onRetry}
        className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
