// Output adapter: the platform credential store — master copies of the
// values propagated into each generated repo:
//   platform_vars    — plain key/value (VERCEL_ORG_ID, DOCKER_USERNAME…)
//   platform_secrets — view over vault.decrypted_secrets (VERCEL_TOKEN…)
// Values are read per provisioning run; process.env acts as a local
// fallback for entries missing in the store.
// Implements the CredentialStore port (application/ports/output).
export const platformConfigStore = ({ client }) => ({
  async all() {
    const [vars, secrets] = await Promise.all([
      client.rest('platform_vars?select=key,value'),
      client.rest('platform_secrets?select=name,value'),
    ]);
    const cfg = Object.fromEntries(secrets.map((s) => [s.name, s.value]));
    for (const v of vars) cfg[v.key] = v.value;
    return cfg;
  },

  // Key names only — used to validate template provisioning specs without
  // ever exposing values.
  async keys() {
    const [vars, secrets] = await Promise.all([
      client.rest('platform_vars?select=key'),
      client.rest('platform_secrets?select=name'),
    ]);
    return { vars: vars.map((v) => v.key), secrets: secrets.map((s) => s.name) };
  },

  // Application secrets (Seguridad view) — vault keys are `<NAME>__<ENV>`
  // (env uppercased); each value is a JSON map of `{CLAVE: valor}` entries.
  // Entry keys are listed (values never leave), writes go through the
  // put_platform_secret RPC; every write appends a secret_events audit row.
  async secrets(env) {
    const suffix = `__${String(env).toUpperCase()}`;
    const rows = await client.rest(
      `platform_secrets?select=name,value&name=like.*${suffix}`);
    return rows.map((r) => {
      let keys = [];
      try { keys = Object.keys(JSON.parse(r.value)); } catch { /* opaque */ }
      return { name: r.name.slice(0, -suffix.length), keys };
    });
  },

  // Server-side only — used to merge new entries into an existing secret
  // before rewriting (values never reach the frontend).
  async secretValue(name) {
    const rows = await client.rest(
      `platform_secrets?select=value&name=eq.${encodeURIComponent(name)}`);
    return rows[0]?.value ?? null;
  },

  async putSecret(name, value, { actor }) {
    await client.rest('rpc/put_platform_secret', {
      method: 'POST', body: { p_name: name, p_value: value },
    });
    const env = name.match(/__([A-Z]+)$/)?.[1]?.toLowerCase() || '';
    await client.rest('secret_events', {
      method: 'POST',
      body: { actor, name, environment: env, action: 'upsert' },
    });
  },
});
