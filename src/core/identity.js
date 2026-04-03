const ROLE_IDENTITY_MAP = {
  planner: { id: "axiom", name: "Axiom", function: "intake" },
  architect: { id: "vector", name: "Vector", function: "plan" },
  challenger: { id: "forge", name: "Forge", function: "implement" },
  reviewer: { id: "sentinel", name: "Sentinel", function: "review" },
  synthesizer: { id: "vector", name: "Vector", function: "plan" },
  critic: { id: "sentinel", name: "Sentinel", function: "review" },
  pragmatist: { id: "forge", name: "Forge", function: "implement" },
  investigator: { id: "axiom", name: "Axiom", function: "intake" },
  "acceptance-checker": { id: "sentinel", name: "Sentinel", function: "review" },
  "quality-critic": { id: "sentinel", name: "Sentinel", function: "review" },
  "consensus-builder": { id: "vector", name: "Vector", function: "plan" },
  "advocate-a": { id: "axiom", name: "Axiom", function: "intake" },
  "advocate-b": { id: "forge", name: "Forge", function: "implement" }
};

const FUNCTION_LOG_MAP = {
  intake: "Parsing input and structuring the ticket.",
  plan: "Generating plan and synthesis artifacts.",
  implement: "Refining execution details and alternatives.",
  review: "Validating evidence, risks, and result quality."
};

export function getCouncilIdentity(roleName) {
  return ROLE_IDENTITY_MAP[roleName] ?? { id: "vector", name: "Vector", function: "plan" };
}

export function formatCouncilLog(identityName, message) {
  return `[ ${String(identityName).toUpperCase()} ] ${message}`;
}

export function getCouncilVisualReference() {
  return [
    { function: "Intake / Proposal", name: "Axiom", id: "axiom" },
    { function: "Planning / Synthesis", name: "Vector", id: "vector" },
    { function: "Implementation / Refinement", name: "Forge", id: "forge" },
    { function: "Review / Validation", name: "Sentinel", id: "sentinel" }
  ];
}

export function getIdentityDefaultLog(roleName) {
  const identity = getCouncilIdentity(roleName);
  return formatCouncilLog(identity.name, FUNCTION_LOG_MAP[identity.function] ?? "Contributing to the council workflow.");
}

const STAGE_IDENTITY_MAP = {
  proposal: { id: "axiom", name: "Axiom", function: "proposal" },
  critique: { id: "sentinel", name: "Sentinel", function: "critique" },
  refinement: { id: "forge", name: "Forge", function: "refinement" },
  synthesis: { id: "vector", name: "Vector", function: "synthesis" },
  validation: { id: "collective", name: "Collective", function: "validation" }
};

export function getStageIdentity(stageName) {
  return STAGE_IDENTITY_MAP[stageName] ?? { id: "collective", name: "Collective", function: stageName };
}

export function getDeliberationCycle() {
  return [
    { stage: "proposal", leader: "Axiom", description: "Independent proposals on the same ticket." },
    { stage: "critique", leader: "Sentinel", description: "Pressure-test the proposals and expose flaws." },
    { stage: "refinement", leader: "Forge", description: "Improve the strongest options using critique." },
    { stage: "synthesis", leader: "Vector", description: "Merge perspectives into one coherent answer." },
    { stage: "validation", leader: "Collective", description: "Confirm readiness, completeness, and alignment." }
  ];
}
