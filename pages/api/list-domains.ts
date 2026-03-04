import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { token } = req.query;

    // Security check - Use the same admin token logic
    const adminToken = process.env.ADMIN_TOKEN || 'slimeroi_secret_2026_xpto';
    if (token !== adminToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID || 'slimeroi-ab-api';

    if (!vercelToken) {
        return res.status(500).json({ error: 'VERCEL_TOKEN not configured on server' });
    }

    try {
        const response = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains`, {
            headers: {
                'Authorization': `Bearer ${vercelToken}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json(data);
    } catch (error: any) {
        console.error('List domains proxy error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
