# Personas

> The cast a review judges as, and the reference for anyone writing a spec, a `t()`
> string or store copy. A browser review picks the one persona the change most affects.

These are a **review instrument**, not market research. Each persona exists to stress
one thing this product can plausibly fail at, and no two of them can produce the same
finding. That constraint is the point: a cast picked for variety produces six versions
of the same generic UX note.

Keep the cast at six. To cover a new risk, **replace** the persona whose risk has
become least interesting rather than adding a seventh — every extra voice costs
review length and dilutes the rest.

Five are Nordic-suburban, because year one is one Swedish household and that is the
reality the app must fit first. Priya is the single deliberate `en-US` check, guarding
the store release that PROJECT.md keeps open.

Each entry carries the same eight fields. **Quits when** is the sharpest of them: it
turns "this feels a bit cluttered" into "this is the thing that makes Nadia stop
opening the app."

---

### Marcus, 41 — the renovator

**Home** 1960s two-storey house in a Swedish suburb; renovating it room by room.
Basement, attic, garage, a workshop corner. His location tree is four levels deep and
he keeps extending it.
**Household** Lives with Nadia. He set the app up, he owns the board, he does
essentially all of the curating.
**Tech** Laptop and phone, fluent. Has used Trello and Jira, and left both — Trello
because it went flat, Jira because it went heavy.
**Hobbies** Woodworking, tiling, a bit of plumbing, restoring the house's original
details.
**Opens the app to** Plan the next stage of the bathroom, split a project that grew,
and see what is blocked on somebody else or on a delivery.
**Says** Project language, natively: "phase", "blocked on", "next up", "we're in
planning on that one".
**Quits when** The app cannot hold the real shape of the work — a "project" that is
honestly five projects, or a task he cannot break down from where he is standing.
**Stresses** Nesting depth and drill-down, the workflow stages, breakdown nudges on
large-effort tasks, `blockedBy`, reordering, and whether a board full of real work is
still navigable.

---

### Nadia, 39 — the half-engaged partner

**Home** The same 1960s house; her half of it is outdoors — vegetable beds, hen house,
greenhouse.
**Household** Shares everything with Marcus, curates nothing. She is in the app
because he is.
**Tech** Phone only, Android, notifications mostly off. Will not go looking for a
feature.
**Hobbies** Vegetable garden, hens, baking, a slow campaign to get the greenhouse
usable.
**Opens the app to** Find out what Marcus expects of her this weekend, and add the
one thing she just noticed before she forgets it.
**Says** "The beds", "out back", "the hens" — never "node", "board", "backlog" or
"status".
**Quits when** It reads like a list of chores someone else assigned her, or when her
own garden work is invisible next to his renovation.
**Stresses** Uneven engagement between household members, `participantIds` and
unassigned work, private vs shared visibility, notification tone and volume, and
whether a second person can contribute without adopting the whole system.

---

### Ingrid, 71 — the non-technical owner

**Home** The family house she has lived in for forty years — big garden, apple trees,
a shed — plus a summer cabin three hours north that the family shares.
**Household** Alone in the house. Nadia and Marcus help at the cabin, so that home has
several people in it and this one does not.
**Tech** iPhone, text size turned up, one thumb. Installs nothing without help and does
not distinguish an app from a website. Uses the Swedish interface.
**Hobbies** The garden, the apple trees, preserving, keeping the cabin from rotting.
**Opens the app to** See what has to happen before winter, and remember what the
chimney sweep said in March.
**Says** "The apple trees", "the cabin", "before the frost". Every English loanword the
UI uses — backlog, board, kanban — is a wall.
**Quits when** She has to learn a vocabulary to do something she already understands,
or taps something and cannot find her way back.
**Stresses** Jargon in `t()` strings and whether `sv-SE` reads like Swedish rather than
translated English, discoverability without hunting, tap targets and text scaling,
switching between two homes, and destructive actions being reachable by accident.

---

### Tom, 55 — the seasonal maintainer

**Home** House on a larger lot: detached garage/workshop, carport, boathouse, a long
hedge, gutters, a gravel drive that needs grading.
**Household** Him. Adult children visit and occasionally help; nobody else touches the
app.
**Tech** Android, competent and unenthusiastic. The phone is in his pocket in the
workshop, where there is no signal.
**Hobbies** A long-running project car, the boat, and the calendar of hedge, gutters,
service intervals and snow that fills the rest of the year.
**Opens the app to** Check what the season demands, and log something the second he
notices it — standing in the garage with gloves on.
**Says** "The gutters", "spring service", "before it freezes", "out in the garage".
**Quits when** It greets him with five overdue cards for one missed job, or loses the
photo he took in the garage where there was no signal.
**Stresses** All three recurrence rule types and especially season windows, one open
instance per rule, the location tree below the house (outbuildings, not rooms), offline
capture and the photo upload queue, and how few taps it takes to add a thing one-handed.

---

### Priya, 34 — the `en-US` check

**Home** A 2018 build in a US suburb. HOA rules, attached garage, small yard, no
basement, an HVAC system with filters.
**Household** Partner and two children under six. Both adults work.
**Tech** iPhone, app-fluent, very little patience. Uses the app in twenty-minute gaps.
**Hobbies** Houseplants, the yard, painting rooms, an endless kid-proofing list.
**Opens the app to** Find one thing she can actually finish before the kids wake up.
**Says** "Fall", "yard", "HVAC filter", "the garage". Thinks in feet and Fahrenheit.
**Quits when** The app shows her the whole mountain instead of the next step, or when
its assumptions are visibly Nordic — the seasons, the vocabulary, the units, the idea
that everyone has a basement.
**Stresses** Effort buckets and quick wins, overwhelm and guilt in the UI, `en-US`
wording and units, seasonal assumptions baked into recurrence defaults, and
notification volume for someone with no spare attention.

---

### Kasper, 30 — the agent-driver

**Home** A terraced house he is slowly automating. Modest garden, a shed full of
printers.
**Household** Alone; his partner has no interest in the board.
**Tech** Writes code, runs his own AI agent, holds an API key. Will not type data into
a UI if an endpoint exists.
**Hobbies** Home automation, 3D printing, self-hosting, tinkering.
**Opens the app to** Read what his agent wrote in. The agent does the researching and
the entering; he reviews.
**Says** The API's own vocabulary — "node", "subtree", "bulk create", "idempotent".
**Quits when** Something is possible in the UI but not expressible over REST, so his
board drifts out of sync with his agent's model of it.
**Stresses** Whether a new feature is reachable through the API at all, bulk and
subtree creation, `SKILL.md` staying accurate as fields change, which fields an API key
may write, and what happens when his agent and a human edit the same node.
