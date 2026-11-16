# dsh-plugin-github-auth

Connect a GitHub account to DeepSeek Harness the way headless tools do it: **OAuth device flow**, no redirect URI, no client secret, no callback server.

- **Settings → GitHub** page: connect, see who is connected, disconnect.
- **Token stored locally** with owner-only permissions, in the harness state directory.
- **`github_api` tool**: the assistant can then call the GitHub REST API as that account — create a repository, commit files, open issues.

## Install

Requires DeepSeek Harness `0.2.x` (`engines.dsh: >=0.2.1-rc.3 <0.3.0`) with the Web GUI. No build step. The 0.2.2-rc.3 source compatibility review does not raise the minimum; see [compatibility evidence and verification limits](./COMPATIBILITY.md).

**From GitHub:**

```
install_bundle  target: "github:yangjiechao/dsh-plugin-github-auth"
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

### Connect your account

1. Open **Settings → GitHub**, click **Connect GitHub**, and open the displayed GitHub device authorization link.
2. Enter the code shown in DSH and approve the requested access on GitHub. Do not share the code or your token in chat.
3. Return to **Settings → GitHub** and check that your GitHub login is shown. Authorization continues in the host if you close Settings, but a host restart or plugin reload interrupts an in-progress flow; start again if needed.

A successful GitHub browser message alone does not guarantee the token was saved. The Agent can verify the connection with `github_api({ method: "GET", path: "/user" })`. If it reports `github-not-connected`, reconnect in Settings.

### Ask an Agent to push files

Once connected, the assistant has one extra tool:

```
github_api({ method: "GET", path: "/user" })
github_api({ method: "POST", path: "/user/repos", body: { name: "my-repo", private: false } })
github_api({ method: "GET", path: "/repos/owner/repo/contents/README.md", accept: "application/vnd.github.raw" })
```

For example, ask: **“Use `github_api` to upload these files to `owner/repo` on `main` in one commit. Check the remote branch first, preserve unrelated files, and do not force push.”** Specify the repository, branch, files and desired commit message; review the Agent's changes before authorizing publication.

The Agent can upload one file or several files in a **single commit** using the Git data API (all paths below are relative to `/repos/owner/repo`):

1. Read `GET /git/ref/heads/main` to obtain the branch tip commit SHA, then `GET /git/commits/{sha}` to obtain its tree SHA. Confirm the tip matches the intended base; if it has changed, stop and reconcile instead of overwriting someone else's work.
2. Read the intended local files and create a blob for each with `POST /git/blobs` (`content` and `encoding`: `utf-8` or `base64`). Use the returned blob SHAs and correct file paths/modes in `POST /git/trees`, setting `base_tree` to the existing tree so unrelated files are retained. Verify the uploaded contents or blob SHAs when practical.
3. Create one commit with `POST /git/commits`, using the new tree SHA and the original tip as its parent. Update the branch with `PATCH /git/refs/heads/main`, passing the new commit SHA and `force: false`. Verify the resulting ref and report the commit link. If the update is rejected because the branch moved or is protected, stop and resolve the conflict or follow the repository's pull-request policy; do not force it.

The plugin calls GitHub's REST API as the connected account; **it does not configure Git's terminal credentials**. An Agent can create commits and update branches through `github_api` without `git push` or a terminal login, subject to GitHub permissions and branch rules. Conversely, `git push` in a terminal needs its own Git credential configuration; neither login automatically configures the other. API-created commits may have a different SHA from an existing local commit even if their file trees match, so compare both before synchronizing local Git history.

## 中文使用说明

### 连接 GitHub 账号

1. 打开 **设置 → GitHub**，点击“连接 GitHub”，再打开显示的 GitHub 设备授权链接。
2. 在 GitHub 输入 DSH 页面显示的代码，并确认所请求的授权。不要在聊天中发送设备代码或 token。
3. 返回 **设置 → GitHub**，确认显示你的 GitHub 用户名。关闭设置页后 Host 仍会继续处理授权；但如果 Host 重启或插件重新加载，进行中的流程会中断，需要重新发起。

GitHub 网页提示授权成功，并不单独保证插件已保存凭证。可以让 Agent 调用 `github_api({ method: "GET", path: "/user" })` 检查；如果提示 `github-not-connected`，请在设置中重新连接。

### 让 Agent 上传文件并创建提交

自然语言示例：**“请使用 `github_api`，把这些文件上传到 `owner/repo` 的 `main` 分支，合并为一次提交。先检查远端分支，保留其他文件，不要强制推送。”** 请明确仓库、分支、文件和提交信息，并在授权发布前审查改动。

Agent 可通过 Git 数据 API 将单个或多个文件放入同一个提交（以下路径均相对于 `/repos/owner/repo`）：

1. 通过 `GET /git/ref/heads/main` 获取目标分支最新提交 SHA，再通过 `GET /git/commits/{sha}` 获取原有 tree SHA。确认分支头是预期的基线；如有他人更新，停止并先协调，避免覆盖。
2. 读取要上传的本地文件，逐个调用 `POST /git/blobs`，以 `content` 和 `encoding`（`utf-8` 或 `base64`）创建 blob。使用返回的 blob SHA、正确路径及文件模式调用 `POST /git/trees`，并指定原 tree 为 `base_tree`，保留未修改文件。条件允许时校验上传内容或 blob SHA。
3. 调用 `POST /git/commits`，以新 tree SHA 和原分支头为父提交创建一次提交；再调用 `PATCH /git/refs/heads/main`，提供新提交 SHA 和 `force: false`。最后核验分支并报告提交链接。如果分支移动或受到保护而拒绝更新，应停下处理冲突或按仓库策略创建拉取请求，不要强制覆盖。

插件用已连接账号调用 GitHub REST API，**不会自动配置终端 Git 凭证**。在 GitHub 权限和分支规则允许的情况下，Agent 不需要终端登录或执行 `git push`，即可通过 `github_api` 创建提交和更新分支；终端中的 `git push` 则需要单独配置 Git 凭证，两者不会自动共享登录。API 创建的提交即使文件树相同，其 SHA 也可能与现有本地提交不同；同步本地 Git 历史前应先比较。

### 权限与安全

插件请求 `repo` 和 `read:user` OAuth 范围；`repo` 可能授予对该账号可访问的私有仓库的广泛访问能力，并非只限于某一个仓库。实际操作仍受账号权限、组织策略及分支保护规则限制。只授权可信的 OAuth App 和 Agent，发布前检查文件中没有密钥或其他不应公开的内容，不要在聊天中提供 token。断开插件连接会删除本地 token，但不会在 GitHub 撤销授权；需要时请到 <https://github.com/settings/applications> 撤销。

## Security

- The token is written to `<profile>/state/github-auth.json` (or `$DSH_HOME/state/github-auth.json`) with mode `0600` in a `0700` directory, through a temp-file-and-rename so a crash cannot leave a half-written file.
- It is sent only to `https://api.github.com`, from the host process. The browser page never receives it — the settings page only ever sees a login name, an avatar URL and the scopes GitHub reported.
- The host exposes POST-only endpoints under `/dsh-github-auth/`; they reject cross-origin `Origin` headers and bodies over 8 KiB.
- The requested OAuth scopes are `repo` and `read:user`. `repo` may grant broad access to private repositories available to the account, not just one repository. Actual actions remain subject to account permissions, organization policy, and branch protection. Authorize only an OAuth App and Agent you trust, review files for secrets before publishing, and never share the token in chat.
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
