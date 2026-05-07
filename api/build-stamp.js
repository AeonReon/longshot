// Returns the current Vercel deploy SHA so the PWA can detect new builds.
export default function handler(req, res) {
  const stamp = process.env.VERCEL_GIT_COMMIT_SHA
             || process.env.VERCEL_DEPLOYMENT_ID
             || String(Date.now());
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.status(200).json({ stamp });
}
