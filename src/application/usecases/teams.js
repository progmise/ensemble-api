// Use cases: team registry — high-level groups owning functionality
// (templates, workflows, application owners). `type` is free text; the
// granular permission set emerges as features demand gating.
import { validShortname } from '../../domain/component.js';

// "Quality Exception Management Team" -> "QEMT"
const initials = (name) =>
  name.split(/\s+/).map((w) => w[0]).join('').toUpperCase()
    .replace(/[^A-Z0-9]/g, '').slice(0, 30);

export const listTeams = ({ teams }) => () => teams.list();
export const getTeam = ({ teams }) => (idOrName) => teams.get(idOrName);

// Attach a registered member to a team (as member or owner).
export const addTeamMember = ({ teams, members }) =>
  async (teamId, { github_username, owner = false }, addedBy) => {
    const team = await teams.get(teamId);
    if (!team) return { status: 404, error: 'team not found' };
    const u = String(github_username || '').trim().toLowerCase();
    if (!u || !await members.get(u))
      return { status: 400, error: 'member is not registered' };
    if ((team.team_members || []).some((tm) => tm.github_username === u))
      return { status: 409, error: 'member is already in the team' };
    await teams.addMembers([{
      team: team.name, github_username: u,
      owner: !!owner, added_by: addedBy || '',
    }]);
    return { status: 201, team: await teams.get(teamId) };
  };

export const createTeam = ({ teams, members }) =>
  async ({ name, shortname, type = '', description = '',
           owners = [], can_create_apps = false, createdBy }) => {
    const n = String(name || '').trim();
    if (!n || n.length > 80) return { status: 400, error: 'invalid team name' };
    const s = String(shortname || '').trim() || initials(n);
    if (!validShortname(s)) return { status: 400, error: 'invalid shortname' };
    if (await teams.get(n)) return { status: 409, error: 'team already registered' };

    const ownerList = [...new Set(owners.map((o) => String(o).trim().toLowerCase()))];
    for (const o of ownerList)
      if (!await members.get(o))
        return { status: 400, error: `member ${o} is not registered` };

    await teams.create({
      name: n, shortname: s, type: type.trim(),
      description: description.trim(), created_by: createdBy || '',
      can_create_apps: !!can_create_apps,
    });
    if (ownerList.length)
      await teams.addMembers(ownerList.map((o) => ({
        team: n, github_username: o, owner: true, added_by: createdBy || '',
      })));
    return { status: 201, team: await teams.get(n) };
  };
