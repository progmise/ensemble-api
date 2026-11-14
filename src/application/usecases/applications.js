// Use cases: application registry — groups related components under one
// app (front + back + libs). Alias defaults to the name's uppercase form.
// The app's lifecycle is DERIVED: the max stage among its components —
// never stored, never user-set.
import { NAME_RE, validShortname, deriveAppStage }
  from '../../domain/component.js';

const defaultAlias = (name) => name.toUpperCase().replace(/-/g, '');

const withStage = (a) => a
  ? { ...a, lifecycle: deriveAppStage(a.components) }
  : a;

export const listApplications = ({ applications }) =>
  async () => (await applications.list()).map(withStage);

export const getApplication = ({ applications }) =>
  async (name) => withStage(await applications.get(name));

export const createApplication = ({ applications, catalog }) =>
  async ({ name, alias, business_unit = '', description = '', repo_prefix = '',
           components = [], createdBy }) => {
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
    for (const c of components) await applications.setComponentApp(c, n);
    return { status: 201, application: withStage({ ...application, components: [] }) };
  };
