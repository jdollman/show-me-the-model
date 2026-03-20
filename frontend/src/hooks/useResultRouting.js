import { useEffect, useCallback } from "react";
import { fetchResult, fetchTrajectories, fetchModels } from "../api";

/**
 * Parses the URL hash and returns an analysis ID if present.
 *
 * @returns {string | null}
 */
function parseHashRoute() {
  const match = window.location.hash.match(/^#\/results\/([A-Za-z0-9_-]{6,12})$/);
  return match ? match[1] : null;
}

/**
 * Handles hash-based routing for shareable result links.
 * Reads window.location.hash on mount and listens for popstate events.
 *
 * @param {{
 *   setPhase: (phase: string) => void,
 *   setError: (error: Object) => void,
 *   reset: (opts?: { pushHistory?: boolean }) => void,
 *   setGroupId: (id: string) => void,
 *   setJobStates: (states: Array) => void,
 * }} handlers
 */
export default function useResultRouting({ setPhase, setError, reset, setGroupId, setJobStates }) {
  const loadResultById = useCallback(
    (hashId) => {
      setPhase("running");
      setError(null);
      fetchResult(hashId)
        .then(async (data) => {
          const groupId = data?.metadata?.group_id;

          if (groupId && setGroupId && setJobStates) {
            setGroupId(groupId);
            try {
              const [models, trajectories] = await Promise.all([
                fetchModels().catch(() => []),
                fetchTrajectories(),
              ]);
              const shortName = Object.fromEntries(
                models.map((m) => [m.id, m.short_name])
              );
              const siblings = trajectories.filter((t) => t.group_id === groupId);
              const states = siblings.map((t) => ({
                jobId: t.trajectory_id,
                label: `${shortName[t.workhorse_model] || t.workhorse_model} \u2192 ${shortName[t.synthesis_model] || t.synthesis_model}`,
                stages: {},
                result: t.analysis_id === (data.analysis_id || hashId) ? data : null,
                analysisId: t.analysis_id,
                trajectoryId: t.trajectory_id,
                error: null,
                done: true,
              }));
              setJobStates(states);
            } catch (e) {
              // Fallback: just show the single result
              setJobStates([{
                jobId: hashId,
                label: "",
                stages: {},
                result: data,
                analysisId: data.analysis_id || hashId,
                trajectoryId: null,
                error: null,
                done: true,
              }]);
            }
          } else if (setJobStates) {
            // No group info (pre-existing result) — single-item jobStates
            setJobStates([{
              jobId: hashId,
              label: "",
              stages: {},
              result: data,
              analysisId: data.analysis_id || hashId,
              trajectoryId: null,
              error: null,
              done: true,
            }]);
          }

          setPhase("done");
        })
        .catch((err) => {
          setError({ message: `Failed to load analysis: ${err.message}` });
          setPhase("error");
        });
    },
    [setPhase, setError, setGroupId, setJobStates]
  );

  const navigateToHash = useCallback(() => {
    const hashId = parseHashRoute();
    if (hashId) {
      loadResultById(hashId);
    } else {
      reset({ pushHistory: false });
    }
  }, [loadResultById, reset]);

  useEffect(() => {
    const hashId = parseHashRoute();
    const params = new URLSearchParams(window.location.search);

    if (hashId) {
      navigateToHash();
    } else if (params.get("demo") === "true") {
      fetch("/sample-result.json")
        .then((res) => res.json())
        .then((data) => {
          if (setJobStates) {
            setJobStates([{
              jobId: "demo",
              label: "Demo",
              stages: {},
              result: data,
              analysisId: data.analysis_id || "demo",
              trajectoryId: null,
              error: null,
              done: true,
            }]);
          }
          setPhase("done");
        })
        .catch((err) => {
          setError({ message: `Failed to load demo data: ${err.message}` });
          setPhase("error");
        });
    }

    window.addEventListener("popstate", navigateToHash);
    return () => window.removeEventListener("popstate", navigateToHash);
  }, [navigateToHash, setPhase, setJobStates, setError]);

  return { loadResultById };
}
