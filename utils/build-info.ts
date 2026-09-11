/**
 * The build stamp the page and the HTML shell must agree on: a deploy lands,
 * this value changes in both places, and a shell carrying a value the running
 * bundle does not name is a stale shell (#264).
 *
 * `deploy.yml` writes `EXPO_PUBLIC_BUILD` into `.env.local` before
 * `yarn build:web`, so Expo inlines it into the bundle and `app/+html.tsx`
 * bakes it into the exported HTML. Unset — local dev, tests — this is "dev",
 * and both places then agree on it the same way.
 */
export const buildId = process.env.EXPO_PUBLIC_BUILD ?? "dev";
