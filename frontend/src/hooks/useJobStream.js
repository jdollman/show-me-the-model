import { useState, useCallback } from "react";
import { submitJob, connectSSE } from "../api";

/**
 * Manages SSE job connections and overall job lifecycle state machine.
 * Supports multiple parallel jobs (one per config), each with its own SSE connection.
 *
 * @returns {{
 *   phase: 'idle' | 'running' | 'done' | 'error',
 *   groupId: string | null,
 *   jobStates: Array<{jobId, label, stages, result, analysisId, trajectoryId, error, done}>,
 *   result: Object | null,
 *   analysisId: string | null,
 *   error: Object | null,
 *   handleSubmit: (formData: Object) => Promise<void>,
 *   reset: (opts?: { pushHistory?: boolean }) => void,
 *   setPhase: (phase: string) => void,
 *   setResult: (result: Object) => void,
 *   setAnalysisId: (id: string) => void,
 *   setError: (error: Object) => void,
 *   setGroupId: (id: string) => void,
 *   setJobStates: (states: Array) => void,
 * }}
 */
export default function useJobStream() {
  const [phase, setPhase] = useState("idle");
  const [groupId, setGroupId] = useState(null);
  const [jobStates, setJobStates] = useState([]);
  // jobStates: [{jobId, label, stages: {}, result: null, error: null, done: false, analysisId: null, trajectoryId: null}]
  const [error, setError] = useState(null);

  const reset = useCallback(({ pushHistory = true } = {}) => {
    setPhase("idle");
    setGroupId(null);
    setJobStates([]);
    setError(null);
    if (pushHistory) {
      window.history.pushState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const handleSubmit = useCallback(async (formData) => {
    setPhase("running");
    setJobStates([]);
    setError(null);

    try {
      const { group_id, jobs } = await submitJob(formData);
      setGroupId(group_id);

      const initialStates = jobs.map((j) => ({
        jobId: j.job_id,
        label: j.label,
        stages: {},
        result: null,
        analysisId: null,
        trajectoryId: null,
        error: null,
        done: false,
      }));
      setJobStates(initialStates);

      // Open SSE for each job
      jobs.forEach((j, idx) => {
        connectSSE(j.job_id, {
          onStageComplete: (data) => {
            setJobStates((prev) => prev.map((s, i) =>
              i === idx ? { ...s, stages: { ...s.stages, [data.stage]: data } } : s
            ));
          },
          onDone: (data) => {
            setJobStates((prev) => {
              const updated = prev.map((s, i) =>
                i === idx ? {
                  ...s, done: true, result: data.result,
                  analysisId: data.analysis_id,
                  trajectoryId: data.trajectory_id,
                } : s
              );
              // If all jobs done, show first result
              if (updated.every((s) => s.done || s.error)) {
                const first = updated.find((s) => s.done);
                if (first?.analysisId) {
                  window.history.pushState(null, "", `#/results/${first.analysisId}`);
                }
                setTimeout(() => setPhase("done"), 0);
              }
              return updated;
            });
          },
          onError: (data) => {
            setJobStates((prev) => {
              const updated = prev.map((s, i) =>
                i === idx ? { ...s, error: data, done: true } : s
              );
              if (updated.every((s) => s.done || s.error)) {
                if (updated.every((s) => s.error)) {
                  setError(data);
                  setTimeout(() => setPhase("error"), 0);
                } else {
                  setTimeout(() => setPhase("done"), 0);
                }
              }
              return updated;
            });
          },
        });
      });
    } catch (err) {
      setError({ message: err.message });
      setPhase("error");
    }
  }, []);

  // Computed: first successful result for display
  const firstDone = jobStates.find((s) => s.done && s.result);

  return {
    phase, groupId, jobStates, error,
    result: firstDone?.result || null,
    analysisId: firstDone?.analysisId || null,
    handleSubmit, reset,
    setPhase, setResult: () => {}, setAnalysisId: () => {},
    setError, setGroupId, setJobStates,
  };
}
