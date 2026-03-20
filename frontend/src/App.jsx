import useJobStream from "./hooks/useJobStream";
import useResultRouting from "./hooks/useResultRouting";
import InputForm from "./components/InputForm";
import ProgressTracker from "./components/ProgressTracker";
import ResultsView from "./components/ResultsView";
import ErrorMessage from "./components/ErrorMessage";
import ThemeSwitcher from "./components/ThemeSwitcher";

const STAGE_ORDER = ["decomposition", "stage2", "dedup", "synthesis"];

export default function App() {
  const { phase, groupId, jobStates, result, analysisId, error, handleSubmit, reset,
          setPhase, setError, setGroupId, setJobStates } = useJobStream();

  useResultRouting({ setPhase, setError, reset, setGroupId, setJobStates });

  if (phase === "done") {
    return <ResultsView result={result} analysisId={analysisId} groupId={groupId}
                        jobStates={jobStates} onReset={reset} />;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] transition-colors duration-200">
      <div className="fixed top-3 left-3 z-50">
        <button
          onClick={() => { if (confirm("Shut down the server?")) fetch("/api/shutdown", { method: "POST" }).then(() => document.title = "Server stopped"); }}
          className="px-2 py-1 rounded text-xs font-body cursor-pointer opacity-40 hover:opacity-100 transition-opacity"
          style={{ background: "var(--smtm-btn-secondary-bg, #eee)", color: "var(--smtm-text-muted, #999)", border: "1px solid var(--smtm-border-default, #ddd)" }}
          title="Shut down dev server"
        >
          Stop server
        </button>
      </div>
      <ThemeSwitcher />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <header className="text-center mb-10">
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-[var(--color-heading)]">
            Show Me the Model
          </h1>
          <p className="mt-3 text-lg text-[var(--color-text-secondary)] max-w-xl mx-auto font-body">
            AI-powered analysis of economic reasoning
          </p>
          <a
            href="https://github.com/joesteinberg/show-me-the-model"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 text-sm font-body text-[var(--color-text-secondary)] hover:text-[var(--color-heading)] transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            Open source on GitHub
          </a>
        </header>

        {phase === "idle" && <InputForm onSubmit={handleSubmit} />}

        {phase === "running" && (
          <ProgressTracker jobStates={jobStates} stageOrder={STAGE_ORDER} />
        )}

        {phase === "error" && (
          <ErrorMessage error={error} stages={{}} stageOrder={STAGE_ORDER} onRetry={reset} />
        )}
      </div>
    </div>
  );
}
