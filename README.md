# dsh-plugin-github-auth

Connect a GitHub account to DeepSeek Harness the way headless tools do it: **OAuth device flow**, no redirect URI, no client secret, no callback server.

- **Settings → GitHub** page: connect, see who is connected, disconnect.
- **Token stored locally** with owner-only permissions, in the harness state directory.
- **`github_api` tool**: the assistant can then call the GitHub REST API as that account — create a repository, commit files, open issues.

## Install

Requires DeepSeek Harness `0.2.x` (`engines.dsh: >=0.2.1-rc.3 <0.3.0`) with the Web GUI. No build step.

**From GitHub:**

```
install_bundle  target: "github:<user>/dsh-plugin-github-auth"
```

**From a local checkout:**

```
install_bundle  target: "/absolute/path/to/github-auth"
```

Then reload the page. If the host was already running, toggle the `github-auth` row off/on (or restart `dsh web`) so the host module registers its endpoints.

## One-time setup: register an OAuth App

The bundle needs a **client id**. Registering the app is the *publisher's* job, once — users of the bundle never have to.

1. Open <https://github.com/settings/applications/new>.
2. **Application name**: anything, e.g. `DeepSeek Harness`.
3. **Homepage URL**: your repository URL.
4. **Authorization callback URL**: required by the form, but unused — put the same repository URL.
5. Create it, then on the app page **tick "Enable Device Flow"** and save. Without this the device endpoints refuse the client id.
6. Copy the **Client ID** (it looks like `Iv1.0123456789abcdef`) and paste it into `DEFAULT_CLIENT_ID` at the top of `index.js`.

> **Leave "Expire user access tokens" off.** With it on, GitHub issues 8-hour tokens; this bundle stores a token but does not refresh it yet, so every user would reconnect twice a day. The setting only affects newly issued tokens, so turning it off again requires a reconnect, not a fix.
>
> Refreshing such a token needs no client secret — GitHub requires the secret *unless the token came from the device flow* — so enabling expiry stays compatible with shipping a public client id. It just needs refresh support in `index.js` first.

A **client secret is never needed** — that is the point of device flow: the client is public, and the human approves each device in the browser.

### Do people who install this need to register their own app?

**No.** The published client id is enough: they open Settings → GitHub, click *Connect*, and authorize. One app, many users — exactly how `gh`, `hugo` or any CLI with device flow ships.

What it does mean for the publisher:

- The consent screen shows **your app's name** to every user, so name it clearly and keep it maintained.
- You can see and revoke authorizations at <https://github.com/settings/applications>; a user can do the same for their own account.
- If you delete or rename the app, existing connections keep working until the tokens are revoked, but new connections break. Ship a new client id, and users reconnect.
- Scopes are requested by this bundle (`repo read:user`), not chosen per user. Device flow with an OAuth App cannot be narrowed per repository — if that matters to your users, a GitHub App is the alternative, at the cost of 8-hour tokens plus refresh handling.

A user who does not trust the bundled app can set **their own** client id in Settings → GitHub; it is stored with the connection and takes precedence.

## Use

Open **Settings → GitHub**:

| State | What the page shows |
|---|---|
| No client id | A field to paste one (`Iv1.…`) |
| Ready | *Connect GitHub* |
| Waiting | The 8-character code, a link to `github.com/login/device`, and a live countdown |
| Connected | Avatar, login, granted scopes, *Disconnect* |

Once connected, the assistant has one extra tool:

```
github_api({ method: "GET", path: "/user" })
github_api({ method: "POST", path: "/user/repos", body: { name: "my-repo", private: false } })
github_api({ method: "GET", path: "/repos/owner/repo/contents/README.md", accept: "application/vnd.github.raw" })
```

Multi-file commits go through the Git data endpoints (`POST /git/blobs`, `POST /git/trees`, `POST /git/commits`, `PATCH /git/refs/heads/main`), so one tool call series produces one commit.

## Security

- The token is written to `<profile>/state/github-auth.json` (or `$DSH_HOME/state/github-auth.json`) with mode `0600` in a `0700` directory, through a temp-file-and-rename so a crash cannot leave a half-written file.
- It is sent only to `https://api.github.com`, from the host process. The browser page never receives it — the settings page only ever sees a login name, an avatar URL and the scopes GitHub reported.
- The host exposes five loopback endpoints under `/dsh-github-auth/`: they reject non-POST methods, cross-origin `Origin` headers, and bodies over 8 KiB.
- Host plugin code runs in-process, outside the workspace sandbox. Read `index.js` before installing; it is the whole surface.
- Disconnecting deletes the token from the file. It does **not** revoke the authorization on GitHub — do that at <https://github.com/settings/applications> if you want it gone everywhere.

## Files

| File | Role |
|---|---|
| `index.js` | Host: device flow, token storage, endpoints, `github_api` tool |
| `client.js` | Client: the Settings → GitHub section |
| `cordis.patch.yml` | Inserts the `github-auth` row |
| `locale/{en,zh}.json` | Display metadata for the plugin list |

## Develop

Edit `index.js`, then toggle the `github-auth` row (or restart `dsh web`) — the endpoints are host code. Edit `client.js`, then reload the page. To exercise the flow without GitHub, `POST /dsh-github-auth/status` with `curl` and watch the state file appear.

## License

MIT — see [LICENSE](LICENSE).
