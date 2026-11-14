// Use cases: team registry — high-level groups owning functionality
// (templates, workflows, application owners). `type` is free text; the
// granular permission set emerges as features demand gating.
import { validShortname } from '../../domain/component.js';

// "Quality Exception Management Team" -> "QEMT"
const initials = (name) =>
  name.split(/\s+/).map((w) => w[0]).join('').toUpperCase()
    .replace(/[^A-Z0-9]/g, '').slice(0, 30);

export const listTeams = ({ teams }) => () => teams.list();
export const getTeam = ({ teams }) => (name) => teams.get(name);

export const createTeam = ({ teams, members }) =>
  async ({ name, shortname, type = '', description = '',
           owners = [], createdBy }) => {
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
    });
    if (ownerList.length)
      await teams.addMembers(ownerList.map((o) => ({
        team: n, github_username: o, owner: true, added_by: createdBy || '',
      })));
    return { status: 201, team: await teams.get(n) };
  };
