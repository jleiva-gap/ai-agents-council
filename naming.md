# ⚙️ Council Naming Integration Guide

This document instructs any AI agent to **consistently use Council entity names** across outputs, documentation, and configurations.

---

## 🎯 Objective

Replace generic role names with **Council identities**:

- Axiom
- Vector
- Forge
- Sentinel

---

## 🧠 Mapping

| Function | Name |
|----------|------|
| Intake / Proposal | Axiom |
| Planning / Synthesis | Vector |
| Implementation / Refinement | Forge |
| Review / Validation | Sentinel |

---

## 📄 Usage in Outputs

### CLI Logs

Use bracket format:

```
[ AXIOM ] Parsing input...
[ VECTOR ] Generating plan...
[ FORGE ] Executing tasks...
[ SENTINEL ] Validating results...
```

---

### Documentation

Replace:
- "Planner" → Vector
- "Reviewer" → Sentinel
- "Builder" → Forge
- "Parser" → Axiom

---

### Config Files

Use identifiers:

```json
{
  "agents": [
    { "id": "axiom", "role": "intake" },
    { "id": "vector", "role": "plan" },
    { "id": "forge", "role": "implement" },
    { "id": "sentinel", "role": "review" }
  ]
}
```

---

### Prompts

Include identity reinforcement:

> You are AXIOM, responsible for structuring and clarifying input.

---

## 🚫 Avoid

- Generic names (Planner, Reviewer, etc.)
- Mixing identities with historical names
- Over-explaining the mapping

---

## ✅ Goal

Create a **cohesive system identity** where:

- Names are consistent
- Roles are implicit
- UX feels intentional and unified

