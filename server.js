const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variables for blockchain APIs
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const INFURA_API_KEY = process.env.INFURA_API_KEY;

// Validate required environment variables
if (!ALCHEMY_API_KEY || !INFURA_API_KEY) {
    console.warn('⚠️  Warning: ALCHEMY_API_KEY or INFURA_API_KEY not set. Some features may not work.');
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

    if (!config) {
        throw new Error('Unsupported network');
    }

    return config;
}

async function fetchTransferAnalysisFromAlchemy(address, networkConfig) {
    // استفاده از Alchemy برای دریافت تراکنش‌ها
    const basePayload = {
        fromBlock: "0x0",
        toBlock: "latest",
        category: ["external", "erc20", "erc721", "erc1155"],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: "0x3e8" // 1000
    };

    try {
        // دریافت تراکنش‌های outbound و inbound از Alchemy - با retry
        let outboundRes, inboundRes;
        let retries = 3;
            try {
                [outboundRes, inboundRes] = await Promise.all([
                    axios.post(networkConfig.rpcUrl, {
                        jsonrpc: "2.0",
                        id: 3,
                        method: "alchemy_getAssetTransfers",
                        params: [{ ...basePayload, fromAddress: address }]
                    }, { timeout: 10000 }),
                    axios.post(networkConfig.rpcUrl, {
                        jsonrpc: "2.0",
                        id: 4,
                        method: "alchemy_getAssetTransfers",
                        params: [{ ...basePayload, toAddress: address }]
                    }, { timeout: 10000 })
                ]);
                console.log(`✅ دریافت اطلاعات از Alchemy برای ${address}`);
                break;
            } catch (err) {
                retries--;
                if (err.response?.status === 429 && retries > 0) {
                    const waitTime = 2 ** (3 - retries);
                    console.warn(`⚠️ Alchemy Rate limit - retry in ${waitTime}s...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * waitTime));
                } else if (retries === 0) {
                    throw err;
                }
            }
        }
        
        while (retries > 0) {

        const transfersOut = outboundRes?.data?.result?.transfers || [];
        const transfersIn = inboundRes?.data?.result?.transfers || [];
        const decorated = [
            ...transfersOut.map((t) => ({ ...t, direction: 'out' })),
            ...transfersIn.map((t) => ({ ...t, direction: 'in' }))
        ];

        if (!decorated.length) return null;

        const ethValue = (value) => {
            if (value === undefined || value === null) return 0;
            const num = Number(value);
            return isNaN(num) ? 0 : num;
        };

        let totalInEth = 0;
        let totalOutEth = 0;
        let ethTransfersCount = 0;
        let totalEthValue = 0;
        const activeDays = new Set();
        const counterparties = new Set();
        const counterpartyCounts = {};
        const contracts = new Set();
        let firstTx = null;
        let lastTx = null;
        let nftTransfers = 0;
        let erc20Transfers = 0;
        let externalTransfers = 0;
        const nativeTransfers = [];

        decorated.forEach((transfer) => {
            const timestamp = transfer?.metadata?.blockTimestamp;
            if (timestamp) {
                const day = timestamp.split('T')[0];
                activeDays.add(day);
                const dateObj = new Date(timestamp);
                if (!firstTx || dateObj < firstTx) firstTx = dateObj;
                if (!lastTx || dateObj > lastTx) lastTx = dateObj;
            }

            if (transfer.direction === 'in' && transfer.from) {
                const addr = transfer.from.toLowerCase();
                counterparties.add(addr);
                counterpartyCounts[addr] = (counterpartyCounts[addr] || 0) + 1;
            } else if (transfer.direction === 'out' && transfer.to) {
                const addr = transfer.to.toLowerCase();
                counterparties.add(addr);
                counterpartyCounts[addr] = (counterpartyCounts[addr] || 0) + 1;
            }

            if (transfer.rawContract?.address) {
                contracts.add(transfer.rawContract.address.toLowerCase());
            }

            if (transfer.category === 'erc721' || transfer.category === 'erc1155') {
                nftTransfers += 1;
            }
            if (transfer.category === 'erc20') {
                erc20Transfers += 1;
            }
            if (transfer.category === 'external') {
                externalTransfers += 1;
            }

            if (transfer.asset && transfer.asset.toUpperCase() === networkConfig.nativeSymbol.toUpperCase()) {
                const value = ethValue(transfer.value);
                if (transfer.direction === 'in') {
                    totalInEth += value;
                } else {
                    totalOutEth += value;
                }
                ethTransfersCount += 1;
                totalEthValue += value;
                // store native transfers for later largest transfer analysis
                nativeTransfers.push({
                    value,
                    direction: transfer.direction,
                    timestamp: transfer?.metadata?.blockTimestamp || null,
                    counterparty: transfer.direction === 'in' ? transfer.from : transfer.to,
                });
            }
        });

        const txCount = decorated.length;
        const avgTxValueEth = ethTransfersCount ? totalEthValue / ethTransfersCount : 0;

        // additional computed metrics
        const netFlowEth = totalInEth - totalOutEth;
        let durationDays = null;
        if (firstTx && lastTx) {
            const diffMs = lastTx - firstTx;
            durationDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        }

        const avgTxPerDay = durationDays ? +(txCount / durationDays).toFixed(2) : null;

        // top counterparties (by frequency)
        const topCounterparties = Object.entries(counterpartyCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([address, count]) => ({ address, count }));

        // largest native transfers
        const largestNativeTransfers = nativeTransfers
            .slice()
            .sort((a, b) => b.value - a.value)
            .slice(0, 5)
            .map(t => ({
                value: t.value.toFixed(6),
                direction: t.direction,
                timestamp: t.timestamp,
                counterparty: t.counterparty,
            }));

        return {
            tx_count: txCount,
            inbound_count: transfersIn.length,
            outbound_count: transfersOut.length,
            active_days: activeDays.size,
            total_in_eth: totalInEth.toFixed(4),
            total_out_eth: totalOutEth.toFixed(4),
            avg_tx_value_eth: avgTxValueEth.toFixed(4),
            unique_counterparties: counterparties.size,
            unique_contracts: contracts.size,
            nft_transfers: nftTransfers,
            erc20_transfers: erc20Transfers,
            external_transfers: externalTransfers,
            first_tx: firstTx ? firstTx.toISOString() : null,
            last_tx: lastTx ? lastTx.toISOString() : null,
            network: networkConfig.key,
            // computed
            net_flow_eth: netFlowEth.toFixed(4),
            duration_days: durationDays,
            avg_tx_per_day: avgTxPerDay,
            top_counterparties: topCounterparties,
            largest_native_transfers: largestNativeTransfers,
        };
    } catch (err) {
        console.error('❌ Error fetching transfer analysis:', err.message);
        return null;
    }
}

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// POST /api/score endpoint
app.post('/api/score', async (req, res) => {
    const { address, network = 'base' } = req.body;

    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }

    let networkConfig;
    try {
        networkConfig = getNetworkConfig(network);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid network' });
    }

    try {
        // 1. دریافت موجودی و تعداد تراکنش از Alchemy - با retry
        let balanceReq, txCountReq;
        let retries = 3;
        
        while (retries > 0) {
            try {
                [balanceReq, txCountReq] = await Promise.all([
                    axios.post(networkConfig.rpcUrl, {
                        jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"]
                    }, { timeout: 10000 }),
                    axios.post(networkConfig.rpcUrl, {
                        jsonrpc: "2.0", id: 2, method: "eth_getTransactionCount", params: [address, "latest"]
                    }, { timeout: 10000 })
                ]);
                console.log(`✅ دریافت اطلاعات حساب از Alchemy برای ${address}`);
                break;
            } catch (err) {
                retries--;
                if (err.response?.status === 429 && retries > 0) {
                    console.warn(`⚠️ Alchemy Rate limit - تلاش دوباره در ${2 ** (3 - retries)} ثانیه...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** (3 - retries))));
                } else if (retries === 0) {
                    throw err;
                }
            }
        }

        const transferAnalysis = await fetchTransferAnalysisFromAlchemy(address, networkConfig);

        const balanceEth = Number(BigInt(balanceReq.data.result)) / 1e18;
        const txCount = parseInt(txCountReq.data.result, 16);

        // Calculate score and rank
        const totalScore = (txCount * 10) + Math.floor(balanceEth * 50);
        
        let rank = 'Newbie';
        if (totalScore > 100) rank = 'Explorer';
        if (totalScore > 500) rank = 'Base Believer';
        if (totalScore > 2000) rank = 'Base OG';

        // Return result
        res.json({
            balance: balanceEth.toFixed(4),
            txCount: txCount,
            score: totalScore,
            rank: rank,
            network: networkConfig.key,
            networkLabel: networkConfig.label,
            nativeSymbol: networkConfig.nativeSymbol,
            analysis: transferAnalysis || null,
        });

    } catch (error) {
        console.error('API error:', error.message);
        res.status(500).json({ error: 'Network error' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server started successfully on port ${PORT}!`);
    console.log(`🌐 Your app is ready! Visit:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`\nTo stop the server, press Ctrl+C.`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use!`);
        console.error('Please close the other application using this port.');
    } else {
        console.error('❌ Error starting server:', err.message);
    }
    process.exit(1);
});
