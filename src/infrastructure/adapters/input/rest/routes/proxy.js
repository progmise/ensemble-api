import { Router } from 'express';
import { authedUser } from '../middleware/session.js';

const ghFetch = (token, url) =>
  fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

// /api/gh/<github api path>?<query> — proxies the GitHub API with the
// caller's own token; /api/manifest serves an app's OAM definition from
// its app-model repo (env manifest repo when the app has none).
export const proxyRouter = ({ usecases }) => {
  const auth = authedUser({ resolveSession: usecases.resolveSession });
  return Router()
    .get('/api/gh/{*splat}', async (req, res) => {
      const session = await auth(req, res);
      if (!session) return;
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const r = await ghFetch(session.token,
        `https://api.github.com/${req.params.splat.join('/')}${query}`);
      res.status(r.status).json(await r.json().catch(() => ({})));
    })

    .get('/api/manifest', async (req, res) => {
      if (!await auth(req, res)) return;
      const application = String(req.query.application || '').trim();
      const repo = await usecases.manifestRepoFor(application || null);
      for (const name of
        ['oam-application-definition.yml', 'manifest.yml']) {
        const r = await fetch(
          `https://raw.githubusercontent.com/${repo}/main/${name}`);
        if (r.ok) return res.type('text/yaml').send(await r.text());
      }
      res.status(404).type('text').send(`no OAM definition file in ${repo}`);
    });
};
