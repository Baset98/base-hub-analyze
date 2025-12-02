/**
 * score.js
 *
 * Small helper to compute a simple score and rank for an account.
 * This is a simple, deterministic example used by the project; adjust
 * weights and thresholds to match your real scoring rules.
 *
 * Exports:
 * - computeScore({ txCount, balanceEth }) -> { score, rank, details }
 */

'use strict';

/**
 * Compute a numeric score and a human-friendly rank.
 *
 * @param {Object} opts
 * @param {number} opts.txCount    - number of transactions (integer)
 * @param {number} opts.balanceEth - account balance in ETH (number)
 * @returns {{score:number, rank:string, details:Object}}
 */
function computeScore(opts = {}) {
  const txCount = Number(opts.txCount || 0);
  const balanceEth = Number(opts.balanceEth || 0);

  // Simple scoring formula: transactions weighted + balance weighted
  const scoreFromTx = txCount * 10;
  const scoreFromBalance = Math.floor(balanceEth * 50);
  const score = scoreFromTx + scoreFromBalance;

  // Derive a rank from the score
  let rank = 'Newbie';
  if (score > 100) rank = 'Explorer';
  if (score > 500) rank = 'Base Believer';
  if (score > 2000) rank = 'Base OG';

  return {
    score,
    rank,
    details: {
      txCount,
      balanceEth,
      scoreFromTx,
      scoreFromBalance,
    },
  };
}

module.exports = {
  computeScore,
};
