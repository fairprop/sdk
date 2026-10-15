// Read-only tour: markets, your challenges, positions. No transactions.
//   Put PRIVATE_KEY=0x... in .env (gitignored), then: npx tsx examples/read-only.ts
import { FairProp } from '../src/index'

try { process.loadEnvFile('.env') } catch {}  // optional; .env is gitignored
import { generatePrivateKey } from 'viem/accounts'

const fp = new FairProp({
  
  privateKey: (process.env.PRIVATE_KEY as `0x${string}`) ?? generatePrivateKey(),
})

const markets = await fp.markets()
console.log(`${markets.length} markets, e.g.`, markets.filter((m) => ['BTC', 'ETH', 'xyz:NVDA', 'xyz:GOLD'].includes(m.symbol))
  .map((m) => `${m.symbol} (#${m.assetId}) ${m.markPx}`).join(', '))

const ids = await fp.challenges.list()
console.log(`wallet ${fp.address}: ${ids.length} challenge(s)`)
for (const id of ids) {
  const [c, s, positions, orders] = await Promise.all([
    fp.challenges.get(id), fp.challenges.state(id), fp.positions(id), fp.orders.open(id),
  ])
  console.log(`#${id} ${c.status} $${c.rules.accountSize} equity ${s.equity} drawdown ${s.drawdownPct}%`)
  for (const p of positions) console.log(`  ${p.side} ${p.size} ${p.symbol} @ ${p.entryPx} ${p.leverage}x`)
  for (const o of orders) console.log(`  order ${o.isBuy ? 'buy' : 'sell'} ${o.size} #${o.assetId} @ ${o.price} ${o.status}${o.reduceOnly ? ' reduce-only' : ''}`)
}
