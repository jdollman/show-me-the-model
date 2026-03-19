const ANALYSIS_PASSES = [
  {
    name: "Accounting Identities & Economic Constraints",
    desc: "Checks whether the argument respects adding-up conditions that hold by construction. Macro: GDP = C + I + G + NX, the balance of payments must balance, saving = investment + current account. Micro: profit = revenue minus cost, market shares sum to 100%, persistent high margins require an entry barrier, and cost pass-through depends on relative elasticities of supply and demand.",
  },
  {
    name: "General Equilibrium",
    desc: "Identifies where the author analyzes one market in isolation when the shock is large enough that feedback across markets would change the conclusion. Missing price adjustments, composition fallacies that scale micro logic to macro, missing sectors or agents, and monolithic categories (e.g., treating all imports as finished consumer goods when many are intermediate inputs that lower domestic production costs).",
  },
  {
    name: "Exogenous vs. Endogenous",
    desc: "Flags where the author treats an endogenous outcome as an assumption. \"The labor share will fall to 46%\" is a prediction that depends on the elasticity of substitution, not a premise. Checks whether results are derived from mechanisms and parameters or simply assumed, and whether claims stated unconditionally actually depend on conditions the author does not examine.",
  },
  {
    name: "Quantitative Plausibility",
    desc: "Checks whether stated or implied magnitudes are reasonable. Are implied elasticities, multipliers, and growth rates within the range of credible estimates? Are absolute numbers presented with the right denominators? Do the magnitudes required for multiple claims to be simultaneously true actually fit together?",
  },
  {
    name: "Internal Consistency",
    desc: "Checks whether the argument's own assumptions, followed to their logical conclusions, support the stated conclusions. Even granting every premise, does the logic hold? Looks for contradictory premises, conclusions that don't follow, shifting frameworks, and self-undermining arguments where one step, if true, would undermine a later step.",
  },
  {
    name: "Steelman",
    desc: "Identifies what the essay gets right. Legitimate concerns, conditionally sound analysis, correct institutional details, and underappreciated insights. If an argument is internally valid but rests on debatable premises, this pass separates \"the logic is wrong\" from \"the assumptions are questionable but the reasoning is sound.\"",
  },
];

const PIPELINE_STAGES = [
  {
    number: "1",
    name: "Decomposition",
    desc: "Extracts the structural skeleton of the argument: central thesis, key claims, causal chain, stated assumptions, and the exogenous shock or policy the author treats as a given. Classifies the essay's primary economic field (macro/fiscal, trade, micro/IO, finance, or labor) so that later stages can load field-specific examples and calibrate their analysis.",
  },
  {
    number: "2",
    name: "Six Parallel Analysis Passes",
    desc: "The five critical lenses and the steelman pass run in parallel against the same essay and decomposition. Each pass operates independently, which means the same passage can be flagged from multiple angles. This is by design: an error that shows up in both the identities and consistency passes is likely load-bearing.",
  },
  {
    number: "3",
    name: "Deduplication & Merge",
    desc: "Because the six passes run independently, they often flag the same underlying issue from different angles. This stage merges overlapping annotations into a clean, non-redundant set, combining the best insights from each pass into a single annotation that makes a stronger case than either alone.",
  },
  {
    number: "4",
    name: "Synthesis",
    desc: "Weaves the merged annotations and strengths into a coherent narrative assessment: the key assumptions the argument depends on, the internal contradictions, a rigorous alternative framing, and an overall verdict. This is the most important stage and uses the most capable model.",
  },
];

export default function MethodologySection() {
  const textStyle = {
    color: "var(--smtm-text-secondary)",
    textAlign: "justify",
    hyphens: "auto",
  };

  const cardStyle = {
    background: "var(--smtm-bg-surface)",
    borderColor: "var(--smtm-border-default)",
  };

  const headingStyle = { color: "var(--smtm-text-primary)" };
  const itemBorder = { borderBottom: "1px solid var(--smtm-border-default)" };

  return (
    <div className="space-y-8">
      {/* Intro */}
      <p
        className="text-[13.5px] leading-relaxed font-body mb-0"
        style={textStyle}
      >
        This tool runs a multi-stage analysis pipeline. No particular school of
        thought is baked in. The analytical checks are grounded in accounting
        identities, logical consistency, and whether outcomes are derived
        from mechanisms or simply
        assumed. The persona is that of an economics professor at a research
        university, writing explanations that a journalist or policy analyst
        could follow without consulting the academic literature.
      </p>

      {/* Pipeline overview */}
      <div className="mt-4">
        <h4
          className="text-[14px] font-semibold font-display mb-3"
          style={headingStyle}
        >
          Pipeline
        </h4>
        <div
          className="rounded-xl border overflow-hidden"
          style={cardStyle}
        >
          {PIPELINE_STAGES.map((stage, i) => (
            <div
              key={stage.number}
              className="px-5 py-3.5"
              style={i < PIPELINE_STAGES.length - 1 ? itemBorder : undefined}
            >
              <div
                className="text-[13.5px] font-semibold font-display mb-1"
                style={headingStyle}
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] mr-2"
                  style={{
                    background: "var(--smtm-border-default)",
                    color: "var(--smtm-text-primary)",
                  }}
                >
                  {stage.number}
                </span>
                {stage.name}
              </div>
              <p
                className="m-0 text-[13px] leading-relaxed font-body pl-7"
                style={{ color: "var(--smtm-text-secondary)" }}
              >
                {stage.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* The six lenses */}
      <div>
        <h4
          className="text-[14px] font-semibold font-display mb-3"
          style={headingStyle}
        >
          The Six Analysis Passes
        </h4>
        <div
          className="rounded-xl border overflow-hidden"
          style={cardStyle}
        >
          {ANALYSIS_PASSES.map((pass, i) => (
            <div
              key={pass.name}
              className="px-5 py-3.5"
              style={i < ANALYSIS_PASSES.length - 1 ? itemBorder : undefined}
            >
              <div
                className="text-[13.5px] font-semibold font-display mb-1"
                style={headingStyle}
              >
                {pass.name}
              </div>
              <p
                className="m-0 text-[13px] leading-relaxed font-body"
                style={{ color: "var(--smtm-text-secondary)" }}
              >
                {pass.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Limitations */}
      <p
        className="text-xs font-body m-0"
        style={{ color: "var(--smtm-text-muted)" }}
      >
        This tool does not evaluate the empirical validity of cited studies,
        assess distributional consequences, or make political economy arguments.
        It checks the internal logic and economic reasoning of the argument as
        presented. The full prompt text and source code are available on{" "}
        <a
          href="https://github.com/joesteinberg/show-me-the-model"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--smtm-text-muted)", textDecoration: "underline" }}
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
