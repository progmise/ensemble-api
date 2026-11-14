// Output adapter: teams + team_members — high-level functional groups.
// list/get embed members (and their member row for display names).
export const teamCatalog = ({ client }) => ({
  list: () => client.rest(
    'teams?select=*,team_members(github_username,owner)&order=name.asc'),

  async get(name) {
    const rows = await client.rest(
      `teams?name=eq.${encodeURIComponent(name)}` +
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
