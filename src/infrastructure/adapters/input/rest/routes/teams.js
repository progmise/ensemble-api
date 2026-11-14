import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Team registry — high-level groups owning functionality.
export const teamsRouter = ({ usecases, catalogReady }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });
  const catalogOk = (res) => {
    if (!catalogReady()) {
      res.status(503).json({ error: 'catalog not configured (SUPABASE_*)' });
      return false;
    }
    return true;
  };

  return Router()
    .get('/api/teams', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      try {
        res.json(await usecases.listTeams());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/teams', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogOk(res)) return;
      const { name, shortname, type, description, owners } = req.body || {};
      const result = await usecases.createTeam({
        name, shortname, type, description, owners,
        createdBy: session.user.login,
      });
      res.status(result.status).json(result.team ?? { error: result.error });
    })

    .get('/api/teams/:id', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      const row = await usecases.getTeam(req.params.id).catch(() => null);
      return row ? res.json(row) : res.status(404).json({ error: 'not found' });
    })

    .post('/api/teams/:id/members', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogOk(res)) return;
      const { github_username, owner } = req.body || {};
      const result = await usecases.addTeamMember(req.params.id,
        { github_username, owner }, session.user.login);
      res.status(result.status).json(result.team ?? { error: result.error });
    });
};
