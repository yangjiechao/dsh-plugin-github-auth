/**
 * Host half of the GitHub device-flow auth bundle.
 *
 * The browser cannot keep a GitHub token safe, and a plugin has no hosted
 * backend to borrow one from, so the token lives where every other local
 * credential of this harness lives: on this machine, in the DSH state
 * directory, in a file only the current user can read. Everything else is
 * plumbing around two GitHub endpoints:
 *
 *   POST /login/device/code             → a short user code the human types once
 *   POST /login/oauth/access_token      → the token, after they authorize
 *
 * Device flow needs only a public `client_id`: no client secret, no redirect
 * URI, no loopback listener. That is what makes a bundle like this shareable —
 * the author registers one OAuth App, bakes its client id into
 * `DEFAULT_CLIENT_ID` below, and every user only clicks "Authorize".
 *
 * The stored token is used by the `github_api` tool, so the agent can act on
 * the account the settings page connected.
 */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const inject = ['webServer'];

/**
 * Client id of the OAuth App this bundle authorizes against.
 *
 * Distributors fill this in once (see README): register an OAuth App, enable
 * nothing else, paste the client id here. Users then connect with one click,
 * and a user who wants their own app overrides it from the settings page.
 * An OAuth App, not a GitHub App: device flow is a public-client flow, and app
 * user tokens expire after 8 hours, which no unattended tool wants to babysit.
 */
const DEFAULT_CLIENT_ID = 'Ov23liuagr85t5q8MmCN';

/** Scopes requested at authorize time: create repos, push contents, read the viewer. */
const SCOPES = 'repo read:user';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 8 * 1024;
const STATE_FILE = 'github-auth.json';

const PATHS = {
  status: '/dsh-github-auth/status',
  start: '/dsh-github-auth/device/start',
  poll: '/dsh-github-auth/device/poll',
  cancel: '/dsh-github-auth/device/cancel',
  disconnect: '/dsh-github-auth/disconnect',
  clientId: '/dsh-github-auth/client-id',
};

/** A failure the client is allowed to see, carried as a stable machine code. */
class RequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * Resolve the state directory for this installation.
 *
 * A profile-launched harness exports `DSH_PROFILE_DIR`; a bare `dsh` keeps its
 * data under the harness home. Both arrangements already hold state there, so
 * the token sits beside the rest of it instead of inventing a new location.
 * @returns the absolute directory holding `github-auth.json`.
 */
function stateDirectory() {
  const profile = process.env.DSH_PROFILE_DIR;
  if (typeof profile === 'string' && profile.trim() !== '') return path.join(profile, 'state');
  const home = process.env.DSH_HOME;
  const root = typeof home === 'string' && home.trim() !== '' ? home : path.join(homedir(), '.dsh');
  return path.join(root, 'state');
}

function stateFilePath() {
  return path.join(stateDirectory(), STATE_FILE);
}

/**
 * Read the stored state, treating absence or damage as "nothing stored yet".
 * @returns the parsed state object, never null.
 */
async function readState() {
  try {
    const parsed = JSON.parse(await readFile(stateFilePath(), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Replace the stored state atomically and keep it private.
 * @param state - the whole new state object.
 */
async function writeState(state, permitted = () => true) {
  const file = stateFilePath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  if (!permitted()) {
    await unlink(temporary).catch(() => {});
    return false;
  }
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => {});
  return true;
}

/**
 * Merge a patch into the stored state.
 * @param patch - fields to overwrite; `undefined` values delete the field.
 * @returns the new state.
 */
let stateWrites = Promise.resolve();

async function patchState(patch, permitted = () => true) {
  const operation = stateWrites.then(async () => {
    if (!permitted()) return null;
    const state = await readState();
    if (!permitted()) return null;
    const previous = { ...state };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete state[key];
      else state[key] = value;
    }
    if (!(await writeState(state, permitted))) return null;
    if (!permitted()) {
      await writeState(previous);
      return null;
    }
    return state;
  });
  stateWrites = operation.catch(() => {});
  return operation;
}

/**
 * The client id to authorize with, and where it came from.
 * @param state - the stored state.
 * @returns the id, its source, and whether it can be used.
 */
function resolveClientId(state) {
  if (typeof state.clientId === 'string' && state.clientId.trim() !== '') {
    return { clientId: state.clientId.trim(), source: 'settings' };
  }
  if (DEFAULT_CLIENT_ID.trim() !== '') return { clientId: DEFAULT_CLIENT_ID.trim(), source: 'builtin' };
  return { clientId: '', source: 'none' };
}

/**
 * One GitHub JSON call with a hard timeout and tolerant parsing.
 * @param url - absolute endpoint.
 * @param init - fetch options; a signal is always supplied by this helper.
 * @returns the status code and the decoded body.
 */
async function githubJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let data = null;
  try {
    data = text === '' ? null : JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 2_000) };
  }
  return { status: response.status, ok: response.ok, data };
}

/**
 * Ask GitHub for a device code.
 * @param clientId - the public client id.
 * @returns the code pair, the URL to show, and the polling cadence.
 */
async function startDeviceFlow(clientId) {
  const body = new URLSearchParams({ client_id: clientId, scope: SCOPES });
  const { status, data } = await githubJson(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (status === 404) {
    throw new RequestError(
      'client-id-rejected',
      'GitHub does not recognize this client id. Register an OAuth App and paste its client id.',
      400,
    );
  }
  if (typeof data?.device_code !== 'string' || typeof data?.user_code !== 'string') {
    throw new RequestError('device-start-failed', `GitHub refused to start the device flow (HTTP ${status}).`, 502);
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri ?? 'https://github.com/login/device',
    expiresIn: Number(data.expires_in) || 900,
    interval: Number(data.interval) || 5,
  };
}

/**
 * Read the authorized account for a token.
 * @param token - a user access token.
 * @returns the viewer's login and avatar URL, or null when the token is dead.
 */
async function fetchViewer(token) {
  const { status, data } = await githubJson(`${API_BASE}/user`, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'dsh-github-auth' },
  });
  if (status !== 200 || typeof data?.login !== 'string') return null;
  return { login: data.login, avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : undefined };
}

/**
 * Exchange a device code for a token, exactly once.
 * @param clientId - the public client id that opened the flow.
 * @param deviceCode - the code from @see startDeviceFlow.
 * @returns the next state of the flow, and the account on success.
 */
async function pollDeviceFlow(clientId, deviceCode) {
  const body = new URLSearchParams({
    client_id: clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const { status, data } = await githubJson(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const error = typeof data?.error === 'string' ? data.error : null;
  if (error === 'authorization_pending') return { status: 'pending' };
  if (error === 'slow_down') return { status: 'slow-down' };
  if (error === 'expired_token') return { status: 'expired' };
  if (error === 'access_denied') return { status: 'denied' };
  if (error === 'device_flow_disabled') {
    throw new RequestError('device-flow-disabled', 'The OAuth App has device flow disabled. Enable it in its settings.', 400);
  }
  if (error !== null) {
    throw new RequestError('device-exchange-failed', `GitHub rejected the device code: ${error}.`, 502);
  }
  if (typeof data?.access_token !== 'string' || data.access_token.trim() === '') {
    throw new RequestError('device-exchange-failed', `GitHub returned no access token (HTTP ${status}).`, 502);
  }
  const token = data.access_token;
  const viewer = await fetchViewer(token);
  if (viewer === null) throw new RequestError('token-unusable', 'GitHub accepted the token but /user refused it.', 502);
  return {
    status: 'authorized',
    credential: {
      token,
      tokenType: typeof data.token_type === 'string' ? data.token_type : 'bearer',
      scopes: typeof data.scope === 'string' ? data.scope.split(',').map((scope) => scope.trim()).filter(Boolean) : [],
      login: viewer.login,
      avatarUrl: viewer.avatarUrl,
      connectedAt: Date.now(),
    },
  };
}

/* Device codes stay in memory on the host; only the user code is public.
 * Timers do not depend on a settings page remaining mounted. */
function createFlowManager() {
  let generation = 0;
  let current = null;
  let timer = null;
  let disposed = false;

  const isCurrent = (flow) => !disposed && current === flow && flow.generation === generation;
  const publicFlow = () => {
    if (current === null) return null;
    const { status, userCode, verificationUri, expiresAt, error } = current;
    return { status, userCode, verificationUri, expiresAt, ...(error ? { error } : {}) };
  };
  const invalidate = () => {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    current = null;
  };
  const schedule = (flow) => {
    if (!isCurrent(flow)) return;
    const remaining = flow.expiresAt - Date.now();
    if (remaining <= 0) {
      flow.status = 'expired';
      return;
    }
    timer = setTimeout(() => { timer = null; void poll(flow); }, Math.min(flow.intervalMs, remaining));
    timer.unref?.();
  };
  const poll = async (flow) => {
    if (!isCurrent(flow)) return;
    if (Date.now() >= flow.expiresAt) { flow.status = 'expired'; return; }
    try {
      const result = await pollDeviceFlow(flow.clientId, flow.deviceCode);
      if (!isCurrent(flow)) return;
      if (result.status === 'authorized') {
        const stored = await patchState(result.credential, () => isCurrent(flow));
        if (stored && isCurrent(flow)) current = null;
      } else if (result.status === 'expired' || result.status === 'denied') {
        flow.status = result.status;
      } else {
        if (result.status === 'slow-down') flow.intervalMs += 5000;
        schedule(flow);
      }
    } catch (error) {
      if (!isCurrent(flow)) return;
      flow.status = 'error';
      // Never expose server exceptions, upstream responses, tokens or device codes.
      const allowed = ['device-flow-disabled', 'device-exchange-failed', 'token-unusable'];
      flow.error = error instanceof RequestError && allowed.includes(error.code) ? error.code : 'network';
    }
  };
  return {
    publicFlow,
    async start() {
      invalidate();
      const id = generation;
      // Wait for any invalidated commit to roll back before starting another.
      await stateWrites;
      const resolved = resolveClientId(await readState());
      if (resolved.clientId === '') throw new RequestError('client-id-missing', 'No OAuth App client id is configured.', 400);
      const details = await startDeviceFlow(resolved.clientId);
      if (disposed || generation !== id) throw new RequestError('flow-superseded', 'The authorization flow was cancelled or replaced.', 409);
      const flow = {
        generation: id,
        status: 'pending',
        clientId: resolved.clientId,
        deviceCode: details.deviceCode,
        userCode: details.userCode,
        verificationUri: details.verificationUri,
        expiresAt: Date.now() + Math.max(1, details.expiresIn) * 1000,
        intervalMs: Math.max(5, details.interval) * 1000,
      };
      current = flow;
      schedule(flow);
      return publicFlow();
    },
    async cancel() {
      invalidate();
      await stateWrites;
    },
    dispose() { disposed = true; invalidate(); },
  };
}

/**
 * The public status projection. Never includes the token.
 * @returns what the settings page renders.
 */
async function statusReport(flowManager) {
  const state = await readState();
  const resolved = resolveClientId(state);
  const connected = typeof state.token === 'string' && state.token !== '';
  return {
    configured: resolved.clientId !== '',
    clientIdSource: resolved.source,
    clientIdHint: resolved.clientId === '' ? '' : `${resolved.clientId.slice(0, 4)}…`,
    connected,
    login: connected && typeof state.login === 'string' ? state.login : null,
    avatarUrl: connected && typeof state.avatarUrl === 'string' ? state.avatarUrl : null,
    scopes: connected && Array.isArray(state.scopes) ? state.scopes : [],
    connectedAt: connected && typeof state.connectedAt === 'number' ? state.connectedAt : null,
    statePath: stateFilePath(),
    flow: flowManager.publicFlow(),
  };
}

/**
 * Read a bounded JSON request body.
 * @param request - the incoming request.
 * @returns the parsed body, or an empty object.
 */
async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new RequestError('body-too-large', 'Request body is too large.', 413);
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new RequestError('bad-request', 'Request body is not JSON.', 400);
  }
}

function send(response, status, payload) {
  const text = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(text);
}

/**
 * Build a POST-only, same-origin JSON endpoint.
 * @param webServer - the host web server service.
 * @param handler - body handler resolving the response payload.
 * @returns the request handler.
 */
function makeEndpoint(webServer, handler) {
  return async (request, response) => {
    try {
      if (request.method !== 'POST') {
        send(response, 405, { ok: false, error: 'method-not-allowed' });
        return;
      }
      const expected = typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : undefined;
      const origin = request.headers.origin;
      if (typeof expected === 'string' && typeof origin === 'string' && origin !== expected) {
        send(response, 403, { ok: false, error: 'cross-origin' });
        return;
      }
      const body = await readJsonBody(request);
      send(response, 200, { ok: true, ...(await handler(body)) });
    } catch (error) {
      if (error instanceof RequestError) {
        send(response, error.status, { ok: false, error: error.code, message: error.message });
        return;
      }
      send(response, 500, { ok: false, error: 'internal', message: 'The request could not be completed.' });
    }
  };
}

/**
 * Call the GitHub REST API with the stored token.
 * @param token - a user access token.
 * @param request - the tool arguments.
 * @returns the upstream status and decoded body.
 */
async function callApi(token, request) {
  const method = String(request.method ?? 'GET').toUpperCase();
  const target = String(request.path ?? '/');
  if (!target.startsWith('/')) throw new RequestError('bad-path', 'path must start with "/".', 400);
  const headers = {
    accept: typeof request.accept === 'string' && request.accept !== '' ? request.accept : 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'dsh-github-auth',
  };
  let body;
  if (request.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json';
    body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  }
  const { status, data } = await githubJson(`${API_BASE}${target}`, { method, headers, body });
  return { status, data };
}

/** Model-facing description of the GitHub proxy tool. */
const TOOL_DEFINITION = {
  name: 'github_api',
  description:
    'Call the GitHub REST API as the account connected in Settings → GitHub. Use it to inspect or change repositories, issues, releases and files (for example POST /user/repos to create a repository, or the git data endpoints to commit several files at once). Requires a connected account; when nothing is connected the call fails with github-not-connected and the user must connect in Settings → GitHub.',
  parameters: {
    type: 'object',
    properties: {
      method: {
        type: 'string',
        description: 'HTTP method: GET, POST, PATCH, PUT or DELETE. Defaults to GET.',
        enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      },
      path: {
        type: 'string',
        description: 'API path beginning with "/", for example "/user" or "/repos/{owner}/{repo}/contents/README.md".',
      },
      body: {
        type: 'object',
        description: 'JSON request body for methods that take one.',
        additionalProperties: true,
      },
      accept: {
        type: 'string',
        description: 'Optional Accept header override, such as "application/vnd.github.raw" for raw file contents.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: { status: { type: 'number' } },
    },
    render(args, value) {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return [{ type: 'text', text: text.length > 24_000 ? `${text.slice(0, 24_000)}\n…(truncated)` : text }];
    },
  },
  async execute(args) {
    const request = typeof args === 'object' && args !== null ? args : {};
    const state = await readState();
    const token = typeof state.token === 'string' ? state.token : '';
    if (token === '') throw new RequestError('github-not-connected', 'No GitHub account is connected. Connect one in Settings → GitHub.', 400);
    const result = await callApi(token, request);
    if (result.status === 401) {
      await patchState({ token: undefined, login: undefined, avatarUrl: undefined, scopes: undefined });
      throw new RequestError('github-token-rejected', 'GitHub rejected the stored token; it was cleared. Reconnect in Settings → GitHub.', 400);
    }
    if (result.status >= 400) {
      const message = typeof result.data?.message === 'string' ? result.data.message : `GitHub returned HTTP ${result.status}.`;
      return { status: result.status, data: result.data, error: message };
    }
    return { status: result.status, data: result.data };
  },
};

/**
 * Register the endpoints and the agent tool.
 * @param ctx - the host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const flowManager = createFlowManager();
    const make = (path, handler) => ctx.webServer.register({ kind: 'exact', path, handler: makeEndpoint(ctx.webServer, handler) });
    const disposers = [
      make(PATHS.status, () => statusReport(flowManager)),
      make(PATHS.start, async () => ({ flow: await flowManager.start() })),
      // Retained as a read-only compatibility endpoint; it never exchanges codes.
      make(PATHS.poll, async () => ({ flow: flowManager.publicFlow() })),
      make(PATHS.cancel, async () => {
        await flowManager.cancel();
        return { flow: null };
      }),
      make(PATHS.disconnect, async () => {
        await flowManager.cancel();
        await patchState({ token: undefined, login: undefined, avatarUrl: undefined, scopes: undefined, connectedAt: undefined });
        return { disconnected: true };
      }),
      make(PATHS.clientId, async (body) => {
        const raw = typeof body.clientId === 'string' ? body.clientId.trim() : '';
        if (raw !== '' && !/^[A-Za-z0-9._-]{6,64}$/.test(raw)) {
          throw new RequestError('bad-client-id', 'A client id looks like "Iv1.0123456789abcdef".', 400);
        }
        await flowManager.cancel();
        await patchState({ clientId: raw === '' ? undefined : raw });
        return statusReport(flowManager);
      }),
    ];
    return () => {
      flowManager.dispose();
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose();
      }
    };
  });

  ctx.effect(() => {
    const tools = ctx.get('tools');
    if (tools === undefined) return () => {};
    return tools.register(TOOL_DEFINITION);
  });
}
