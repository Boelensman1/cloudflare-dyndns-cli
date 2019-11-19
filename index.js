/* eslint-disable no-await-in-loop, no-console */
const Cloudflare = require('cloudflare')
const { prompt, MultiSelect } = require('enquirer')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const publicIp = require('public-ip')

const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({ ddns: [], ip: false }).write()

const getConfig = async () => {
  if (!db.has('auth').value()) {
    const response = await prompt([
      {
        type: 'input',
        name: 'email',
        message: 'What is your email?',
      },
      {
        type: 'input',
        name: 'key',
        message: 'What is your key?',
      },
    ])
    db.set('auth', response).write()
  }
  const auth = db.get('auth').value()

  const cf = new Cloudflare(auth)

  if (!db.has('zones').value()) {
    const cfZones = (await cf.zones.browse()).result
    const response = (
      await new MultiSelect({
        name: 'value',
        message: 'Select zone(s) to run for',
        choices: cfZones.map((z) => ({ name: z.name })),
      }).run()
    ).map((name) => ({
      name,
      id: cfZones.find((z) => z.name === name).id,
    }))
    db.set('zones', response).write()
  }

  const zones = db.get('zones').value()

  for (let i = 0; i < zones.length; i += 1) {
    const zone = zones[i]
    if (
      !db
        .get('ddns')
        .find({ id: zone.id })
        .value()
    ) {
      const cfDnsrecords = (await cf.dnsRecords.browse(zone.id)).result.filter(
        (d) => d.type === 'A',
      )
      const response = (
        await new MultiSelect({
          name: 'value',
          message: 'Select dns records(s) to run for',
          choices: cfDnsrecords.map((d) => ({ name: d.name })),
        }).run()
      ).map((name) => ({
        name,
        cfRecord: cfDnsrecords.find((d) => d.name === name),
      }))
      db.get('ddns')
        .push({ ...zone, records: response })
        .write()
    }
  }

  const ddns = db.get('ddns').value()
  const ip = db.get('ip').value()

  return {
    cf,
    ddns,
    ip,
  }
}

const main = async () => {
  const [config, ip] = await Promise.all([getConfig(), publicIp.v4()])
  if (!ip === config.ip) {
    config.ddns.forEach((zone) => {
      zone.records.forEach((record) => {
        console.log('Updating', zone.name, '-', record.name)
        config.cf.dnsRecords.edit(zone.id, record.cfRecord.id, {
          ...record.cfRecord,
          content: ip,
        })
      })
    })
  }
  db.set('ip', ip).write()
}

main()
