// Use cases: application registry — groups related components under one
// app (front + back + libs). Alias defaults to the name's uppercase form.
// The app's lifecycle is DERIVED: the max stage among its components —
// never stored, never user-set.
import { NAME_RE, validShortname, deriveAppStage }
  from '../../domain/component.js';
import { APP_ROLES } from './members.js';

const defaultAlias = (name) => name.toUpperCase().replace(/-/g, '');

const withStage = (a) => a
  ? { ...a, lifecycle: deriveAppStage(a.components) }
  : a;

export const listApplications = ({ applications }) =>
  async () => (await applications.list()).map(withStage);

export const getApplication = ({ applications }) =>
  async (name) => withStage(await applications.get(name));

// Creating applications requires membership in a can_create_apps team —
// bootstrap users (no member row, ALLOWED_USERS env) keep broad access.
export const createApplication = ({ applications, catalog, teams }) =>
  async ({ name, alias, business_unit = '', description = '', repo_prefix = '',
           components = [], createdBy, member }) => {
    if (member && !await teams.memberCanCreateApps(member.github_username))
      return { status: 403, error: 'creating applications requires an app-creator team' };
    const n = String(name || '').trim();
    if (!NAME_RE.test(n)) return { status: 400, error: 'invalid application name' };
    const a = String(alias || '').trim() || defaultAlias(n);
    if (!validShortname(a)) return { status: 400, error: 'invalid alias' };
    const p = String(repo_prefix || '').trim() || n;
    if (!NAME_RE.test(p)) return { status: 400, error: 'invalid repo_prefix' };
    if (await applications.get(n)) return { status: 409, error: 'application already registered' };

    for (const c of components)
      if (!await catalog.get(c))
        return { status: 400, error: `component ${c} does not exist` };

    const application = await applications.create({
      name: n, alias: a, business_unit: business_unit.trim(),
      description: description.trim(), repo_prefix: p,
      created_by: createdBy || '',
    });
    // The creator joins as product-owner — app roles gate secret envs,
    // so whoever registers the app needs a role on it. Best-effort:
    // bootstrap users without a member row can't FK in.
    if (createdBy)
      await applications.addMember({
        application: n, github_username: String(createdBy).toLowerCase(),
        roles: ['product-owner'], added_by: String(createdBy),
      }).catch(() => {});
    for (const c of components) await applications.setComponentApp(c, n);
    return { status: 201, application: withStage({ ...application, components: [] }) };
  };

// Attach a registered member to an application with one or more roles.
export const addApplicationMember = ({ applications, members }) =>
  async (appName, { github_username, role, roles }, addedBy) => {
    const app = await applications.get(appName);
    if (!app) return { status: 404, error: 'application not found' };
    const rs = (Array.isArray(roles) ? roles : [role])
      .filter((r) => typeof r === 'string');
    if (!rs.length || !rs.every((r) => APP_ROLES.includes(r)))
      return { status: 400, error: `roles must be a non-empty subset of ${APP_ROLES.join('/')}` };
    const u = String(github_username || '').trim().toLowerCase();
    if (!u || !await members.get(u))
      return { status: 400, error: 'member is not registered' };
    if ((app.application_members || []).some((am) => am.github_username === u))
      return { status: 409, error: 'member is already in the application' };
    await applications.addMember({
      application: app.name, github_username: u,
      roles: [...new Set(rs)], added_by: addedBy || '',
    });
    return { status: 201, application: await applications.get(appName) };
  };
