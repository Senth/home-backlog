# Home Projects — Project Reference

> Vision, requirements, key decisions, and architecture principles.
> Working name only — see [Naming](#naming) for candidates.
> Per-feature deep specs will live in [`docs/specs/`](specs/).

## Background & Context

A **home improvement project manager** built around nested kanban boards. The core
problem: _"We have far more house and garden work than we can hold in our heads, and no
single place that shows what's outstanding, what's due, and what to do next."_

Trello-like boards, but with two things Trello lacks: **arbitrary nesting** (a card can
become its own board) and a **second, independent hierarchy of places** (rooms, floors,
garden areas) that projects are anchored to.

### Usage plan

- **Year 1**: private use by one household (2+ people).
- **Later**: possible release on Google Play and the App Store.

Consequence: build for a single household first, but do not make decisions that block
multi-tenancy, sharing, or store release.

### Key Decisions

- **Stack**: Expo + React Native + expo-router + **react-native-paper (Material 3)** +
  TypeScript + Firebase. Mirrors the sibling project `my-musical-repertoire` apart from
  the styling layer.
  - **NativeWind and Tailwind were rejected**, reversing the earlier decision. NativeWind
    v5 is still a preview release; its React Native Web output needs CSS specificity
    hacks to make `flex-1`, `flex-row` and the alignment utilities behave (the sibling
    project carries ~40 lines of them in `global.css`); and its one real benefit is
    utility-class ergonomics for a human author, which does not apply to a codebase
    written by AI. The cost is not proportional to usage either — using it for colours
    alone still drags in the whole toolchain, and Material 3's theme already owns the
    palette, so a second one would have to be kept in sync by hand.
  - What replaces the discipline a utility framework would have imposed: a
    `theme/tokens.ts` scale, and two rules — no numeric literal in a style prop, no
    colour literal outside `theme/` — stated in `CLAUDE.md`.
- **Web PWA first**, native builds later. Same codebase via React Native Web.
- **Firebase / Firestore** over Postgres: developer is already fluent, offline persistence
  and realtime sync are built in, schema evolution is cheap, and Hosting serves the PWA
  from the same project.
  - Rejected objection: "hierarchy queries need SQL." Not true with a **flat `nodes`
    collection** carrying `parentId` + `ancestorIds[]`. Subtree queries use
    `array-contains`; cross-cutting queries (all in-progress, all overdue) filter on
    ordinary fields.
  - Scale check: ~200 projects × ~20 tasks ≈ 4k docs; 10 years ≈ 20–50k docs ≈ ~50 MB,
    against a 1 GiB / 50k-reads-per-day free tier. Storage is not the risk — **listener
    breadth is**. Always constrain queries by `status` / `archived`; never subscribe to a
    whole collection.
- **Development approach**: solo developer with heavy AI assistance.

## App Requirements

### Hierarchy & nodes

- **One unified `Node` type**, infinitely nestable. A project, a task and a subtask are
  the same shape at different depths; any node with children can be opened as a board.
- **No hard depth limit.** Depth is derived, not declared.
- Node fields (MVP): `title`, `status`, `rank`, `parentId`, `ancestorIds[]`, `locationId`,
  `locationAncestorIds[]`, `participantIds[]`, `visibility`, `dueDate`, `priority`,
  `blockedBy[]`, `notes`, `checklist[]`, `effort`, `photos[]`.
- **Not in MVP**: cost/budget tracking. Notes absorb it until the real need is understood.

### Statuses & columns

- **Global status enum**, not freeform columns:
  `backlog`, `next_up`, `research`, `planning`, `execution`, `review`, `done`, `blocked`.
  Stored as a string id so custom statuses can be added later without migration.
- A **board configures which statuses it shows**, in what order, with optional relabels.
  It cannot invent new ones in MVP.
- Rationale: cross-board queries — the dashboard, the suggestion engine, "what's in
  progress anywhere" — only work if status is globally comparable. Freeform columns would
  each need a semantic flag, which is this design wearing a disguise.
- **Default column set is chosen by depth at board creation, then frozen and editable**:
  - depth 0 (all projects) and depth 1 (inside a project) → full stage set.
  - depth ≥ 2 → simple set (To Do / In Progress / Done).
  - Frozen at creation so moving a subtree never silently rearranges columns or strands
    cards in a column that no longer exists.
  - Rationale: a research column whose cards each contain their own research column is
    nonsense.
- **Parent status is manual**, with nudges ("all 8 subtasks are done — move this to
  Review?"). Derived status was rejected: it makes it impossible to say a project is
  parked while its tasks look active.

### Locations

- **A second, independent tree** (`locations`): Outside › Garden › Apple trees,
  Inside › Basement › Laundry. User-defined, arbitrary depth.
- A node links to it via `locationId` plus a denormalized `locationAncestorIds[]`, so
  "everything in the Basement" also returns work filed under its individual rooms.
- **A project need not sit at a leaf.** "Renovate the basement" belongs to Basement.
- **Children inherit the parent's location** unless they override it.
- **One location per node.** Work spanning several rooms is modelled as a project at the
  common ancestor with a child per room — the shape the app is already good at. Rejected
  multi-location because it makes roll-up counts ambiguous.
- **Blank start in MVP** — no seeded room templates, no starter maintenance library.
  Revisit once there is real usage to learn from.

### Household, participants & privacy

- Data is scoped to a **home**: `homes/{homeId}/nodes|locations|recurring`. Access is
  granted by a `members` map on the home doc, checked from security rules. Multi-home
  (cabin, parents' house) falls out for free.
- **`participantIds[]`** — who is working on a node. Any number of members. Empty means
  unassigned. Gives "my tasks" and "unassigned" filters for free.
- **`visibility: 'shared' | 'private'`** — separate concern from participants. Default
  shared. Private means only participants can read it; the subtree inherits it.
- **Query shape matters here.** Firestore rejects an entire query if any matching document
  would be rule-denied, so private nodes must be excluded *by the query*, not only by
  rules. Each board load fires two provably-safe queries and merges them client-side:
  1. `parentId == X && visibility == 'shared'`
  2. `parentId == X && participantIds array-contains me`
- Cost of that: ~1 extra document read per board load (billing is per document, not per
  query), and it deliberately keeps the single permitted `array-contains` slot free on
  query 1 for `locationAncestorIds`. Query 2 returns only your own private items, so any
  further filtering on it happens client-side.

### Recurring maintenance

- **Template + spawned instances**, not a self-resetting task. Templates live in
  `recurring`; instances are real nodes. This preserves completion history for the 30-day
  summary and lets a single occurrence grow its own notes and subtasks ("the gutters were
  rotten this time").
- Instances are materialized **lazily on read** — no cron job, no Cloud Scheduler.
- **Three rule types**:
  1. Fixed interval from due date — service intervals, filters. Never drifts.
  2. Interval from last completion — mowing, cleaning.
  3. Season / month window — "every autumn" is a due *window* (e.g. Sep 1 – Nov 30), not
     an arbitrary day. This is what home maintenance actually needs and what iCal RRULE
     cannot express, which is why RRULE was rejected.
- **Instances are location-anchored**, `parentId: null`, surfaced as a virtual
  "Maintenance" board per location. Keeps ten years of gutter-cleanings out of the project
  tree. An instance can be promoted into a real project if it turns out to be one.
- **At most one open instance per rule.** Miss five cycles and you see one card, overdue,
  not five cards. Track `missedCount` if a nag is wanted later. Catch-up spawning was
  rejected: greeting the user with 14 cards after a holiday is exactly the overwhelm this
  app exists to prevent.

### Effort

- **Five buckets**, ordinal enum, **on tasks only — not projects**:
  `<30 min`, `<2 h`, `an evening`, `a weekend`, `multi-week`.
- Drives a "quick wins" section: _top 3 things under 30 minutes_.
- Drives a split nudge: effort ≥ *a weekend* with no children → suggest breaking it down.

### Suggestions ("what should I do next?")

- **Transparent weighted score**, computed on-device. No LLM. Runs offline, costs nothing,
  and every suggestion shows *why* it was picked.
- Candidates are actionable nodes only: not done, no unresolved `blockedBy`.
- Score inputs: overdue amount, deadline proximity, priority, how many other tasks it
  unblocks, staleness, seasonal fit (an outdoor job in July beats it in January), and
  effort fit for the time available.
- Weights are expected to be wrong at first and tuned after real use.

### AI / API

- **No LLM inside the app.** Instead, the app is made drivable *by* agents.
- **REST API on Cloud Functions, in MVP**, with hashed API keys scoped to a home, plus a
  `SKILL.md` documenting the verbs and hierarchy rules so an agent can populate whole
  project trees. Needs a bulk/subtree create endpoint.
- An MCP wrapper over the same REST surface is a cheap later addition.
- This inverts the usual design: research and task breakdown are done by the user's own
  agent, which writes results in. No per-user inference cost, no liability for generated
  advice about wiring or gas.

### Platform, auth, i18n

- **Web PWA first** via Expo + React Native Web; Android and iOS builds later.
- **Google sign-in only** for now. Email/password and others can follow.
  ⚠️ **Pre-launch task**: the Apple App Store requires Sign in with Apple wherever
  third-party sign-in is offered.
- **Web sign-in is a redirect, on an `authDomain` that is the app's own origin.** A popup
  works in a desktop tab and dead-ends in an installed PWA, which is the shipping product
  for the least technical person in [`PERSONAS.md`](PERSONAS.md); and a redirect through
  `<project>.firebaseapp.com` relies on cross-site storage that Safari discards. Firebase
  Hosting reserves `/__/auth/` on every domain it serves, so the handler is same-origin.
  Setup is in [`OPERATIONS.md`](OPERATIONS.md); the full rationale is in
  [`specs/platform-offline.md`](specs/platform-offline.md).
- **i18next with `en-US` and `sv-SE` from day one.** Every string goes through `t()`.

### Drag & drop

- **Not in MVP.** Card tap opens a move sheet ("Move to → column") plus reorder controls;
  the board is a horizontal pager, one column per screen on phone.
- Cross-column drag with auto-scroll, drop placeholders and rank recalculation in React
  Native is a multi-week problem and a classic place where solo projects stall.
- **`rank` uses fractional / lexicographic ordering from day one**, so adding real drag and
  drop later is a pure UI change with no data migration. Tracked as a post-MVP issue.

## Scope

### MVP

1. Projects board with infinite drill-down and breadcrumb navigation.
2. Location tree view — sidebar/drawer navigation, showing work rolled up from descendants.
3. Recurring maintenance list with due dates, grouped overdue / this month / later.
4. Auth, home creation, member invite.
5. REST API + `SKILL.md` for agent access.

### Post-MVP, roughly in order

1. Overview: ongoing projects, upcoming maintenance, 30-day completed summary. Named
   *Overview* / *Översikt* rather than "dashboard home", because **home** is the
   household you are in — see [`specs/home-and-members.md`](specs/home-and-members.md).
2. Next-task suggestion engine (needs real data before its weights mean anything).
3. Drag and drop on boards.
4. Calendar view for recurring tasks.
5. Starter location templates and a curated maintenance library.
6. Custom user-defined statuses.
7. Cost / budget tracking.

## Architecture Principles

- **One node type, many views.** Projects, tasks and subtasks are the same document at
  different depths. Every board screen is one reused component. Resist per-level special
  cases; they multiply.
- **Two independent trees.** Project structure answers *what*, location structure answers
  *where*. Neither is a parent of the other, and a node moving in one must never move in
  the other.
- **Denormalize the ancestor paths.** `ancestorIds[]` and `locationAncestorIds[]` are what
  make roll-up queries a single index lookup. Subtree moves must rewrite them — subtree
  sizes here are tiny, so this is cheap and correct.
- **Status is global, presentation is local.** Anything that must be queryable across
  boards lives in a fixed vocabulary; boards only choose what to display.
- **Queries must be provably safe.** Firestore denies whole queries, not individual
  documents. Every read path is written so that no matching document could be
  rule-denied.
- **Constrain every listener.** Cost risk is listener breadth, not data volume.
- **Offline is not optional.** Work happens in basements, sheds and gardens.
  ⚠️ Firebase **Storage has no offline write queue** — photos captured without signal must
  go into a local pending-upload queue with retry. This is real work, not a checkbox.
- **Reduce overwhelm.** One overdue card, not five. Quick wins surfaced. Big tasks nudged
  toward being split. Every design choice that adds guilt or clutter is suspect.
- **Explain the recommendation.** A suggested task always shows why it was suggested.
- **The API is a first-class surface**, not an afterthought — agent-driven population is a
  primary use case, not a nice-to-have.

## Competitive landscape

The category is crowded with home *maintenance* apps (asset registers, warranty tracking,
seasonal reminders): HomeZada, Homekeepr, HomeKeep, Home Keeper, Homekeeper (Maintenance &
DIY), MOREPHO Home Project Planner, HomeEc.

The closest direct competitor is **[HomeQueue](https://homequeue.app/)** — launched, free
and paid tiers, web plus iOS/Android. It overlaps this project substantially:

- One shared household backlog of repairs, upkeep, renovations and small jobs
- Priority scoring on effort, cost and importance to decide what to tackle next
- "What fits the time I have" planning
- Recurring maintenance kept separate from one-off jobs
- Photo attachments, assignment to household members, calendar integration

**What it does not have, and what this project is actually for:**

1. **Nested boards.** A project drills down into its own board; a task can become a board.
   HomeQueue is a flat list.
2. **A location hierarchy.** Outside/Inside → floors → rooms, with projects attached at any
   level and views rolled up from it.
3. **Kanban with real workflow stages** — research / planning / execution / review — rather
   than a priority-sorted list.
4. **A REST API with API keys and a SKILL.md** so external AI agents can populate and drive
   the board.

Those four are the differentiators. Positioning is "project management for a house," not
"maintenance reminders." Avoid naming or copy that reads as a HomeQueue clone.

## Naming

> **Decided: Home Backlog.** Final. The Firebase project, GitHub repository and app all
> use it; the domain moves to `homebacklog.com`, with `hb.senth.org` serving until then.
> The caveat below stands and was accepted knowingly: HomeQueue's first line of copy is
> "one shared household backlog", so this name arrives second into vocabulary a live
> competitor already uses. There is no trademark conflict. A real USPTO / EUIPO clearance
> search remains a pre-launch task.
>
> The research below is kept as the record of what was considered and why.

Working name **Home Projects** is legally usable but weak: no app owns the exact name, but
`homeprojects.com` is registered, "DIY Hub: Home Projects" already uses it as a subtitle,
and the category is crowded with near-identical names. It is effectively unregistrable as
a trademark and invisible in store search.

**Homekeeper is rejected outright** — every domain variant is registered, five shipped apps
use the name or a homophone, and [HOMEKEEPR is a live USPTO application][hk] (serial
99375065, Homekeepr Inc., filed Sept 2025) covering *"downloadable mobile application
software for... residential home systems management and care"*, which is this exact
product in this exact class.

[hk]: https://trademarks.justia.com/993/75/homekeepr-99375065.html

**"Home planning" is a dead vein**: `homeplan`, `houseplan`, `homeplanner`, `houseplanner`,
`planmyhome` and `homeplanning` are all registered, and "house plans" is dominated by the
architectural-drawings industry — unwinnable search terms.

**"Homestead" is the wrong word**: it reads as small-farm, not house-and-yard. Homestead
Planner, Homestead Tracker and Homestead Keeper all target livestock and crops.

Availability research (250+ RDAP checks) found bare `.com` and `.app` almost entirely
squatted, including for invented words. Candidates below each have a free bare `.com`,
free npm package name, free GitHub org, no colliding app, and no obvious trademark
conflict.

### Descriptive — the preferred direction

| Name | Domain | Note |
|---|---|---|
| **Homebacklog** | `homebacklog.com` | Strongest fit; see caveat below |
| **Housebacklog** | `housebacklog.com` | |
| **Upkeepboard** | `upkeepboard.com` | Covers house and yard without naming either |
| **Homeprojectboard** | `homeprojectboard.com` | Fully descriptive, long |
| **Kanbanhome** | `kanbanhome.com` | Leads with the kanban differentiator |
| **Abodeboard** | `abodeboard.com` | |
| **Casitaboard** | `casitaboard.com` | |

_Caveat on the backlog family: HomeQueue's first line of copy is "one shared household
backlog" and its staging site was `homeowner-backlog.vercel.app`. No trademark conflict,
but **Homebacklog** would arrive second into vocabulary a live competitor already owns._

### House + yard scope

| Name | Domain | Note |
|---|---|---|
| **House & Grounds** | `houseandgrounds.app` | Bare `.com` taken; no app, npm or GitHub collision |
| **Home & Grounds** | `homeandgrounds.app` | As above, but [a Minnesota landscaping firm](https://homeandgroundsmn.com/) trades under this exact name |
| **Rooms & Grounds** | `roomsandgrounds.com`, `roomsandgrounds.app` | Both TLDs free |
| **House & Shed** | `houseandshed.com` | |
| **Home & Shed** | `homeandshed.com` | |
| **Roof & Yard** | `roofandyard.com` | |
| **Walls & Grass** | `wallsandgrass.com` | |
| **House & Yard Board** | `houseandyardboard.com` | |

_"Grounds" is the most precise word for house-plus-land, but reads slightly grand — it
suggests an estate rather than a suburban lot. **House & Grounds** is preferred over
**Home & Grounds**: no business collision, and the harder consonants scan better._

### Three-word — descriptive

Three-word names are near-unclaimed territory: 39 of 45 candidates had a free bare `.com`,
against roughly 1 in 50 for single words. They also self-describe, which removes the
explaining a coined name needs. All seven below hold a free bare `.com`, free npm, free
GitHub org, and no colliding app.

| Name | Domain | Note |
|---|---|---|
| **Plan Fix Grow** | `planfixgrow.com` | Three verbs covering planning, house and garden — the whole app in three words |
| **Home Grounds Board** | `homegroundsboard.com` | Subject + scope + method |
| **Home Grounds Planner** | `homegroundsplanner.com` | Same, planning-led |
| **Rooms Grounds Board** | `roomsgroundsboard.com` | Names the location hierarchy directly |
| **Inside Outside Board** | `insideoutsideboard.com` | Matches the app's own Inside/Outside view |
| **Home Yard Backlog** | `homeyardbacklog.com` | |
| **Rooms Yards Sheds** | `roomsyardssheds.com` | Pure scope triple |

_Alternate: **Sort Fix Grow** (`sortfixgrow.com`). Rejected: **Home Yard Planner** — too
close to [Yard Planner](https://homeoutside.com/mobile-app/), an existing landscape-design
app. Also taken: Plan Build Grow, Fix Build Grow, Build Fix Grow, Plan Do Done, Plan Work
Done._

### Invented — house / garden

| Name | Domain |
|---|---|
| **Nails & Soil** | `nailsandsoil.com`, `nailsandsoil.app` |
| **Saws & Seeds** | `sawsandseeds.com`, `sawsandseeds.app` |
| **Brick & Bloom** | `brickandbloom.app` |
| **Housedone** | `housedone.app` |
| **Sheddy** | `sheddy.app` |
| **Roundtuit** | `theroundtuit.com` |
| **Yardworky** | `yardworky.com` |

_Rejected: **Housify** (Housify AI on Google Play plus several companies),
**Abodify** (existing home business), **Snagboard** (existing property-inspection app,
same problem domain), **Rooftree** (live habit app at rooftree.app)._

### Rejected direction — metaphor

Timber-framing metaphors (Ridgetree, Ridgepole, Collarbeam, Strutwork, Crownpost, Kingpost,
Roofbeam) were researched and available, but rejected: too oblique, says nothing about what
the app does.

### Before committing

- Verify the domain at a registrar — RDAP shows registration, not purchasability or price.
- A real USPTO / EUIPO clearance search is a pre-launch task, not a today task.
