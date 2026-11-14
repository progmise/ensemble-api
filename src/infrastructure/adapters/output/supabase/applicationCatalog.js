// Output adapter: applications table — the grouping level above components
// (components.application FK). list/get embed the app's components via
// PostgREST so the UI can render counts/status without extra calls.
export const applicationCatalog = ({ client }) => ({
  list: () => client.rest(
    'applications?select=*,components(name,status)&order=name.asc'),

  async get(name) {
    const rows = await client.rest(
      `applications?name=eq.${encodeURIComponent(name)}&select=*,components(*)`);
    return rows[0] || null;
  },

  create: (row) =>
    client.rest('applications', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).then((rows) => rows[0]),

  setLifecycle: (name, lifecycle) =>
    client.rest(`applications?name=eq.${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: { lifecycle },
    }),

  // Point an existing component at this application.
  setComponentApp: (component, application) =>
    client.rest(`components?name=eq.${encodeURIComponent(component)}`, {
      method: 'PATCH',
      body: { application },
    }),
});
