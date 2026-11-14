import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Application registry — groups components under one app (front + back).
export const applicationsRouter = ({ usecases, catalogReady }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });
  const catalogOk = (res) => {
    if (!catalogReady()) {
      res.status(503).json({ error: 'catalog not configured (SUPABASE_*)' });
      return false;
    }
    return true;
  };

  return Router()
    .get('/api/applications', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      try {
        res.json(await usecases.listApplications());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/applications', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogOk(res)) return;
      const { name, alias, business_unit, description, repo_prefix, lifecycle,
              components } = req.body || {};
      const result = await usecases.createApplication({
        name, alias, business_unit, description, repo_prefix, lifecycle, components,
        createdBy: session.user.login,
      });
      res.status(result.status).json(result.application ?? { error: result.error });
    })

    .get('/api/applications/:name', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogOk(res)) return;
      const row = await usecases.getApplication(req.params.name).catch(() => null);
      return row ? res.json(row) : res.status(404).json({ error: 'not found' });
    });
};
