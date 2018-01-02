const fetch = require('node-fetch')
const bcoin = require('bcoin')
const js = require('jsonfile')
const sleep = require('await-sleep')
const cs = require('coinstring')
const fs = require('fs')

const throttleTime = 200
const confFileName = './config.json'
const config = js.readFileSync(confFileName)

const maxErrors = 10

async function getUTXOS (keyObject) {
  console.log('**********************************************************************')
  console.log('*********** Getting utxos for address: ' + keyObject.addressToSweep)
  let request = `${config.url}/addrs/${keyObject.addressToSweep}?unspentOnly=true&confirmation=1&limit=2000&token=${config.token}`
  console.log(request)
  let response
  let numErrors = 0
  while (1) {
    try {
      response = await fetch(request)
      break
    } catch (e) {
      numErrors++
      if (numErrors > maxErrors) {
        console.log('Hit max errors')
        return
      }
      console.log('Hit fetch error. Sleeping for ' + (throttleTime * numErrors).toString())
      await sleep(throttleTime * numErrors)
    }
  }
  let jsonObj = await response.json()
  let txs = jsonObj.txrefs
  let rawUTXO = []
  let numUtxoBlock = 0
  let i = 0
  numErrors = 0
  while (i < txs.length) {
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

        if (rawUTXO.length >= config.limit) {
          const rawUtxoLimitBlock = rawUTXO.slice(0)
          const tx = await createTX(rawUtxoLimitBlock, keyObject)
          const txHex = tx.toRaw().toString('hex')
          console.log('***** Hit limit. Creating tx *****')
          console.log('tx: ', txHex)
          fs.writeFileSync(`out/${keyObject.addressToSweep}_tx_${numUtxoBlock}.txt`, txHex + '\n')
          numUtxoBlock++
          rawUTXO = []
        }
      }
      numErrors = 0
      i++
    } catch (e) {
      console.log(e)
      numErrors++
      if (numErrors > maxErrors) {
        console.log('Hit max errors')
        return
      }
      console.log('Hit error. Sleeping for ' + (throttleTime * numErrors).toString())
      await sleep(throttleTime * numErrors)
    }
  }
  if (rawUTXO.length) {
    console.log('***** Creating final tx *****')
    const rawUtxoLimitBlock = rawUTXO.slice(0)
    const tx = await createTX(rawUtxoLimitBlock, keyObject)
    const txHex = tx.toRaw().toString('hex')
    console.log('tx: ', txHex)
    fs.writeFileSync(`out/${keyObject.addressToSweep}_tx_${numUtxoBlock}.txt`, txHex + '\n')
  }
  await sleep(throttleTime)
// return rawUTXO
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
    // console.log('rawUtxo:', rawUtxo)
    // const tx = await createTX(rawUtxo, keyObject)
    // const txHex = tx.toRaw().toString('hex')
    // console.log('tx: ', txHex)
    // fs.writeFileSync(`out/${keyObject.addressToSweep}_tx.txt`, txHex + '\n')
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

