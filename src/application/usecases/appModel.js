// App-model (OAM) — every application deploys from its own app-model
// component repo holding oam-application-definition.yml. These helpers
// resolve which repo/file backs an application, falling back to the
// env-configured global manifest repo while apps lack an app-model
// component.

import { MANIFEST_FILE, LEGACY_MANIFEST_FILE }
  from '../../domain/manifest.js';

// application name (or its app row) -> 'owner/repo' manifest repo.
export const manifestRepoFor = ({ catalog, repoHost }) =>
  async (application) => {
    const app = typeof application === 'string' ? application : application?.name;
    return (app && await catalog.appModelRepo(app)) || repoHost.manifestRepo;
  };

// Fetch the OAM definition file of a repo at a ref — tries the new
// filename first, then the legacy manifest.yml.
// Returns { name, file, text } or null.
export const readManifestFile = async (repoHost, repo, ref = 'main') => {
  for (const name of [MANIFEST_FILE, LEGACY_MANIFEST_FILE]) {
    try {
      const file = await repoHost.api(
        `/repos/${repo}/contents/${name}?ref=${ref}`);
      return {
        name, file,
        text: Buffer.from(file.content, 'base64').toString('utf8'),
      };
    } catch { /* try the other name */ }
  }
  return null;
};
