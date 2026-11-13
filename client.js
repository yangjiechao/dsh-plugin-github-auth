/**
 * Client half of the GitHub device-flow auth bundle.
 *
 * One settings section, "GitHub": it shows whether an account is connected,
 * walks the user through the device-code consent when it is not, and lets a
 * user point the bundle at their own OAuth App. The token itself never reaches
 * the browser — the page only ever sees a login name and an avatar URL.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-github-auth',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const NS = 'githubAuth';

    const EN = {
      nav: 'GitHub',
      title: 'GitHub connection',
      description:
        'Connect a GitHub account so the assistant can create repositories and push files as you. Authorizing opens github.com in your browser; the token stays on this machine.',
      connect: 'Connect GitHub',
      disconnect: 'Disconnect',
      connectedAs: 'Connected as',
      scopes: 'Granted scopes',
      waitingTitle: 'Authorize this device',
      waitingBody: 'Open the page below and enter this code. This panel notices as soon as you approve.',
      openDevice: 'Open github.com/login/device',
      copyCode: 'Copy code',
      copied: 'Copied',
      expires: 'Code expires in {minutes} min',
      cancel: 'Cancel',
      unconfiguredTitle: 'No OAuth App configured',
      unconfiguredBody:
        'This bundle authorizes through a GitHub OAuth App. Paste its client id to enable connecting; the app needs no secret, and device flow is the only capability it uses.',
      clientIdLabel: 'OAuth App client id',
      clientIdPlaceholder: 'Iv1.0123456789abcdef',
      save: 'Save',
      saving: 'Saving…',
      overrideHint: 'Set here to use your own OAuth App instead of the bundled one.',
      builtinHint: 'Using the OAuth App bundled with this plugin.',
      settingsHint: 'Using the OAuth App set on this page.',
      errorTitle: 'Something went wrong',
      retry: 'Try again',
      loading: 'Checking…',
      tokenStoredAt: 'Token file',
      privacy: 'The token is stored on this machine with owner-only permissions and is never sent anywhere except api.github.com.',
      scopesNone: 'none reported',
      errClientIdMissing: 'No client id is configured yet.',
      errClientIdRejected: 'GitHub does not recognize that client id.',
      errDeviceFlowDisabled: 'The OAuth App has device flow disabled. Enable it in the app settings.',
      errExpired: 'The code expired before it was approved. Start again.',
      errDenied: 'Authorization was denied.',
      errGeneric: 'Request failed: {error}',
      errNetwork: 'Could not reach GitHub. Check the connection and try again.',
    };

    const ZH = {
      nav: 'GitHub',
      title: 'GitHub 连接',
      description:
        '连接一个 GitHub 账号，助手就能以你的身份创建仓库、推送文件。授权时会在浏览器打开 github.com，token 只保存在这台机器上。',
      connect: '连接 GitHub',
      disconnect: '断开连接',
      connectedAs: '已连接',
      scopes: '已授权范围',
      waitingTitle: '在浏览器中授权',
      waitingBody: '打开下面的页面并输入这个代码，你点确认后这个面板会自动继续。',
      openDevice: '打开 github.com/login/device',
      copyCode: '复制代码',
      copied: '已复制',
      expires: '代码还有 {minutes} 分钟过期',
      cancel: '取消',
      unconfiguredTitle: '还没有配置 OAuth App',
      unconfiguredBody:
        '这个插件通过 GitHub OAuth App 授权。填入它的 client id 才能连接；该应用不需要 secret，只用设备流这一项能力。',
      clientIdLabel: 'OAuth App client id',
      clientIdPlaceholder: 'Iv1.0123456789abcdef',
      save: '保存',
      saving: '保存中…',
      overrideHint: '在这里填写即可改用自己的 OAuth App。',
      builtinHint: '正在使用插件内置的 OAuth App。',
      settingsHint: '正在使用此页面填写的 OAuth App。',
      errorTitle: '出错了',
      retry: '重试',
      loading: '检查中…',
      tokenStoredAt: 'Token 文件',
      privacy: 'token 以仅本人可读的权限保存在本机，除了 api.github.com 之外不会发往任何地方。',
      scopesNone: '未报告',
      errClientIdMissing: '还没有配置 client id。',
      errClientIdRejected: 'GitHub 不认识这个 client id。',
      errDeviceFlowDisabled: '这个 OAuth App 没有启用设备流，请到应用设置里打开。',
      errExpired: '代码在授权前就过期了，请重新开始。',
      errDenied: '授权被拒绝。',
      errGeneric: '请求失败：{error}',
      errNetwork: '连不上 GitHub，请检查网络后重试。',
    };

    const ROUTES = {
      status: '/dsh-github-auth/status',
      start: '/dsh-github-auth/device/start',
      cancelFlow: '/dsh-github-auth/device/cancel',
      disconnect: '/dsh-github-auth/disconnect',
      clientId: '/dsh-github-auth/client-id',
    };

    const STYLE = `
      .dshga-root { display: flex; flex-direction: column; gap: 14px; max-width: 640px; }
      .dshga-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dshga-desc { font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dshga-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
      .dshga-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .dshga-avatar { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); }
      .dshga-login { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dshga-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .dshga-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
      .dshga-btn:hover { border-color: var(--dsw-alias-brand-primary); }
      .dshga-btn:disabled { opacity: .55; cursor: default; }
      .dshga-btn-primary { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); font-weight: 600; }
      .dshga-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 26px; letter-spacing: 3px; font-weight: 700; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; padding: 12px 16px; text-align: center; user-select: all; }
      .dshga-input { flex: 1; min-width: 200px; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-primary); font-size: 13px; padding: 7px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .dshga-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
      .dshga-error { border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; padding: 10px 12px; font-size: 13px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); }
      .dshga-ok { color: var(--dsw-alias-state-success-primary); }
      .dshga-link { color: var(--dsw-alias-brand-primary); font-size: 13px; text-decoration: none; }
      .dshga-link:hover { text-decoration: underline; }
      .dshga-note { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dshga-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-all; color: var(--dsw-alias-label-secondary); }
      .dshga-spinner { width: 13px; height: 13px; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: dshga-spin .8s linear infinite; }
      @keyframes dshga-spin { to { transform: rotate(360deg); } }
    `;

    /**
     * POST a JSON request to one of the host endpoints.
     * @param route - endpoint key from ROUTES.
     * @param body - JSON body.
     * @returns the decoded envelope, with `ok` telling whether it succeeded.
     */
    async function call(route, body) {
      try {
        const response = await fetch(route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        const data = await response.json().catch(() => null);
        if (data === null) return { ok: false, error: 'bad-response', message: `HTTP ${response.status}` };
        return data;
      } catch (error) {
        return { ok: false, error: 'network', message: String(error?.message ?? error) };
      }
    }

    function createSection(ctx) {
      const translate = () => ctx.locale.bind(NS);

      /**
       * The GitHub settings page.
       * @returns the rendered section.
       */
      return function GitHubSection() {
        const [localeRevision, setLocaleRevision] = useState(0);
        useEffect(() => ctx.locale.subscribe(() => setLocaleRevision((value) => value + 1)), []);
        void localeRevision;
        const t = translate();

        const [status, setStatus] = useState(null);
        const [flow, setFlow] = useState(null);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState(null);
        const [draft, setDraft] = useState('');
        const [copied, setCopied] = useState(false);
        const [now, setNow] = useState(() => Date.now());
        const alive = useRef(true);

        useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        const describe = useCallback(
          (code, message) => {
            const key = {
              'client-id-missing': 'errClientIdMissing',
              'client-id-rejected': 'errClientIdRejected',
              'device-flow-disabled': 'errDeviceFlowDisabled',
              expired: 'errExpired',
              denied: 'errDenied',
              network: 'errNetwork',
            }[code];
            if (key !== undefined) return t(key);
            return t('errGeneric', { error: code ?? message ?? 'unknown' });
          },
          [t],
        );

        const refresh = useCallback(async () => {
          const data = await call(ROUTES.status);
          if (!alive.current) return null;
          if (data.ok) {
            setStatus(data);
            if (data.flow?.status === 'pending') {
              setFlow(data.flow);
            } else {
              setFlow(null);
              if (data.flow?.status === 'expired' || data.flow?.status === 'denied') setError(describe(data.flow.status));
              else if (data.flow?.status === 'error') setError(describe(data.flow.error, data.flow.message));
              else if (data.connected) setError(null);
            }
            if (typeof data.clientIdHint === 'string' && data.clientIdSource === 'settings') setDraft('');
          } else {
            setError(describe(data.error, data.message));
          }
          return data;
        }, [describe]);

        useEffect(() => {
          void refresh();
        }, [refresh]);

        useEffect(() => {
          if (flow === null) return undefined;
          const tick = setInterval(() => setNow(Date.now()), 1000);
          return () => clearInterval(tick);
        }, [flow]);

        useEffect(() => {
          if (flow === null) return undefined;
          const timer = setInterval(() => { void refresh(); }, 3000);
          return () => clearInterval(timer);
        }, [flow !== null, refresh]);

        const start = useCallback(async () => {
          setBusy(true);
          setError(null);
          const data = await call(ROUTES.start);
          if (!alive.current) return;
          setBusy(false);
          if (!data.ok) {
            setError(describe(data.error, data.message));
            return;
          }
          setFlow(data.flow);
        }, [describe]);

        const cancelFlow = useCallback(async () => {
          const data = await call(ROUTES.cancelFlow);
          if (!alive.current) return;
          if (!data.ok) setError(describe(data.error, data.message));
          else { setFlow(null); setError(null); }
        }, [describe]);

        const disconnect = useCallback(async () => {
          setBusy(true);
          const data = await call(ROUTES.disconnect);
          if (!alive.current) return;
          setBusy(false);
          if (!data.ok) {
            setError(describe(data.error, data.message));
            return;
          }
          setError(null);
          await refresh();
        }, [describe, refresh]);

        const saveClientId = useCallback(async () => {
          setBusy(true);
          setError(null);
          const data = await call(ROUTES.clientId, { clientId: draft });
          if (!alive.current) return;
          setBusy(false);
          if (!data.ok) {
            setError(describe(data.error, data.message));
            return;
          }
          if (typeof data.connected === 'boolean') setStatus(data);
          setDraft('');
          await refresh();
        }, [describe, draft, refresh]);

        const copyCode = useCallback(async () => {
          if (flow === null) return;
          try {
            await navigator.clipboard.writeText(flow.userCode);
            setCopied(true);
            setTimeout(() => {
              if (alive.current) setCopied(false);
            }, 1600);
          } catch {
            setCopied(false);
          }
        }, [flow]);

        const body = [];
        body.push(h('div', { key: 'title', className: 'dshga-title' }, t('title')));
        body.push(h('div', { key: 'desc', className: 'dshga-desc' }, t('description')));

        if (error !== null) {
          body.push(
            h(
              'div',
              { key: 'error', className: 'dshga-error', role: 'alert' },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('errorTitle')),
              h('div', null, error),
            ),
          );
        }

        if (status === null) {
          body.push(h('div', { key: 'loading', className: 'dshga-meta' }, t('loading')));
        } else if (flow !== null) {
          const remaining = Math.max(0, Math.ceil((flow.expiresAt - now) / 1000));
          body.push(
            h(
              'div',
              { key: 'flow', className: 'dshga-card' },
              h('div', { className: 'dshga-title' }, t('waitingTitle')),
              h('div', { className: 'dshga-desc' }, t('waitingBody')),
              h('div', { className: 'dshga-code' }, flow.userCode),
              h(
                'div',
                { className: 'dshga-row' },
                h(
                  'a',
                  { className: 'dshga-btn dshga-link', href: flow.verificationUri, target: '_blank', rel: 'noreferrer noopener' },
                  t('openDevice'),
                ),
                h('button', { className: 'dshga-btn', onClick: copyCode, type: 'button' }, copied ? t('copied') : t('copyCode')),
                h('button', { className: 'dshga-btn', onClick: cancelFlow, type: 'button' }, t('cancel')),
              ),
              h(
                'div',
                { className: 'dshga-row' },
                h('span', { className: 'dshga-spinner', 'aria-hidden': 'true' }),
                h('span', { className: 'dshga-meta' }, t('expires', { minutes: Math.max(1, Math.ceil(remaining / 60)) })),
              ),
            ),
          );
        } else if (status.connected) {
          body.push(
            h(
              'div',
              { key: 'connected', className: 'dshga-card' },
              h(
                'div',
                { className: 'dshga-row' },
                status.avatarUrl ? h('img', { className: 'dshga-avatar', src: status.avatarUrl, alt: '' }) : null,
                h('span', { className: 'dshga-ok' }, '●'),
                h('span', { className: 'dshga-login' }, status.login ?? ''),
                h('span', { className: 'dshga-meta' }, t('connectedAs')),
              ),
              h(
                'div',
                { className: 'dshga-meta' },
                `${t('scopes')}: ${Array.isArray(status.scopes) && status.scopes.length > 0 ? status.scopes.join(', ') : t('scopesNone')}`,
              ),
              h(
                'div',
                { className: 'dshga-row' },
                h('button', { className: 'dshga-btn', onClick: disconnect, disabled: busy, type: 'button' }, t('disconnect')),
              ),
            ),
          );
        } else if (!status.configured) {
          body.push(
            h(
              'div',
              { key: 'unconfigured', className: 'dshga-card' },
              h('div', { className: 'dshga-title' }, t('unconfiguredTitle')),
              h('div', { className: 'dshga-desc' }, t('unconfiguredBody')),
              h(
                'div',
                { className: 'dshga-row' },
                h('span', { className: 'dshga-meta' }, t('clientIdLabel')),
                h('input', {
                  className: 'dshga-input',
                  value: draft,
                  placeholder: t('clientIdPlaceholder'),
                  spellCheck: false,
                  onChange: (event) => setDraft(event.target.value),
                }),
                h('button', { className: 'dshga-btn dshga-btn-primary', onClick: saveClientId, disabled: busy || draft.trim() === '', type: 'button' }, busy ? t('saving') : t('save')),
              ),
            ),
          );
        } else {
          body.push(
            h(
              'div',
              { key: 'ready', className: 'dshga-card' },
              h('div', { className: 'dshga-meta' }, t(status.clientIdSource === 'settings' ? 'settingsHint' : 'builtinHint')),
              h(
                'div',
                { className: 'dshga-row' },
                h('button', { className: 'dshga-btn dshga-btn-primary', onClick: start, disabled: busy, type: 'button' }, t('connect')),
              ),
            ),
          );
        }

        if (status !== null && !status.connected) {
          body.push(
            h(
              'div',
              { key: 'override', className: 'dshga-row' },
              h('input', {
                className: 'dshga-input',
                value: draft,
                placeholder: t('clientIdPlaceholder'),
                spellCheck: false,
                onChange: (event) => setDraft(event.target.value),
              }),
              h('button', { className: 'dshga-btn', onClick: saveClientId, disabled: busy || draft.trim() === '', type: 'button' }, busy ? t('saving') : t('save')),
            ),
          );
          body.push(h('div', { key: 'overrideHint', className: 'dshga-note' }, t('overrideHint')));
        }

        if (status !== null && typeof status.statePath === 'string') {
          body.push(
            h(
              'div',
              { key: 'privacy', className: 'dshga-note' },
              t('privacy'),
              h('div', { className: 'dshga-path' }, `${t('tokenStoredAt')}: ${status.statePath}`),
            ),
          );
        }

        return h('div', { className: 'dshga-root' }, h('style', null, STYLE), body);
      };
    }

    /**
     * Register the locale dictionaries and the settings section.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const GitHubSection = createSection(ctx);
      ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }));
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'github-auth',
            order: 12,
            label: () => ctx.locale.bind(NS)('nav'),
          },
          GitHubSection,
        ),
      );
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
