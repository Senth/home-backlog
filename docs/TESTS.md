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
ceiling that is reached only by things that cannot be proven anywhere cheaper.

Two of the ten are held permanently, because each enforces a rule written down elsewhere
and there is nowhere cheaper to enforce it:

- `craft.spec.ts` — the rendered design checks, against the tokens named in
  `.ai/config.toml`'s `[design]`. It owns the measurements; a human judges what a
  measurement cannot.
- `console.spec.ts` — the clean console, whose exceptions are the closed list in
  `utils/dev-console.ts` and `e2e/support/app.ts`.

The remaining eight cover the **core loop**: sign in and land on a home, see what is
outstanding on the overview, open a board, create and move and complete a card, and have
that survive a reload. A spec belongs there if breaking it means the app is unusable, not
merely wrong somewhere.

Setup projects (`auth.setup.ts`, `fixture.setup.ts`) and `support/` are not specs and do
not count.

## Adding one

A new spec has to displace an existing one. There is no eleventh slot, and no "just this
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

## Where this stands today

`e2e/` holds more than ten specs. That is debt, not the policy: it is paid down in #201,
which converts what converts and deletes the rest. Until that lands, the cap is the
direction — nothing new is added, and anything touched is asked whether it should exist.
