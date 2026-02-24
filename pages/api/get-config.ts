import type { NextApiRequest, NextApiResponse } from 'next';
import { get } from '@vercel/edge-config';

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

    const { domain, token } = req.query;

    // Security check
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!domain || typeof domain !== 'string') {
        return res.status(400).json({ error: 'Missing domain parameter' });
    }

    // CORREÇÃO: Vercel Edge Config não aceita "." em chaves. 
    // Usamos a mesma lógica do update.ts e middleware.ts
    const safeKey = domain.replace(/\./g, '_');

    try {
        const config = await get(safeKey);
        if (!config) {
            return res.status(404).json({ error: 'Configuration not found' });
        }
        return res.status(200).json(config);
    } catch (error) {
        console.error('Fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
