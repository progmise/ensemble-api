// Output adapter: applications table — the grouping level above components
// (components.application FK). list/get embed the app's components via
// PostgREST so the UI can render counts/status without extra calls.
export const applicationCatalog = ({ client }) => ({
  list: () => client.rest(
    'applications?select=*,components(name,status,lifecycle)&order=name.asc'),

  async get(name) {
    const rows = await client.rest(
      `applications?name=eq.${encodeURIComponent(name)}` +
      '&select=*,components(*),' +
      'application_members(github_username,role,members(github_username,full_name))');
    return rows[0] || null;
  },

  // Roles a member holds across applications — secrets gating reads them.
  memberRoles: (username) => client.rest(
    `application_members?github_username=eq.${encodeURIComponent(username)}` +
    '&select=application,role'),

  addMember: (row) =>
    client.rest('application_members', {
      method: 'POST',
      body: row,
      prefer: 'return=minimal',
    }),

  create: (row) =>
    client.rest('applications', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).then((rows) => rows[0]),

  // Point an existing component at this application.
  setComponentApp: (component, application) =>
    client.rest(`components?name=eq.${encodeURIComponent(component)}`, {
      method: 'PATCH',
      body: { application },
    }),
});
