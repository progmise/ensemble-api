import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

// Member registry — any authenticated member can list and register members.
// Registration grants platform access only; per-app roles live in
// application_members.
export const membersRouter = ({ usecases, catalogReady }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });

  return Router()
    .get('/api/members', async (req, res) => {
      if (!await auth(req, res)) return;
      if (!catalogReady()) {
        return res.status(503).json({ error: 'member catalog not configured (SUPABASE_*)' });
      }
      try {
        res.json(await usecases.listMembers());
      } catch (e) {
        res.status(502).json({ error: String(e.message || e) });
      }
    })

    .post('/api/members', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      if (!catalogReady()) {
        return res.status(503).json({ error: 'member catalog not configured (SUPABASE_*)' });
      }
      const { github_username, full_name, email } = req.body || {};
      const result = await usecases.createMember({
        github_username, full_name, email, createdBy: session.user.login,
      });
      res.status(result.status).json(result.member ?? { error: result.error });
    });
};
