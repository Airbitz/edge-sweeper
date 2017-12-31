const fetch = require('node-fetch')
const bcoin = require('bcoin')
const js = require('jsonfile')
const sleep = require('await-sleep')

const throttleTime = 200
const confFileName = './conf.json'
const config = js.readFileSync(confFileName)

async function getUTXOS (address) {
  let request = `${config.url}/addrs/${config.addressToSweep}?unspentOnly=true&limit=${config.limit}&token=${config.token}`
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

async function createTX (utxos) {
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
    changeAddress: config.addressToSweep
  })
  let privateKey = null

  try {
    const mnemonic = bcoin.hd.Mnemonic.fromPhrase(config.seed)
    privateKey = bcoin.hd.PrivateKey.fromMnemonic(mnemonic)
  } catch (e) {
    const keyBuffer = Buffer.from(config.seed, 'hex')
    const entropy = Buffer.from(config.seed, 'hex')
    privateKey = bcoin.hd.PrivateKey.fromKey(keyBuffer, entropy)
  }

  const key = bcoin.primitives.KeyRing.fromOptions({ privateKey })

  mtx.sign([key])

  return mtx
}


getUTXOS()
.then(rawUTXO => {
  console.log('rawUTXO', rawUTXO)
  return createTX(rawUTXO)
})
.then(tx => {
  console.log('tx', tx.toRaw().toString('hex'))
})

  


