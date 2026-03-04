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

    // Security check
    if (token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!domain || typeof domain !== 'string') {
        return res.status(400).json({ error: 'Missing domain parameter' });
    }

    const safeKey = domain.replace(/\./g, '_');

    try {
        const config = await get(safeKey) as any;
        if (!config) {
            return res.status(404).json({ error: 'Configuration not found' });
        }

        // --- BUSCA MÉTRICAS REAIS ---
        const periods = {
            today: 1,
            '7d': 7,
            '30d': 30,
            total: 90 // Limite de retenção do Redis configurado no middleware
        };

        const metrics: any = {};
        const variants = ['A', 'B']; // Por enquanto fixo A/B, mas pode ser expandido se config tiver 'variants'

        // Se houver variantes extras na config, adicione-as
        if (config.variants) {
            config.variants.forEach((v: any) => {
                if (!variants.includes(v.name)) variants.push(v.name);
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

            // Total do domínio no período
            const totalClickKeys = dateList.map(d => `metrics:${safeKey}:total:clicks:daily:${d}`);
            const totalUniqueKeys = dateList.map(d => `metrics:${safeKey}:total:uniques:daily:${d}`);

            const clickValues = await kv.mget(...totalClickKeys);
            metrics[periodName].totalClicks = clickValues.reduce((acc: number, val: any) => acc + (parseInt(val) || 0), 0);

            // Unicos usam PFCOUNT para união correta de HyperLogLog
            metrics[periodName].totalUniques = await kv.pfcount(...totalUniqueKeys);

            // Métricas por variante
            for (const v of variants) {
                const vClickKeys = dateList.map(d => `metrics:${safeKey}:${v}:clicks:daily:${d}`);
                const vUniqueKeys = dateList.map(d => `metrics:${safeKey}:${v}:uniques:daily:${d}`);

                const vClickValues = await kv.mget(...vClickKeys);
                const vClicks = vClickValues.reduce((acc: number, val: any) => acc + (parseInt(val) || 0), 0);
                const vUniques = await kv.pfcount(...vUniqueKeys);

                metrics[periodName].variants[v] = { clicks: vClicks, uniques: vUniques };
            }
        }

        return res.status(200).json({ ...config, realMetrics: metrics });
    } catch (error) {
        console.error('Fetch error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
