# Testing policy

A test earns its place by what it would catch, weighed against what it costs to run and
to keep working. e2e is the most expensive thing this repo owns — a real browser, a real
emulator stack, and a flake budget that comes out of every future run — so it is rationed
on purpose. Everything else is cheap and should carry the load.

## Three tiers

**Unit tests are the default.** They are where logic is proven: domain modules under
`models/` and `data/`, hooks, and the components whose behaviour a user can describe.
`@testing-library/react-native` is already here — render the component, act as the user,
assert what they would see. Prefer moving the logic out of the component and testing it
plain; reach for a render test when the behaviour only exists once the pieces are wired.

Still true, and unchanged: **snapshot tests and layout-only render tests do not exist**.
A test that asserts a tree shape or a pixel is a test that fails on every restyle and
catches nothing. A one-line wrapper around an SDK call is not a domain module and does not
get a test.

**e2e proves the core loop, and nothing else.** `e2e/` drives a real browser against the
real stack. That is the only place where routing, Firestore rules, offline persistence and
the rendered result are all true at once, which is why the few things that need all four
live there — and why nothing that does not need all four may.

**Everything else is checked by hand, once, through the `playwright-cli` skill.** Edge
cases, error states, one-off regressions, the screen you want to look at before shipping:
drive it, look at it, fix it, and do not leave a spec behind. A check that runs on every
PR forever has to be worth that; most checks are not.

## The e2e budget

**Ten spec files in `e2e/`. Hard cap.** Not ten as a target to grow into — ten as a
ceiling that is reached only by things that cannot be proven anywhere cheaper. `yarn
invariants` enforces the cap: `scripts/check-invariants.sh` counts the specs and an
eleventh file fails the gate.

The repo holds seven of the ten. Three of them are held permanently, because each
enforces a rule written down elsewhere and there is nowhere cheaper to enforce it:

- `craft.spec.ts` — the rendered design checks, against the tokens named in
  `.ai/config.toml`'s `[design]`. It owns the measurements; a human judges what a
  measurement cannot.
- `console.spec.ts` — the clean console, whose exceptions are the closed list in
  `utils/dev-console.ts` and `e2e/support/app.ts`.
- `i18n.spec.ts` — no raw translation key renders, and `sv-SE` is actually in effect.

The other four cover the **core loop**: sign in and land on a home, see what is
outstanding on the overview, open a board, create and move and complete a card, nest a
card into its own board, and have all of that survive a reload. A spec belongs there if
breaking it means the app is unusable, not merely wrong somewhere.

- `core-loop.spec.ts` — board CRUD: create, move through the columns, complete, reload.
- `nesting.spec.ts` — a card becomes a board: drill down, breadcrumb back, re-parent,
  promote.
- `overview.spec.ts` — the dashboard renders what is outstanding.
- `details.spec.ts` — every control on the details screen, waiting-on folded in.

**Three slots are free.** They are headroom, not a target to fill: the next feature that
genuinely earns e2e coverage takes one without evicting anything.

Setup projects (`auth.setup.ts`, `fixture.setup.ts`) and `support/` are not specs and do
not count.

## Adding one

A new spec first takes one of the three free slots; once those are gone, it has to
displace an existing one. There is no eleventh slot, and no "just this
once" — the cap is the whole mechanism, and an exception granted twice is not a cap.

So a major feature that wants e2e coverage argues for it, in the PR or the issue, in
these terms:

1. **Which slot it takes, by name**, and why that spec is now the least valuable of the
   ten.
2. **Why unit tests cannot prove it** — specifically, which of routing, rules, offline or
   rendering it needs simultaneously.
3. **Why `playwright-cli` by hand is not enough** — what would silently break later that a
   one-time check would not catch.

Cannot make all three arguments? Then it is a unit test, or a hand-check, and that is the
normal outcome. Most features do not get e2e coverage. That is the policy working.
