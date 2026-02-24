import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { domain, urlA, urlB, split, token } = req.body;

    // Security check
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!domain || !urlA || !urlB) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // CORREÇÃO: Vercel Edge Config não aceita "." em chaves (keys). 
    // Substituímos pontos por underscores para garantir a compatibilidade.
    const safeDomainKey = domain.replace(/\./g, '_');

    const vercelToken = process.env.VERCEL_TOKEN;
    const edgeConfigId = process.env.EDGE_CONFIG_ID;

    if (!vercelToken || !edgeConfigId) {
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        const response = await fetch(
            `https://api.vercel.com/v1/edge-config/${edgeConfigId}/items`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${vercelToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    items: [
                        {
                            operation: 'upsert',
                            key: safeDomainKey, // Usando a chave limpa sem pontos
                            value: {
                                urlA,
                                urlB,
                                split: parseFloat(split) || 0.5,
                            },
                        },
                    ],
                }),
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: data.error || 'Failed to update Edge Config' });
        }

        return res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Update error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
