// Output adapter: teams + team_members — high-level functional groups.
// list/get embed members (and their member row for display names).
export const teamCatalog = ({ client }) => ({
  list: () => client.rest(
    'teams?select=*,team_members(github_username,owner)&order=name.asc'),

  // Lookup by numeric id or by name — URLs carry the id.
  async get(key) {
    const pred = /^\d+$/.test(key)
      ? `id=eq.${encodeURIComponent(key)}`
      : `name=eq.${encodeURIComponent(key)}`;
    const rows = await client.rest(
      `teams?${pred}` +
      '&select=*,team_members(github_username,owner,members(github_username,full_name))');
    return rows[0] || null;
  },

  create: (row) =>
    client.rest('teams', {
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    }).then((rows) => rows[0]),

  addMembers: (rows) =>
    client.rest('team_members', {
      method: 'POST',
      body: rows,
      prefer: 'return=minimal',
    }),
});
