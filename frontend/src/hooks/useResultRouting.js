import { useEffect, useCallback } from "react";
import { fetchResult, fetchTrajectories } from "../api";

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
 *   setResult: (result: Object) => void,
 *   setAnalysisId: (id: string) => void,
 *   setError: (error: Object) => void,
 *   reset: (opts?: { pushHistory?: boolean }) => void,
 * }} handlers
 */
export default function useResultRouting({ setPhase, setResult, setAnalysisId, setError, reset, setGroupId, setJobStates }) {
  const loadResultById = useCallback(
    (hashId) => {
      setPhase("running");
      setError(null);
      fetchResult(hashId)
        .then(async (data) => {
          setResult(data);
          setAnalysisId(data.analysis_id || hashId);

          // Load group siblings for version navigator
          const groupId = data?.metadata?.group_id;
          if (groupId && setGroupId && setJobStates) {
            setGroupId(groupId);
            try {
              const trajectories = await fetchTrajectories();
              const siblings = trajectories.filter((t) => t.group_id === groupId);
              const states = siblings.map((t) => ({
                jobId: t.trajectory_id,
                label: `${t.workhorse_model} → ${t.synthesis_model}`,
                stages: {},
                result: t.analysis_id === (data.analysis_id || hashId) ? data : null,
                analysisId: t.analysis_id,
                trajectoryId: t.trajectory_id,
                error: null,
                done: true,
              }));
              setJobStates(states);
            } catch (e) {
              // Non-fatal: version navigator just won't show
            }
          }

          setPhase("done");
        })
        .catch((err) => {
          setError({ message: `Failed to load analysis: ${err.message}` });
          setPhase("error");
        });
    },
    [setPhase, setResult, setAnalysisId, setError, setGroupId, setJobStates]
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
          setResult(data);
          setPhase("done");
        })
        .catch((err) => {
          setError({ message: `Failed to load demo data: ${err.message}` });
          setPhase("error");
        });
    }

    window.addEventListener("popstate", navigateToHash);
    return () => window.removeEventListener("popstate", navigateToHash);
  }, [navigateToHash, setPhase, setResult, setError]);

  return { loadResultById };
}
