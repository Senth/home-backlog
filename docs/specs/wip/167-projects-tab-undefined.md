# 167 — Projects tab navigates to `/projects/undefined`

## Handoff

- Branch: `bug/167-projects-tab-undefined` (from `origin/main`), card moved to In progress.
- Run `/continue-work docs/specs/wip/167-projects-tab-undefined.md` in a fresh session.
- Found during review of #161; root cause last changed by d80104b (#158).

## What

Signed in on `/overview`, clicking the **Projects** tab navigates to
`/projects/undefined` and paints a blank screen. Navigating to `/projects`
directly renders the root board correctly, so only the tab's own navigation is
broken.

## Why

`app/(app)/(tabs)/projects/_layout.tsx` declares only the two dynamic screens
(`[nodeId]/index`, `[nodeId]/details`) on its inner Stack. Expo Router hoists
declared `Stack.Screen` children to the front of the screen list in declaration
order and appends the undeclared ones after
(`getSortedChildren` in `expo-router/build/useScreens.js`), so the Stack's
initial route resolves to `[nodeId]/index` — with no `nodeId` param. Serialising
that state to a path fills the dynamic segment with the literal `undefined`, and
the node board screen, whose `nodeId` is missing, subscribes to nothing and
renders `null`. The `String(params.nodeId)` identity on the same layout returns
the string `"undefined"` for the same reason; it is a symptom, not the cause.

The fix: the Stack's initial route must be `index` — declare
`<Stack.Screen name="index" />` first on the inner Stack (or set
`initialRouteName="index"`), so a tab press lands on `/projects` and the root
board.

## Surface brief

The tab lands where it always should have; nothing else on any screen moves.

## Acceptance

1. [test] Clicking the **Projects** tab from `/overview` lands on `/projects`
   and shows the root board's data. Lives in `e2e/navigation.spec.ts` as
   `test("1: …")`; this is the suite's first tab click — no e2e test navigates
   by tab today. When it fails before the fix it must fail on the path:
   clicking the tab reports the pathname as `/projects/undefined`, not a
   timeout, not a redirect to `/homes`.

## What this does NOT change

- The `dangerouslySingular` identities on `[nodeId]/index` and `[nodeId]/details`
  stay exactly as they are; drill-down, breadcrumbs and `dismissTo` behaviour are
  #158's and are not touched.
- `board-href.ts` stays the one place board paths are written.
- The sibling tabs (`overview`, `locations`, `maintenance`) have no nested Stack
  and no declared dynamic screens; they are untouched.
- `docs/specs/boards-and-nodes.md` ("Breadcrumbs and navigation") already
  describes `/projects` as a real route of the inner Stack; the code was wrong,
  so the spec needs no correction.

## Out of scope

Nothing filed. The cause and the symptom live in the same file and both are
closed by the one-line fix.

## Phases

- Phase 1 — the failing e2e test in `e2e/navigation.spec.ts`: from
  `/overview`, click the Projects tab (`role="tab"`), assert the pathname is
  `/projects` and the board's readiness text is visible. Red for the reported
  reason: pathname is `/projects/undefined`.
- Phase 2 — the fix in `app/(app)/(tabs)/projects/_layout.tsx`: `index` becomes
  the Stack's initial route. Test goes green.
