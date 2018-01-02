const fetch = require('node-fetch')
const bcoin = require('bcoin')
const js = require('jsonfile')
const sleep = require('await-sleep')
const cs = require('coinstring')
const fs = require('fs')

const throttleTime = 200
const confFileName = './config.json'
const config = js.readFileSync(confFileName)

async function getUTXOS (keyObject) {
  let request = `${config.url}/addrs/${keyObject.addressToSweep}?unspentOnly=true&confirmation=1&limit=${config.limit}&token=${config.token}`
  console.log(request)
  let response = await fetch(request)
  let jsonObj = await response.json()
  let txs = jsonObj.txrefs
  let rawUTXO = []
  for (let i = 0; i < txs.length; i++) {
    let request = `${config.url}/txs/${txs[i].tx_hash}?includeHex=true&token=${config.token}`
    console.log(request)
    try {
      let response = await fetch(request)
      let jsonObj = await response.json()

      if (jsonObj && jsonObj.hex) {
        rawUTXO.push({
          rawTx: jsonObj.hex,
          index: txs[i].tx_output_n,
          height: txs[i].block_height
        })
      }
    } catch (e) {
      console.log(e)
    }
    await sleep(throttleTime)
  }
  return rawUTXO
}

async function createTX (utxos, keyObject) {
  const mtx = new bcoin.primitives.MTX()
  let amount = 0
  const coins = utxos.map(({ rawTx, index, height }) => { 
    const bufferTX = Buffer.from(rawTx, 'hex')
    const bcoinTX = bcoin.primitives.TX.fromRaw(bufferTX)
    const coin = bcoin.primitives.Coin.fromTX(bcoinTX, index, height)
    amount += coin.value
    return coin
  })

  const script = bcoin.script.fromAddress(config.destination)
  mtx.addOutput(script, amount)

  await mtx.fund(coins, {
    selection: 'value',
    subtractFee: true,
    rate: config.rate,
    changeAddress: keyObject.addressToSweep
  })
  let privateKey = cs.decode(keyObject.seed)
  privateKey = privateKey.slice(1, privateKey.length - 1)
  const key = bcoin.primitives.KeyRing.fromPrivate(privateKey, true)
  mtx.sign([key])

  return mtx
}

async function main () {
  try {
    fs.mkdirSync('out')
  } catch (e) {
    console.log(e)
  }
  for (const keyObject of config.keysToSweep) {
    const rawUtxo = await getUTXOS(keyObject)
    console.log('rawUtxo:', rawUtxo)
    const tx = await createTX(rawUtxo, keyObject)
    const txHex = tx.toRaw().toString('hex')
    console.log('tx: ', txHex)
    fs.writeFileSync(`out/${keyObject.addressToSweep}_tx.txt`, txHex + '\n')
  }
}

main()
//
// getUTXOS()
// .then(rawUTXO => {
//   console.log('rawUTXO', rawUTXO)
//   return createTX(rawUTXO)
// })
// .then(tx => {
//   console.log('tx', tx.toRaw().toString('hex'))
// })
//
//
//

