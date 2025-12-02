/**
 * lib/score.js
 *
 * Small helper to compute a simple score and rank for an account.
 */

'use strict';

function computeScore(opts = {}) {
  const txCount = Number(opts.txCount || 0);
  const balanceEth = Number(opts.balanceEth || 0);

  const scoreFromTx = txCount * 10;
  const scoreFromBalance = Math.floor(balanceEth * 50);
  const score = scoreFromTx + scoreFromBalance;

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

module.exports = { computeScore };
