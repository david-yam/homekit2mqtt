const path = require('path');
const config = require('yargs')
    .usage('Usage: $0 [options]')
    .describe('v', 'possible values: "error", "warn", "info", "debug"')
    .describe('m', 'JSON file containing HomeKit Services to MQTT mapping definitions. See Readme.')
    .describe('n', 'instance name. used as mqtt client id and as prefix for connected topic')
    .describe('u', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('s', 'directory to store homekit data')
    .describe('h', 'show help')
    .alias({
        h: 'help',
        n: 'name',
        m: 'mapfile',
        u: 'url',
        v: 'verbosity',
        c: 'pincode',
        a: 'username',
        b: 'bridgename',
        p: 'port',
        s: 'storagedir'
    })
    .default({
        c: '031-45-154',
        u: 'mqtt://127.0.0.1',
        n: 'homekit',
        m: path.join(__dirname, '/example-homekit2mqtt.json'),
        v: 'info',
        a: 'CC:22:3D:E3:CE:F6',
        b: 'MQTT Bridge',
        p: 51826
    })
    // .config('config')
    .version()
    .help('help')
    .argv;

module.exports = config;
