// Use cases: release registry. A dashboard release (RLSE<number>) wraps a
// deploy-manifest GitHub Release: `version` links them (tag v<version>).
// Publish and per-env deploys go through repoHost with the admin token —
// the frontend never touches GitHub directly for these actions.

import { stageRank } from '../../domain/component.js';
import { readManifestFile } from './appModel.js';

// A release remembers which app-model repo it wraps (manifest_repo on
// the row); legacy rows fall back to the env-configured repo.
const repoOf = (row, fallback) => row?.manifest_repo || fallback;

const SEMVER = /^\d+\.\d+\.\d+$/;
export const releaseNo = (n) => `RLSE${String(n).padStart(7, '0')}`;

// Manifest YAML is strict-generated; env names sit at `  - name: X` inside
// the environments: section (components use the same indent but appear
// after `components:`).
const envNamesOf = (yamlText) => {
  const section = yamlText.split(/^components:/m)[0] || '';
  return [...section.matchAll(/^  - name:\s*(\S+)/gm)].map((m) => m[1]);
};

const manifestRelease = async (repoHost, manifestRepo, version) => {
  const releases = await repoHost.api(
    `/repos/${manifestRepo}/releases?per_page=30`);
  return releases.find((r) => r.tag_name === `v${version}`) || null;
};

const manifestEnvs = async (repoHost, manifestRepo, version) => {
  const m = await readManifestFile(repoHost, manifestRepo, `v${version}`);
  return m ? envNamesOf(m.text) : [];
};

const manifestComponents = async (repoHost, manifestRepo, version) => {
  const m = await readManifestFile(repoHost, manifestRepo, `v${version}`);
  return m ? componentNamesOf(m.text) : null;
};

const decorate = (row, ghRelease) => ({
  ...row,
  release_no: releaseNo(row.number),
  published: ghRelease ? !ghRelease.draft : false,
  gh_release_url: ghRelease?.html_url || null,
});

// Options for the "Nueva release" form: every deploy-manifest GitHub
// Release (drafts first, then published)
// plus the deployment trails derivable from the manifest's environments.
export const releaseOptions = ({ repoHost, manifestRepo, catalog }) =>
  async (application) => {
    const repo = (application && await catalog.appModelRepo(application))
      || manifestRepo;
    const [ghReleases, file] = await Promise.all([
      repoHost.api(`/repos/${repo}/releases?per_page=50`)
        .catch(() => []),
      readManifestFile(repoHost, repo, 'main')
        .catch(() => null),
    ]);
    const versions = ghReleases
      .filter((r) => SEMVER.test(r.tag_name.replace(/^v/, '')))
      .sort((a, b) => Number(b.draft) - Number(a.draft)
        || b.tag_name.localeCompare(a.tag_name, undefined, { numeric: true }))
      .map((r) => ({
        version: r.tag_name.replace(/^v/, ''), draft: r.draft,
        name: r.name || r.tag_name,
      }));
    const envs = file ? envNamesOf(file.text) : [];
    return {
      versions,
      trails: envs.length
        ? [{ name: `${envs.join('-')}-trails`, environments: envs }]
        : [],
    };
  };

export const listReleases = ({ releases, repoHost, manifestRepo }) =>
  async () => {
    const rows = await releases.list();
    const repos = [...new Set(rows.map((r) => repoOf(r, manifestRepo)))];
    const ghLists = await Promise.all(repos.map((repo) =>
      repoHost.api(`/repos/${repo}/releases?per_page=30`)
        .catch(() => [])));
    const byRepoTag = Object.fromEntries(ghLists.map((list, i) =>
      [repos[i], Object.fromEntries(list.map((r) => [r.tag_name, r]))]));
    // Backfill the manifest component list on rows predating the column —
    // one fetch each, best-effort (same lazy pattern as lifecycle advance).
    await Promise.all(rows.filter((r) => r.components == null)
      .map(async (r) => {
        const components = await manifestComponents(
          repoHost, repoOf(r, manifestRepo), r.version);
        if (components) {
          r.components = components;
          await releases.update(r.number, { components }).catch(() => {});
        }
      }));
    return rows.map((r) =>
      decorate(r, byRepoTag[repoOf(r, manifestRepo)]?.[`v${r.version}`]));
  };

const REASONS = ['New Application', 'New Version/Evolutive', 'Incident', 'Problem'];
const PRIORITIES = ['1 - Critical', '2 - High', '3 - Moderate', '4 - Low', '5 - Planning'];
const RISKS = ['Extreme', 'High', 'Medium', 'Low', 'Minimal'];
const IMPACTS = ['1 - High', '2 - Medium', '3 - Low'];
const PLATFORMS = ['Vercel', 'Render'];
const YES_NO = ['Yes', 'No'];
const RECOVERY_PLANS = [
  'N/A - First version of the product/service, there is no previous version to go back to, if it has an impact on the environment we will correct it and generate a new version',
  'N/A - Service unavailable to the user, in case of failure it will have no impact on the environment',
  'Return to previous version',
];

export const createRelease = ({ releases, repoHost, manifestRepo, catalog }) =>
  async ({ version, description, planned_date, trail, deploy_start,
    deploy_end, reason, product_owner, requested_by, priority, risk,
    details, impact, platform, justification, deploy_plan, risk_analysis,
    test_plan, recovery_plan, unavailability, on_site_followup, db_change,
    infra_change, application, createdBy }) => {
    const v = String(version || '').trim();
    if (!SEMVER.test(v)) return { status: 400, error: 'version must be semver (x.y.z)' };
    if (!String(description || '').trim())
      return { status: 400, error: 'description required' };
    if (reason && !REASONS.includes(reason))
      return { status: 400, error: `reason must be one of ${REASONS.join('/')}` };
    if (priority && !PRIORITIES.includes(priority))
      return { status: 400, error: `priority must be one of ${PRIORITIES.join('/')}` };
    if (risk && !RISKS.includes(risk))
      return { status: 400, error: `risk must be one of ${RISKS.join('/')}` };
    if (impact && !IMPACTS.includes(impact))
      return { status: 400, error: `impact must be one of ${IMPACTS.join('/')}` };
    if (platform && !PLATFORMS.includes(platform))
      return { status: 400, error: `platform must be one of ${PLATFORMS.join('/')}` };
    if (recovery_plan && !RECOVERY_PLANS.includes(recovery_plan))
      return { status: 400, error: 'recovery_plan must be a known option' };
    for (const [k, v] of Object.entries({ unavailability, on_site_followup, db_change, infra_change }))
      if (v && !YES_NO.includes(v))
        return { status: 400, error: `${k} must be Yes or No` };
    if (planned_date && Number.isNaN(Date.parse(planned_date)))
      return { status: 400, error: 'planned_date must be a date (YYYY-MM-DD)' };
    for (const [key, ts] of [['deploy_start', deploy_start], ['deploy_end', deploy_end]])
      if (ts && Number.isNaN(Date.parse(ts)))
        return { status: 400, error: `${key} must be a datetime` };
    if (deploy_start && deploy_end && Date.parse(deploy_end) <= Date.parse(deploy_start))
      return { status: 400, error: 'deploy_end must be after deploy_start' };
    const app = String(application || '').trim().toLowerCase() || null;
    const repo = (app && await catalog.appModelRepo(app)) || manifestRepo;
    const components = await manifestComponents(repoHost, repo, v);
    const release = await releases.create({
      version: v, description: description.trim(), components,
      application: app, manifest_repo: repo,
      planned_date: planned_date || null, created_by: createdBy || null,
      trail: trail || null,
      deploy_start: deploy_start || null, deploy_end: deploy_end || null,
      reason: reason || null, product_owner: product_owner || null,
      requested_by: requested_by || null, priority: priority || null,
      risk: risk || null, details: details || null,
      impact: impact || null, platform: platform || null,
      justification: justification || null,
      deploy_plan: deploy_plan || null, risk_analysis: risk_analysis || null,
      test_plan: test_plan || null, recovery_plan: recovery_plan || null,
      unavailability: unavailability || null,
      on_site_followup: on_site_followup || null,
      db_change: db_change || null, infra_change: infra_change || null,
    });
    return { status: 201, release };
  };

// Flattened per-environment deployments for the Despliegues view — the
// dashboard joins them to GitHub runs by run_id.
export const listDeployments = ({ releases }) =>
  async () =>
    (await releases.allDeployments()).map((d) => ({
      run_id: d.run_id,
      release_no: d.release ? releaseNo(d.release.number) : null,
      version: d.release?.version ?? null,
      environment: d.environment,
      status: d.status,
      run_url: d.run_url,
    }));

// Non-final statuses get re-polled against the run on every detail read.
const FINAL = new Set(['success', 'failure', 'cancelled']);

// Environment → component lifecycle stage. Forward-only ranking (domain
// LIFECYCLE_RANK); terminal stages stay manual. `test` envs don't map yet.
const STAGE_OF_ENV = {
  cert: 'Certification/Homologation',
  pre: 'Preproduction',
  pro: 'Production',
};

const componentNamesOf = (yamlText) => {
  const section = yamlText.split(/^components:/m)[1] || '';
  return [...section.matchAll(/^  - name:\s*(\S+)/gm)].map((m) => m[1]);
};

// A successful env deploy advances the lifecycle of every component in
// that release's manifest — best-effort, never blocks the read.
const advanceComponentLifecycles = async (
  { catalog, repoHost, manifestRepo }, version, environment) => {
  const stage = STAGE_OF_ENV[environment];
  if (!stage || !catalog) return;
  try {
    const m = await readManifestFile(repoHost, manifestRepo, `v${version}`);
    if (!m) return;
    const names = componentNamesOf(m.text);
    for (const n of names) {
      const c = await catalog.get(n).catch(() => null);
      if (c && stageRank(c.lifecycle) < stageRank(stage))
        await catalog.update(n, { lifecycle: stage });
    }
  } catch { /* lifecycle advance is advisory */ }
};

const refreshDeployments = async (
  { releases, repoHost, manifestRepo, catalog }, version, deps) =>
  Promise.all(deps.map(async (d) => {
    if (!d.run_id || FINAL.has(d.status)) return d;
    try {
      const run = await repoHost.api(
        `/repos/${manifestRepo}/actions/runs/${d.run_id}`);
      const status = run.status === 'completed'
        ? (run.conclusion || 'failure') : (run.status || d.status);
      if (status === d.status && run.html_url === d.run_url) return d;
      const dep = await releases.upsertDeployment({
        release_id: d.release_id, environment: d.environment, status,
        run_id: d.run_id, run_url: run.html_url,
      });
      if (status === 'success')
        advanceComponentLifecycles(
          { catalog, repoHost, manifestRepo }, version, d.environment);
      return dep;
    } catch { return d; }
  }));

export const getRelease = ({ releases, repoHost, manifestRepo, catalog }) =>
  async (number) => {
    const row = await releases.get(number);
    if (!row) return { status: 404, error: 'release not found' };
    const repo = repoOf(row, manifestRepo);
    const [gh, environments, deps] = await Promise.all([
      manifestRelease(repoHost, repo, row.version).catch(() => null),
      manifestEnvs(repoHost, repo, row.version).catch(() => []),
      releases.deployments(row.number),
    ]);
    const deployments = await refreshDeployments(
      { releases, repoHost, manifestRepo: repo, catalog }, row.version, deps);
    return {
      status: 200,
      release: { ...decorate(row, gh), environments, deployments },
    };
  };

export const publishRelease = ({ releases, repoHost, manifestRepo }) =>
  async (number) => {
    const row = await releases.get(number);
    if (!row) return { status: 404, error: 'release not found' };
    const repo = repoOf(row, manifestRepo);
    const gh = await manifestRelease(repoHost, repo, row.version);
    if (!gh)
      return { status: 409, error: `no GitHub release v${row.version} on ${repo}` };
    if (!gh.draft) return { status: 200, release: decorate(row, gh) };
    const updated = await repoHost.api(
      `/repos/${repo}/releases/${gh.id}`,
      { method: 'PATCH', body: { draft: false } });
    return { status: 200, release: decorate(row, updated) };
  };

// Dispatch the manifest's deploy.yml for one environment. `release_no` is
// what unlocks `pro` in orch-deploy — production deploys only exist when
// the dashboard mints them.
export const deployRelease = ({ releases, repoHost, manifestRepo }) =>
  async (number, environment, _actor) => {
    const row = await releases.get(number);
    if (!row) return { status: 404, error: 'release not found' };
    const env = String(environment || '').trim();
    if (!env) return { status: 400, error: 'environment required' };
    const repo = repoOf(row, manifestRepo);
    const gh = await manifestRelease(repoHost, repo, row.version);
    if (!gh || gh.draft)
      return { status: 409, error: `release v${row.version} is not published` };
    // Deployment window — outside it no environment can be deployed,
    // whatever state the release is in.
    if (row.deploy_start && Date.now() < Date.parse(row.deploy_start))
      return { status: 409, error: `deployment window opens at ${row.deploy_start}` };
    if (row.deploy_end && Date.now() > Date.parse(row.deploy_end))
      return { status: 409, error: `deployment window closed at ${row.deploy_end}` };

    await repoHost.api(
      `/repos/${repo}/actions/workflows/deploy.yml/dispatches`,
      {
        method: 'POST',
        body: {
          ref: 'main',
          inputs: {
            version: row.version, environment: env,
            release_no: releaseNo(row.number),
          },
        },
      });

    // The dispatched run takes a moment to appear — record it best-effort;
    // the row still tracks the request even if the run lookup misses.
    const since = new Date().toISOString();
    let run = null;
    try {
      const data = await repoHost.api(
        `/repos/${repo}/actions/workflows/deploy.yml/runs` +
        `?event=workflow_dispatch&per_page=5`);
      run = (data.workflow_runs || [])
        .find((r) => r.created_at >= since.slice(0, 16)) || data.workflow_runs?.[0];
    } catch { /* recorded without run link */ }
    const dep = await releases.upsertDeployment({
      release_id: row.number, environment: env,
      status: 'dispatched', run_id: run?.id ?? null,
      run_url: run?.html_url ?? null,
    });
    return { status: 202, deployment: dep };
  };
