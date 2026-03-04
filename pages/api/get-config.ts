import type { NextApiRequest, NextApiResponse } from 'next';
import { get } from '@vercel/edge-config';
import { kv } from '@vercel/kv';

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

    // Security check - Use environment variable or default for fallback if not set (for dev)
    const adminToken = process.env.ADMIN_TOKEN || 'slimeroi_secret_2026_xpto';
    if (token !== adminToken) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!domain || typeof domain !== 'string') {
        return res.status(400).json({ error: 'Missing domain parameter' });
    }

    const safeKey = domain.replace(/\./g, '_');

    try {
        const config = await get(safeKey) as any;
        if (!config) {
            return res.status(404).json({ error: 'Configuration not found in Edge Config' });
        }

        // --- BUSCA MÉTRICAS REAIS ---
        const periods = {
            today: 1,
            '7d': 7,
            '30d': 30,
            total: 90
        };

        const metrics: any = {};
        const variants = ['A', 'B'];

        if (config.variants && Array.isArray(config.variants)) {
            config.variants.forEach((v: any) => {
                if (v && v.name && !variants.includes(v.name)) {
                    variants.push(v.name);
                }
            });
        }

        const today = new Date();
        const getDates = (days: number) => {
            return Array.from({ length: days }, (_, i) => {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                return d.toISOString().split('T')[0];
            });
        };

        for (const [periodName, days] of Object.entries(periods)) {
            const dateList = getDates(days);
            metrics[periodName] = { totalClicks: 0, totalUniques: 0, variants: {} };

            try {
                // Total do domínio no período
                const totalClickKeys = dateList.map(d => `metrics:${safeKey}:total:clicks:daily:${d}`);
                const totalUniqueKeys = dateList.map(d => `metrics:${safeKey}:total:uniques:daily:${d}`);

                // Fetch values - using a safe way to handle kv methods
                let clickValues: any[] = [];
                try {
                    clickValues = await kv.mget(...totalClickKeys);
                } catch (e) {
                    console.error('KV mget error:', e);
                    clickValues = new Array(totalClickKeys.length).fill(0);
                }

                metrics[periodName].totalClicks = clickValues.reduce((acc: number, val: any) => acc + (parseInt(val) || 0), 0);

                try {
                    metrics[periodName].totalUniques = await kv.pfcount(...totalUniqueKeys);
                } catch (e) {
                    console.error('KV pfcount error:', e);
                    metrics[periodName].totalUniques = 0;
                }

                // Métricas por variante
                for (const v of variants) {
                    const vClickKeys = dateList.map(d => `metrics:${safeKey}:${v}:clicks:daily:${d}`);
                    const vUniqueKeys = dateList.map(d => `metrics:${safeKey}:${v}:uniques:daily:${d}`);

                    let vClickValues: any[] = [];
                    try {
                        vClickValues = await kv.mget(...vClickKeys);
                    } catch (e) {
                        vClickValues = new Array(vClickKeys.length).fill(0);
                    }

                    const vClicks = vClickValues.reduce((acc: number, val: any) => acc + (parseInt(val) || 0), 0);

                    let vUniques = 0;
                    try {
                        vUniques = await kv.pfcount(...vUniqueKeys);
                    } catch (e) {
                        vUniques = 0;
                    }

                    metrics[periodName].variants[v] = { clicks: vClicks, uniques: vUniques };
                }
            } catch (periodError) {
                console.error(`Error processing metrics for period ${periodName}:`, periodError);
            }
        }

        return res.status(200).json({ ...config, realMetrics: metrics });
    } catch (error: any) {
        console.error('Fetch error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

