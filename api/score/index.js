const axios = require('axios');
const { computeScore } = require('../../lib/score');

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const INFURA_API_KEY = process.env.INFURA_API_KEY || '';

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

async function fetchTransferAnalysisFromAlchemy(address, networkConfig) {
  const basePayload = {
    fromBlock: '0x0',
    toBlock: 'latest',
    category: ['external', 'erc20', 'erc721', 'erc1155'],
    withMetadata: true,
    excludeZeroValue: true,
    maxCount: '0x3e8',
  };

  try {
    let outboundRes, inboundRes;
    let retries = 3;
    while (retries > 0) {
      try {
        [outboundRes, inboundRes] = await Promise.all([
          axios.post(networkConfig.rpcUrl, {
            jsonrpc: '2.0',
            id: 3,
            method: 'alchemy_getAssetTransfers',
            params: [{ ...basePayload, fromAddress: address }],
          }, { timeout: 10000 }),
          axios.post(networkConfig.rpcUrl, {
            jsonrpc: '2.0',
            id: 4,
            method: 'alchemy_getAssetTransfers',
            params: [{ ...basePayload, toAddress: address }],
          }, { timeout: 10000 }),
        ]);
        break;
      } catch (err) {
        retries--;
        if (err.response?.status === 429 && retries > 0) {
          await new Promise(r => setTimeout(r, 1000 * (2 ** (3 - retries))));
        } else if (retries === 0) {
          throw err;
        }
      }
    }

    const transfersOut = outboundRes?.data?.result?.transfers || [];
    const transfersIn = inboundRes?.data?.result?.transfers || [];
    const decorated = [
      ...transfersOut.map((t) => ({ ...t, direction: 'out' })),
      ...transfersIn.map((t) => ({ ...t, direction: 'in' })),
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
        if (transfer.direction === 'in') totalInEth += value; else totalOutEth += value;
        ethTransfersCount += 1;
        totalEthValue += value;
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
    const netFlowEth = totalInEth - totalOutEth;
    let durationDays = null;
    if (firstTx && lastTx) {
      const diffMs = lastTx - firstTx;
      durationDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }
    const avgTxPerDay = durationDays ? +(txCount / durationDays).toFixed(2) : null;
    const topCounterparties = Object.entries(counterpartyCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([address,count])=>({address,count}));
    const largestNativeTransfers = nativeTransfers.slice().sort((a,b)=>b.value-a.value).slice(0,5).map(t=>({value: t.value.toFixed(6), direction: t.direction, timestamp: t.timestamp, counterparty: t.counterparty}));

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
      net_flow_eth: netFlowEth.toFixed(4),
      duration_days: durationDays,
      avg_tx_per_day: avgTxPerDay,
      top_counterparties: topCounterparties,
      largest_native_transfers: largestNativeTransfers,
    };
  } catch (err) {
    console.error('Error fetching transfer analysis:', err && err.message);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { address, network = 'base' } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address is required' });

    let networkConfig;
    try { networkConfig = getNetworkConfig(network); } catch (e) { return res.status(400).json({ error: 'invalid network' }); }

    let balanceReq, txCountReq;
    let retries = 3;
    while (retries > 0) {
      try {
        [balanceReq, txCountReq] = await Promise.all([
          axios.post(networkConfig.rpcUrl, { jsonrpc: '2.0', id:1, method: 'eth_getBalance', params: [address, 'latest'] }, { timeout: 10000 }),
          axios.post(networkConfig.rpcUrl, { jsonrpc: '2.0', id:2, method: 'eth_getTransactionCount', params: [address, 'latest'] }, { timeout: 10000 }),
        ]);
        break;
      } catch (err) {
        retries--;
        if (err.response?.status === 429 && retries > 0) {
          await new Promise(r=>setTimeout(r, 1000 * (2 ** (3 - retries))));
        } else if (retries === 0) throw err;
      }
    }

    const transferAnalysis = await fetchTransferAnalysisFromAlchemy(address, networkConfig);
    const balanceEth = Number(BigInt(balanceReq.data.result)) / 1e18;
    const txCount = parseInt(txCountReq.data.result, 16);

    const scoreObj = computeScore({ txCount, balanceEth });

    return res.json({
      balance: balanceEth.toFixed(4),
      txCount,
      score: scoreObj.score,
      rank: scoreObj.rank,
      network: networkConfig.key,
      networkLabel: networkConfig.label,
      nativeSymbol: networkConfig.nativeSymbol,
      analysis: transferAnalysis || null,
    });
  } catch (err) {
    console.error('API error:', err && err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
