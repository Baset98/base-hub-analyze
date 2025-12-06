const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variables for blockchain APIs
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const INFURA_API_KEY = process.env.INFURA_API_KEY;

if (!ALCHEMY_API_KEY || !INFURA_API_KEY) {
    console.warn('⚠️  Warning: ALCHEMY_API_KEY or INFURA_API_KEY not set.');
}

const NETWORK_CONFIG = {
    base: {
        key: 'base',
        label: 'Base Mainnet',
        nativeSymbol: 'ETH',
        rpcUrl: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
        infuraUrl: `https://base-mainnet.infura.io/v3/${INFURA_API_KEY}`,
    },
    ethereum: {
        key: 'ethereum',
        label: 'Ethereum Mainnet',
        nativeSymbol: 'ETH',
        rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
        infuraUrl: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    },
};

function getNetworkConfig(networkKey = 'base') {
    const key = (networkKey || 'base').toLowerCase();
    const config = NETWORK_CONFIG[key];
    if (!config) throw new Error('Unsupported network');
    return config;
}

app.use(express.static('public'));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/api/score', async (req, res) => {
    const { address, network = 'base' } = req.body;
    if (!address) return res.status(400).json({ error: 'Address required' });

    try {
        const config = getNetworkConfig(network);
        const [balanceRes, txCountRes] = await Promise.all([
            axios.post(config.rpcUrl, {
                jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"]
            }, { timeout: 10000 }),
            axios.post(config.rpcUrl, {
                jsonrpc: "2.0", id: 2, method: "eth_getTransactionCount", params: [address, "latest"]
            }, { timeout: 10000 })
        ]);

        const balanceEth = Number(BigInt(balanceRes.data.result)) / 1e18;
        const txCount = parseInt(txCountRes.data.result, 16);
        const score = (txCount * 10) + Math.floor(balanceEth * 50);
        
        let rank = 'Newbie';
        if (score > 100) rank = 'Explorer';
        if (score > 500) rank = 'Base Believer';
        if (score > 2000) rank = 'Base OG';

        res.json({
            balance: balanceEth.toFixed(4),
            txCount,
            score,
            rank,
            network: config.key,
            networkLabel: config.label,
            nativeSymbol: config.nativeSymbol,
        });
    } catch (error) {
        console.error('API error:', error.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 Visit: http://localhost:${PORT}`);
}).on('error', (err) => {
    console.error('❌ Server error:', err.message);
    process.exit(1);
});
