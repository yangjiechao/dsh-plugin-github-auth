# Compatibility review

Reviewed against the installed DeepSeek Harness **0.2.2-rc.3** on 2026-11-16.

## Version policy

Keep the existing `engines.dsh: >=0.2.1-rc.3 <0.3.0`. This review does not establish a new minimum or widen the range. There is no observed dependency on a 0.2.2-rc.3-only API, so raising the minimum just to match the review environment would unnecessarily exclude existing users. The range is a declared support policy, not evidence that every prerelease or future 0.2.x release has been tested. Recheck on DSH upgrades.

## Source evidence

The installed distribution is `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`, whose package manifest reports 0.2.2-rc.3. Relative to its `node_modules/@deepseek-ai/`:

- `dsh-host-webserver/src/index.ts`: `getOrigin()` and disposable `register(route)` remain available (lines 430 and 445).
- `dsh-tools/src/index.ts`: disposable `register(definition, options)` remains available (line 128).
- `dsh-client-locale/src/client/index.ts`: `bind(namespace)` caches a translator and reads the active locale at call time (lines 459–477). The current Client refresh callbacks therefore do not become unstable on every render.
- The Client retains the classic ModuleLoader factory and `settings.section` registration; the provider remains declared in the manifest.

The packaged upgrade index was reviewed for 0.2.1-rc.3, 0.2.1-rc.4, 0.2.2-alpha.2, 0.2.2-alpha.3 and 0.2.2-rc.1. Its account notifications/Remote changes concern DSH's own account services, not this plugin's GitHub OAuth HTTP endpoints. Tool-specific schedule changes, projection, attachment, CUA, Forge, terminal, office and window-drag guides do not affect the APIs used here. No applicable migration was identified.

## Reproducible checks and limits

Run `npm run check` and `npm test`. The tests exercise Host route/tool registration and disposal, method/origin rejection, and Client settings/locale registration with lightweight doubles. They never read a real token, contact GitHub, initiate authorization, or mutate a profile. They are contract regression checks, not a live mounted-host, browser, OAuth, or visual acceptance test. No actual login or API write was performed during this review.
