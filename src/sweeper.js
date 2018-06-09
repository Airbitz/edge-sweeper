// @flow

const fetch = require('node-fetch')
const bcoin = require('bcoin')
const js = require('jsonfile')
const cs = require('coinstring')
const fs = require('fs')
const net = require('net')
const tls = require('tls')

const confFileName = './config.json'
const config = js.readFileSync(confFileName)
const _serverUrl = 'electrum://electrum-bu-az-wusa2.airbitz.co:50001'
const maxErrors = 10

async function makeSweep (keyObject, destination) {
  console.log('**********************************************************************')
  console.log('*********** Getting utxos for address: ' + keyObject.addressToSweep)
  // let request = `${config.url}/addrs/${keyObject.addressToSweep}?unspentOnly=true&confirmation=1&limit=2000&token=${config.token}`
  // console.log(request)
  // let response
  let numErrors = 0
  // while (1) {
  //   try {
  //     response = await fetch(request)
  //     break
  //   } catch (e) {
  //     numErrors++
  //     if (numErrors > maxErrors) {
  //       console.log('Hit max errors')
  //       return
  //     }
  //     console.log('Hit fetch error. Sleeping for ' + (throttleTime * numErrors).toString())
  //     await sleep(throttleTime * numErrors)
  //   }
  // }
  // let jsonObj = await response.json()
  let txs = await getUtxos(keyObject.addressToSweep)
  console.log(`getUtxos:${keyObject.addressToSweep}:length:${txs.length}`)

  let rawUTXO = []
  let numUtxoBlock = 0
  let i = 0
  console.log('txs.length=' + txs.length.toString())
  while (i < txs.length) {
    try {
      // $FlowFixMe
      const jsonObj = await getTx(txs[i].tx_hash)

      // if (rawTx) {
      if (jsonObj) {
        rawUTXO.push({
          // rawTx,
          rawTx: jsonObj,
          index: txs[i].tx_pos,
          height: txs[i].height
        })

        if (rawUTXO.length >= config.limit) {
          const rawUtxoLimitBlock = rawUTXO.slice(0)
          const tx = await createTX(rawUtxoLimitBlock, keyObject, destination)
          const txHex = tx.toRaw().toString('hex')
          console.log('***** Hit limit. Creating tx *****')
          console.log('sub tx: ', txHex)
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
    }
  }
  if (rawUTXO.length) {
    console.log('***** Creating final tx *****')
    const rawUtxoLimitBlock = rawUTXO.slice(0)
    const tx = await createTX(rawUtxoLimitBlock, keyObject, destination)
    const txHex = tx.toRaw().toString('hex')
    console.log('final tx: ', txHex)
    fs.writeFileSync(`out/${keyObject.addressToSweep}_tx_${numUtxoBlock}.txt`, txHex + '\n')
  }
}

async function createTX (utxos, keyObject, destination) {
  const mtx = new bcoin.primitives.MTX()
  let amount = 0
  const coins = utxos.map(({ rawTx, index, height }) => {
    const bufferTX = Buffer.from(rawTx, 'hex')
    const bcoinTX = bcoin.primitives.TX.fromRaw(bufferTX)
    const coin = bcoin.primitives.Coin.fromTX(bcoinTX, index, height)
    amount += coin.value
    return coin
  })

  const script = bcoin.script.fromAddress(destination)
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
  if (process.argv[2] === 'pushtx') {
    const dir = fs.readdirSync('out/')
    for (const f of dir) {
      try {
        console.log('reading file: ' + f)
        const file = fs.readFileSync('out/' + f, 'utf8')
        console.log('pushtx file: ' + f)
        await fetch('https://blockchain.info/pushtx', {
          method: 'POST',
          body: 'tx=' + file,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      } catch (e) {
        console.log(e)
      }
    }
    return
  }

  try {
    fs.mkdirSync('out')
  } catch (e) {
    console.log(e)
  }
  for (const group of config.groups) {
    console.log('*********************************************')
    console.log('*********************************************')
    console.log(`****** Sweeping group ${group.name}`)
    console.log('*********************************************')
    console.log('*********************************************')
    for (const keyObject of group.keysToSweep) {
      await makeSweep(keyObject, group.destination)
    }
  }
}

// async function main () {
//   const out = await makeSweep('62911fa980bc60100c0c42a4936b1560a32e21211a8aa5b3ebaa2a32931f3349')
//   console.log(`****${out}****`)
// }

main()

async function getTx (txid: string): Promise<Object> {
  const serverUrl = _serverUrl
  return new Promise((resolve) => {
    console.log('*********** getTx:' + txid)
    // let regex = new RegExp(/electrum:\/\/(.*):(.*)/)
    let regex
    let ssl = false
    if (typeof serverUrl !== 'string') {
      resolve({})
    }
    if (serverUrl.startsWith('electrums:')) {
      regex = new RegExp(/electrums:\/\/(.*):(.*)/)
      ssl = true
    } else {
      regex = new RegExp(/electrum:\/\/(.*):(.*)/)
    }
    let results = regex.exec(serverUrl)
    let resolved = false
    let client

    if (results !== null) {
      const port = results[2]
      const host = results[1]
      let tcp
      if (ssl) {
        tcp = tls
      } else {
        tcp = net
      }
      client = tcp.connect({ port, host, rejectUnauthorized: false }, () => {
        // console.log('connect')
        const query = `{ "id": 1, "method": "blockchain.transaction.get", "params": ["${txid}"] }\n`
        if (client) {
          client.write(query)
        }
        // console.log('query:' + query + '***')
      })
    } else {
      resolve({})
    }
    let out = {}

    let jsonData = ''

    if (client) {
      client.on('data', (data) => {
        let results = data.toString('ascii')
        // console.log(results)
        let resultObj
        try {
          resultObj = JSON.parse(jsonData + results)
        } catch (e) {
          jsonData += results
          return {}
        }

        if (resultObj !== null) {
          out = resultObj.result
        }
        // console.log(dateString())
        // console.log('-------------- FINISHED getTx: ' + serverUrl)
        if (client) {
          client.write('Goodbye!!!')
          client.destroy()
        }
        resolved = true
        resolve(out)
      })

      client.on('error', function (err) {
        const e = err.code ? err.code : ''
        // console.log(dateString())
        console.log('getTx:' + serverUrl + ' ERROR:' + e)
        resolved = true
        resolve({})
      })

      client.on('close', function () {
        // console.log(dateString())
        // console.log('CLOSE getTx:' + serverUrl)
        resolved = true
        resolve({})
      })

      setTimeout(() => {
        if (!resolved && client) {
          client.write('Goodbye!!!')
          client.destroy()
          // console.log(dateString())
          console.log('TIMEOUT getTx:' + serverUrl)
          resolve({})
        }
      }, 10000)
    }
  })
}

async function getUtxos (address: string): Promise<Array<Object>> {
  const serverUrl = _serverUrl
  return new Promise((resolve) => {
    console.log('*********** getUtxo:' + address)
    // let regex = new RegExp(/electrum:\/\/(.*):(.*)/)
    let regex
    let ssl = false
    if (typeof serverUrl !== 'string') {
      resolve([])
    }
    if (serverUrl.startsWith('electrums:')) {
      regex = new RegExp(/electrums:\/\/(.*):(.*)/)
      ssl = true
    } else {
      regex = new RegExp(/electrum:\/\/(.*):(.*)/)
    }
    let results = regex.exec(serverUrl)
    let resolved = false
    let client

    if (results !== null) {
      const port = results[2]
      const host = results[1]
      let tcp
      if (ssl) {
        tcp = tls
      } else {
        tcp = net
      }
      client = tcp.connect({ port, host, rejectUnauthorized: false }, () => {
        // console.log('connect')
        const query = `{ "id": 1, "method": "blockchain.address.listunspent", "params": ["${address}"] }\n`
        client.write(query)
        // console.log('query:' + query + '***')
      })
    } else {
      resolve([])
      return
    }
    let utxos = []

    let jsonData = ''

    client.on('data', (data) => {
      let results = data.toString('ascii')
      // console.log(results)
      let resultObj
      try {
        resultObj = JSON.parse(jsonData + results)
      } catch (e) {
        jsonData += results
        return
      }

      if (resultObj !== null) {
        utxos = resultObj.result
      }
      // console.log(dateString())
      // console.log('-------------- FINISHED getUtxo: ' + serverUrl)
      client.write('Goodbye!!!')
      client.destroy()
      resolved = true
      resolve(utxos)
    })

    client.on('error', function (err) {
      const e = err.code ? err.code : ''
      // console.log(dateString())
      console.log('getUtxo:' + serverUrl + ' ERROR:' + e)
      resolved = true
      resolve([])
    })

    client.on('close', function () {
      // console.log(dateString())
      console.log('CLOSE getUtxo:' + serverUrl)
      resolved = true
      resolve([])
    })

    setTimeout(() => {
      if (!resolved) {
        client.write('Goodbye!!!')
        client.destroy()
        // console.log(dateString())
        console.log('TIMEOUT getUtxo:' + serverUrl)
        resolve([])
      }
    }, 10000)
  })
}
