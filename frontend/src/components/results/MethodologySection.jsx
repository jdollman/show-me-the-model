const LENSES = [
  {
    name: "Accounting Identities",
    desc: "GDP must equal consumption plus investment plus government spending plus net exports. If one component falls, something else must rise. Balance of payments must balance. Stock-flow relationships must hold.",
  },
  {
    name: "General Equilibrium",
    desc: "When one market is disrupted, prices and quantities adjust in others. Wages respond to labor demand shifts. New sectors expand as old ones contract. An analysis that holds everything else fixed may miss the most important effects.",
  },
  {
    name: "Exogenous vs. Endogenous",
    desc: "Does the author assume an outcome or derive it from a mechanism? \"Labor share will fall\" is a prediction that needs a causal channel, not a premise to build on.",
  },
  {
    name: "Quantitative Plausibility",
    desc: "Do the numbers add up? Are implied elasticities, multipliers, and growth rates within the range of credible empirical estimates? Can consumption drop 20% while GDP rises 10%?",
  },
  {
    name: "Internal Consistency",
    desc: "Does the argument contradict itself? If income shifts to high savers, interest rates should fall and asset prices rise. An essay that predicts both more saving and an asset price crash has a logical gap.",
  },
  {
    name: "Steelman",
    desc: "What does the author get right? Legitimate concerns, conditionally sound analysis, and underappreciated insights are acknowledged. The goal is fair assessment, not dismissal.",
  },
];

export default function MethodologySection() {
  return (
    <div className="space-y-4">
      <p
        className="text-[13.5px] leading-relaxed font-body m-0"
        style={{ color: "var(--smtm-text-secondary)", textAlign: "justify", hyphens: "auto" }}
      >
        This analysis runs the essay through six structured lenses, each
        grounded in standard economic reasoning. No particular school of
        thought is baked in. The checks are based on accounting identities
        (which are mathematical), logical consistency (which is structural),
        and whether outcomes are derived from mechanisms or simply assumed.
      </p>

      <div
        className="rounded-xl border overflow-hidden"
        style={{
          background: "var(--smtm-bg-surface)",
          borderColor: "var(--smtm-border-default)",
        }}
      >
        {LENSES.map((lens, i) => (
          <div
            key={lens.name}
            className="px-5 py-3.5"
            style={{
              borderBottom:
                i < LENSES.length - 1
                  ? "1px solid var(--smtm-border-default)"
                  : "none",
            }}
          >
            <div
              className="text-[14px] font-semibold font-display mb-1"
              style={{ color: "var(--smtm-text-primary)" }}
            >
              {lens.name}
            </div>
            <p
              className="m-0 text-[13px] leading-relaxed font-body"
              style={{ color: "var(--smtm-text-secondary)" }}
            >
              {lens.desc}
            </p>
          </div>
        ))}
      </div>

      <p
        className="text-xs font-body m-0"
        style={{ color: "var(--smtm-text-muted)" }}
      >
        This tool does not evaluate the empirical validity of cited studies,
        assess distributional consequences, or consider political economy
        arguments. It uses standard economic frameworks: national accounting,
        price theory, and market clearing conditions.
      </p>
    </div>
  );
}
