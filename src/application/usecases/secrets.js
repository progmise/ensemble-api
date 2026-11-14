// Use case: application secrets registry (the Seguridad view).
//
// One secret = one applicativo (env-var style NAME) holding a JSON map of
// `{CLAVE: valor}` entries, stored under `<NAME>__<ENV>` — the dashboard
// Seguridad view is the only write path. Secrets components' deploy
// workflows resolve each entry to a `sensitive` env var on the target
// Vercel project.
//
// Role gate — roles live in application_members (per-app). To write the
// secrets of app X a member needs a role IN app X; when the secret name
// doesn't match an application, the member's roles across all their apps
// decide:
//   developer                        → cert, pre
//   technical-lead | product-owner   → cert, pre, pro
// No member row (bootstrap ALLOWED_USERS) → all environments.
const ENVIRONMENTS = ['cert', 'pre', 'pro'];
const PRO_ROLES = new Set(['technical-lead', 'product-owner']);

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

const envsForRoles = (roles = []) =>
  roles.some((r) => PRO_ROLES.has(r)) ? ENVIRONMENTS : ['cert', 'pre'];

// UI hint — the env list the member can reach via any of their app roles.
export const allowedEnvironments = ({ applications }) =>
  async (member) => {
    if (!member) return ENVIRONMENTS;             // bootstrap allowlist user
    const rows = await applications.memberRoles(member.github_username);
    return envsForRoles(rows.map((r) => r.role));
  };

export const listSecrets = ({ store }) =>
  async ({ environment }) => {
    const env = String(environment || '').toLowerCase();
    if (!ENVIRONMENTS.includes(env))
      return { status: 400, error: `environment must be one of ${ENVIRONMENTS.join('/')}` };
    // Names + entry keys only — values are write-only, never returned.
    return { status: 200, environment: env, secrets: await store.secrets(env) };
  };

// entries: {CLAVE: valor} — merged into the existing entry map server-side,
// so rotating one key never wipes the others (values are write-only).
export const upsertSecret = ({ store, applications }) =>
  async ({ name, environment, entries, member, actor }) => {
    const env = String(environment || '').toLowerCase();
    if (!ENVIRONMENTS.includes(env))
      return { status: 400, error: `environment must be one of ${ENVIRONMENTS.join('/')}` };
    const n = String(name || '').trim().toUpperCase();
    if (!NAME_RE.test(n))
      return { status: 400, error: 'name must be env-var style (e.g. LOANS_API)' };

    if (member) {
      const rows = await applications.memberRoles(member.github_username);
      // The secret name IS the applicativo — if it maps to a registered app,
      // the member must hold a role in THAT app; otherwise their roles
      // across all apps decide (platform-level secrets).
      const app = await applications.get(n.toLowerCase().replace(/_/g, '-'))
        .catch(() => null);
      const roles = rows.filter((r) => !app || r.application === app.name)
        .map((r) => r.role);
      const envs = app && !roles.length ? [] : envsForRoles(roles);
      if (!envs.includes(env))
        return { status: 403, error: `role does not allow writing '${env}' secrets` };
    }

    const merged = {};
    for (const [k, v] of Object.entries(entries || {})) {
      const key = String(k).trim().toUpperCase();
      if (!NAME_RE.test(key))
        return { status: 400, error: `entry key must be env-var style (e.g. DB_PASSWORD): ${k}` };
      if (!String(v || ''))
        return { status: 400, error: `value is required for ${key}` };
      merged[key] = String(v);
    }
    if (!Object.keys(merged).length)
      return { status: 400, error: 'at least one clave/valor entry is required' };
    let existing = {};
    try { existing = JSON.parse(await store.secretValue(`${n}__${env.toUpperCase()}`) || '{}'); }
    catch { /* unparseable legacy value — overwritten */ }
    const all = { ...existing, ...merged };
    await store.putSecret(`${n}__${env.toUpperCase()}`, JSON.stringify(all), { actor });
    // Never echo values back — return the audit shape only.
    return { status: 200, secret: { name: n, environment: env, keys: Object.keys(all) } };
  };
