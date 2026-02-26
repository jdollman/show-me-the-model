import SynthesisSection from "./SynthesisSection";
import AnnotationList from "./AnnotationList";
import DecompositionView from "./DecompositionView";

export default function ResultsView({ result, onReset }) {
  const { synthesis, merged_annotations, decomposition } = result;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Analysis Results</h2>
        <button
          onClick={onReset}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Analyze another
        </button>
      </div>

      {/* Bottom Line — the headline verdict */}
      {synthesis?.bottom_line && (
        <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700 mb-2">
            Bottom Line
          </h3>
          <p className="text-sm leading-relaxed text-gray-800">
            {synthesis.bottom_line}
          </p>
        </div>
      )}

      <SynthesisSection synthesis={synthesis} />

      <AnnotationList annotations={merged_annotations} />

      <DecompositionView decomposition={decomposition} />
    </div>
  );
}
