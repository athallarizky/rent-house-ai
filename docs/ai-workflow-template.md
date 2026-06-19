# AI Workflow Template

> How to run a software project with an AI agent — from PRD to production.
> Based on the Rent-House-AI sprint pattern. Use this as a starting point for any project.

---

## 1. The Workflow (Phases)

```
PRD / Idea
    │
    ▼
Phase 0 — Discovery & Exploration
    ├── Read existing docs, explore codebase
    ├── Ask clarifying questions (what's missing, what's ambiguous)
    ├── Check what exists vs what needs building
    └── Run any existing tools to study actual output/behavior
    │
    ▼
Sprint Planning (docs/sprint-N/)
    ├── tasks.md          — Task breakdown + difficulty + dependencies + status
    ├── architecture.md   — Tech stack decisions with pros/cons
    ├── data-design.md    — Data models, schemas, API contracts
    ├── ux-flow.md        — Screen designs, user journey (if UI)
    └── AGENTS.md         — Delegation guide (for handing off to another LLM)
    │
    ▼
Phase 1 → Phase 2 → ... → Phase N
    Each phase:
    ├── 1. Build the code
    ├── 2. Test it (run it, verify output)
    ├── 3. Write a phase report (reports/phase-N-report.md)
    ├── 4. Update tasks.md (mark completed + add findings)
    ├── 5. Ask for commit confirmation
    └── 6. Commit + push
    │
    ▼
Retro / Ideas
    └── docs/ideas/future-enhancements.md — backlog for post-MVP
```

---

## 2. Phase 0 — Discovery & Exploration

**Goal:** Understand the problem, the existing codebase, and what needs building.

### What to Do

1. **Read the PRD** — understand the goal, components, dependencies
2. **Explore existing code** — check what's already built, what's missing
3. **Run existing tools** — clone repos, build binaries, test with real data
4. **Ask clarifying questions** — identify gaps, ambiguities, and decisions to make
5. **Study real output** — run scrapers/APIs to understand actual data shapes

### Questions to Ask

- Are there existing repos that need to be cloned? Where?
- What tech stack? Is it decided or needs discussion?
- What's the monorepo structure?
- What's the deployment target? Local? Cloud?
- What data does the system produce/consume?
- What's the MVP scope vs future enhancements?

### Deliverable

```
docs/sprint-N/reports/phase-0-report.md
```

Containing:
- Manual run instructions
- Test results with real data
- Data structure analysis
- Key findings (surprises, limitations)
- Decisions made

---

## 3. Sprint Planning — Document Templates

### `tasks.md`

```markdown
# Task Breakdown — <Project Name>

> Status: 🟡 Planning | Created: YYYY-MM-DD
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

---

## Phase 1 — <Phase Name>

| ID   | Task                           | Difficulty | Dependencies | Status |
|------|--------------------------------|------------|-------------|--------|
| 1.1  | <Task description>             | Easy       | —           | ⬜     |
| 1.2  | <Task description>             | Medium     | 1.1         | ⬜     |
| 1.3  | <Task description>             | Hard       | 0.2, 1.2    | ⬜     |

### Service Summary

- **Runtime:** <Python/Node/Go>
- **Files:** `src/a.py`, `src/b.py`
- **Key output:** <what was produced>

> 📄 Full report: [`reports/phase-1-report.md`](./reports/phase-1-report.md)

---

## Dependency Graph

```
Phase 0  ─────────────────────────────────────┐
  0.1 ──► 0.3 ──► 0.5                         │
  0.2 ──► 0.4                                 │
                                               │
Phase 1 ───────────────────────────────────────┤
  0.2 ──► 1.1 ──► 1.2 ──► 1.5                │
```

## Summary

| Phase        | Tasks | Est. Hours | Status |
|-------------|-------|-----------|--------|
| 0 — Setup   | 6     | 1h        | ⬜     |
| 1 — Core    | 5     | 4h        | ⬜     |
| **Total**   | **11** | **5h**    |        |
```

**Rules:**
- Every task has an ID, difficulty (Easy/Medium/Hard), dependencies, and status
- Status emoji: ⬜ 🔵 ✅ ❌
- Only one `in_progress` at a time
- Mark completed when tested AND working
- Add a dependency graph showing the order
- After each phase completes, add a "Service Summary" with key facts

---

### `architecture.md`

```markdown
# Architecture — <Project Name>

## 1. Project Structure

```
project/
├── services/
│   ├── service-a/       # <Language> — <purpose>
│   └── service-b/       # <Language> — <purpose>
├── api/                 # Entry point
├── data/                # Shared data (gitignored)
└── docs/
```

## 2. Tech Stack Decisions

### Decision Matrix

| Service    | Language | Key Libraries     | Why                           |
|-----------|----------|-------------------|-------------------------------|
| service-a | Node.js  | Fastify, Fuse.js  | <reason>                      |
| service-b | Python   | pandas            | <reason>                      |

### Why NOT Alternatives

| Rejected       | Reason                                |
|---------------|---------------------------------------|
| Python for X  | Would need to port existing library   |

## 3. Service Boundaries

### Service-A
- **Input:** <what it receives>
- **Output:** <what it produces>
- **Does NOT:** <responsibilities it avoids>

## 4. Key Architectural Decisions

### Decision 1: <Title>
**Decision:** <What we chose>
**Reasoning:**
- <Point 1>
- <Point 2>
```

**Rules:**
- Always explain WHY, not just WHAT
- Include rejected alternatives with reasons
- Document service boundaries (what each service does NOT do)
- Keep it concise — this is for agents to understand context, not a novel

---

### `data-design.md`

```markdown
# Data Design — <Project Name>

## 1. Input Data Format

### Source: <API / scraper / CSV>
<description>

| Field      | Type   | Notes                |
|-----------|--------|----------------------|
| field_a   | string |                      |
| field_b   | int    |                      |

## 2. Data Pipeline

```
Raw Data → [Stage 1] → [Stage 2] → Output
```

### Stage 1 — <Name>
- **Input:** <what>
- **Processing:** <how>
- **Output:** <what>

## 3. Output Schema

```json
{
  "field": "value"
}
```

## 4. Storage Schema

### <Database / File> Schema

| Field      | Type   | Indexed | Notes    |
|-----------|--------|---------|----------|
| id         | str    | primary |          |
| embedding  | vector | HNSW    | 1024-dim |
```

**Rules:**
- Show the data at each pipeline stage
- Include actual schema definitions (not just descriptions)
- Note any quirks (duplicate keys, mixed casing, null handling)
- Document what gets embedded vs what goes to metadata

---

### `ux-flow.md` (UI Projects Only)

```markdown
# UX Flow — <Project Name>

## 1. Navigation

```
Home (/) → Search (/search) → Settings (/settings)
```

## 2. Screen 1 — <Screen Name>

```
<ASCII wireframe showing layout>
```

**Behavior:**
- <What happens when user clicks X>
- <What API calls are made>
- <Error/empty states>

## 3. Interaction Flow

```
1. User lands on Home
2. User types query → navigates to Search
3. Results populate → user filters
4. User clicks item → detail expands
```
```

**Rules:**
- ASCII wireframes are good enough — no Figma needed for agent understanding
- Describe behavior, not just layout
- Include all states: loading, empty, error, success
- Show the happy path AND edge cases

---

### `AGENTS.md` (For Delegating to Another LLM)

This is the most critical document. It's a self-contained implementation guide.

```markdown
# AGENTS.md — <Sprint Name> Implementation Guide

> **For:** Any LLM agent implementing <project>.
> **Context:** <what was already built, what exists, what NOT to rebuild>

---

## 0. What Already Exists (Do NOT Rebuild)

```
<directory tree of existing code>
```

**Endpoints ready to use:**
- `POST /search` — <what it does>
- `GET /health` — <what it returns>

## 1. Tech Stack (EXACT — Do Not Change)

| Layer      | Technology          |
|-----------|---------------------|
| Frontend  | Astro + React       |
| Styling   | Tailwind CSS        |

## 2. File Structure to Create

```
<directory tree of files the agent must create>
```

## 3. Implementation Order

<numbered list of steps, each with brief code snippet if critical>

## 4. <Component Name>

Code snippet showing the exact pattern:

```typescript
function ComponentName({ props }: Props) {
  // implementation hint
}
```

## 5. API Contracts

```typescript
interface RequestType { ... }
interface ResponseType { ... }
```

## 6. Reference Files (Code You Can Copy From)

| Source        | What to Copy       |
|--------------|--------------------|
| path/to/file | pattern to reuse   |

## 7. Deviations from Reference (What to Do Differently)

| Reference    | This Project       | Why               |
|-------------|--------------------|-------------------|

## 8. Implementation Checklist

1. [ ] Task 1
2. [ ] Task 2

## 9. How to Run

```bash
cd service && npm run dev
```

## 10. Done Criteria

- [ ] <Checklist of what "done" looks like>
```

**Rules for AGENTS.md:**
- Include EXACT code snippets for critical logic
- List reference files the agent can copy-paste from
- Include a numbered checklist — agents follow checklists better than prose
- Mention what NOT to do (deviations from reference)
- Include "Done Criteria" so the agent can self-validate

---

### `reports/phase-N-report.md` (Per-Phase Report)

```markdown
# Phase N Report — <Phase Name>

> Completed: YYYY-MM-DD

---

## 1. How to Run

```bash
<exact commands to run this phase>
```

## 2. Service Architecture

```
<diagram showing component layout>
```

## 3. Test Results

| Metric | Value |
|--------|-------|
| ...    | ...   |

## 4. Key Decisions

| Decision | Reason |
|----------|--------|

## 5. Reference Files

| File | Purpose |
|------|---------|
| ...  | ...     |
```

---

## 4. Communication Patterns

### Do

- **Ask before committing** — "Confirm and I'll commit"
- **Ask before design decisions** — "Here's my recommendation, thoughts?"
- **Break down tasks before building** — "Let me split this into smaller tasks"
- **Test immediately after building** — run the code, show the output
- **Update docs after every phase** — report + tasks.md update
- **Document findings, not just results** — what surprised you, what failed

### Don't

- Never commit without confirmation
- Never assume a library is available — check first
- Never skip the "study real output" step in Phase 0
- Never leave broken tasks marked as ✅
- Never skip writing the phase report

---

## 5. Difficulty Levels

| Level  | Meaning                                          | Example                                    |
|--------|--------------------------------------------------|--------------------------------------------|
| Easy   | ≤30 min, no unknowns, mostly wiring             | "Add endpoint", "Create file structure"    |
| Medium | 1-2h, some design decisions, integration work   | "Build wrapper", "Normalize data"          |
| Hard   | 3h+, complex logic, multiple edge cases         | "Facility extraction", "SSE streaming"     |

---

## 6. Startup Checklist (New Project)

When starting a new project with this workflow:

1. [ ] Create the monorepo structure
2. [ ] Write the PRD or confirm existing one
3. [ ] Run Phase 0 — clone deps, test tools, study real output
4. [ ] Create `docs/sprint-1/` with all planning docs
5. [ ] Break tasks into phases with difficulty + dependencies
6. [ ] Start Phase 1 — build → test → report → commit
7. [ ] After each phase, update `tasks.md` and write `reports/phase-N-report.md`
8. [ ] When delegating, create `AGENTS.md` with checklist + code snippets
9. [ ] After sprint, write `docs/ideas/future-enhancements.md` for backlog

---

## 7. Complete Directory Structure

```
project/
├── docs/
│   ├── prd.md                           # Original requirements
│   ├── ideas/
│   │   └── future-enhancements.md       # Backlog for later
│   └── sprint-<N>/
│       ├── tasks.md                     # Task breakdown + status
│       ├── architecture.md              # Tech decisions + structure
│       ├── data-design.md              # Schemas + pipelines
│       ├── ux-flow.md                  # Screens + interaction (UI projects)
│       ├── AGENTS.md                   # Delegation guide
│       └── reports/
│           ├── phase-0-report.md        # Discovery findings
│           ├── phase-1-report.md        # Per-phase reports
│           └── ...
├── services/                            # Monorepo services
├── api/                                 # API layer
├── web/                                 # Frontend (if applicable)
├── data/                                # Runtime data (gitignored)
└── .gitignore
```

---

## 8. Real Example (From Rent-House-AI)

See the complete Sprint 1 output at:
- [`docs/sprint-1/tasks.md`](https://github.com/athallarizky/rent-house-ai/blob/main/docs/sprint-1/tasks.md) — 36 tasks across 6 phases
- [`docs/sprint-1/architecture.md`](https://github.com/athallarizky/rent-house-ai/blob/main/docs/sprint-1/architecture.md) — tech stack decisions with pros/cons
- [`docs/sprint-1/data-design.md`](https://github.com/athallarizky/rent-house-ai/blob/main/docs/sprint-1/data-design.md) — scraper output → RAG document pipeline
- [`docs/sprint-1/reports/`](https://github.com/athallarizky/rent-house-ai/tree/main/docs/sprint-1/reports/) — 6 phase reports
- [`docs/sprint-2/AGENTS.md`](https://github.com/athallarizky/rent-house-ai/blob/main/docs/sprint-2/AGENTS.md) — delegation guide for another LLM

The workflow produced:
- 5 services across 3 languages (Go, Node.js, Python)
- 152 indexed kos ready for semantic search
- A working FastAPI + CLI + full RAG pipeline
- ~2500 lines of documentation
