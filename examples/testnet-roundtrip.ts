// End-to-end on testnet: market entry with TP/SL, a resting limit, cancels, close.
// Uses CHALLENGE_ID from .env, else your newest active challenge. Size is tiny on purpose.
//   Put PRIVATE_KEY=0x... in .env (gitignored), then: npx tsx examples/testnet-roundtrip.ts
import { FairProp } from '../src/index'

try { process.loadEnvFile('.env') } catch {}  // optional; .env is gitignored

const fp = new FairProp({ network: 'testnet', privateKey: process.env.PRIVATE_KEY as `0x${string}` })

let challengeId = process.env.CHALLENGE_ID ? BigInt(process.env.CHALLENGE_ID) : undefined
if (challengeId === undefined) for (const id of (await fp.challenges.list()).reverse()) {
  if ((await fp.challenges.get(id)).status === 'active') { challengeId = id; break }
}
if (challengeId === undefined) throw new Error(`no active challenge for ${fp.address}`)
console.log(`challenge #${challengeId}`)

const stop = fp.fills.watch(challengeId, (f) => console.log(`  fill #${f.assetId} @ ${f.price} → size ${f.newSize}, pnl ${f.realizedPnl}, fee ${f.fee}`))

const mark = await fp.markPrice('BTC')
console.log(`BTC mark ${mark}`)

const entry = await fp.orders.market({
  challengeId, asset: 'BTC', side: 'buy', size: 0.001, leverage: 2,
  tp: Math.round(mark * 1.05), sl: Math.round(mark * 0.95),
})
console.log('market buy', entry.txHash, 'tp/sl', entry.tpslOrderIds)

const limit = await fp.orders.limit({ challengeId, asset: 'ETH', side: 'buy', size: 0.01, price: Math.round((await fp.markPrice('ETH')) * 0.8), leverage: 2 })
console.log('resting ETH limit', limit.ids)

console.log('open orders', (await fp.orders.open(challengeId)).map((o) => `${o.nonce.slice(0, 8)}… ${o.isBuy ? 'buy' : 'sell'} @ ${o.price} ${o.status}`))

for (const id of [...limit.ids, ...(entry.tpslOrderIds ?? [])]) console.log('cancel', await fp.orders.cancel(challengeId, id))

console.log('close', (await fp.orders.close({ challengeId, asset: 'BTC' })).txHash)
console.log('positions', await fp.positions(challengeId))

await new Promise((r) => setTimeout(r, 5_000))
stop()
