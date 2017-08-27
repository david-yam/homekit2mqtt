#!/usr/bin/env node

require('should');

const cp = require('child_process');
const path = require('path');
const streamSplitter = require('stream-splitter');
const Mqtt = require('mqtt');

mqtt = Mqtt.connect('mqtt://127.0.0.1');

const config = require(__dirname + '/test-homekit2mqtt.json');

const homekitCmd = path.join(__dirname, '/../index.js');

function randomHex() {
    return ('0' + Math.floor(Math.random() * 0xff)).slice(-2);
}

const homekitArgs = ['-m', __dirname + '/test-homekit2mqtt.json', '-v', 'debug', '-a', 'CC:22:3D:' + randomHex() + ':' + randomHex() + ':' + randomHex()];
let homekit;
let homekitPipeOut;
let homekitPipeErr;
const homekitSubscriptions = {};
const homekitBuffer = [];

let subIndex = 0;

const clientCmd = path.join(__dirname, '/../node_modules/.bin/hap-client-tool -d 127.0.0.1 -p 51826');
let clientAccs;


const mqttSubscriptions = {};
function mqttSubscribe(topic, callback) {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic].push(callback);
        return mqttSubscriptions[topic] - 1;
    } else {
        mqttSubscriptions[topic] = [callback];
        mqtt.subscribe(topic);
        return 0;
    }
}
mqtt.on('message', (topic, payload) => {
    if (mqttSubscriptions[topic]) {
        mqttSubscriptions[topic].forEach((callback, index) => {
            callback(payload.toString());
        });
    }
});

function mqttUnsubscribe(topic, id) {
    mqttSubscriptions[topic].splice(id, 1);
}

function subscribe(type, rx, cb) {
    subIndex += 1;
    if (type === 'sim') {
        simSubscriptions[subIndex] = {rx, cb};
    } else if (type === 'homekit') {
        homekitSubscriptions[subIndex] = {rx, cb};
    }
    matchSubscriptions(type);
    return subIndex;
}

function unsubscribe(type, subIndex) {
    if (type === 'sim') {
        delete simSubscriptions[subIndex];
    } else if (type === 'homekit') {
        delete homekitSubscriptions[subIndex];
    }
}

function matchSubscriptions(type, data) {
    let subs;
    let buf;
    if (type === 'sim') {
        subs = simSubscriptions;
        buf = simBuffer;
    } else if (type === 'homekit') {
        subs = homekitSubscriptions;
        buf = homekitBuffer;
    }
    if (data) {
        buf.push(data);
    }
    buf.forEach((line, index) => {
        Object.keys(subs).forEach(key => {
            const sub = subs[key];
            if (line.match(sub.rx)) {
                sub.cb(line);
                delete subs[key];
                buf.splice(index, 1);
            }
        });
    });
}

function startHomekit() {
    homekit = cp.spawn(homekitCmd, homekitArgs);
    homekitPipeOut = homekit.stdout.pipe(streamSplitter('\n'));
    homekitPipeErr = homekit.stderr.pipe(streamSplitter('\n'));
    homekitPipeOut.on('token', data => {
        console.log('homekit', data.toString());
        matchSubscriptions('homekit', data.toString());
    });
    homekitPipeErr.on('token', data => {
        console.log('homekit', data.toString());
        matchSubscriptions('homekit', data.toString());
    });
}

function end(code) {
    if (homekit.kill) {
        homekit.kill();
    }
    if (typeof code !== 'undefined') {
        process.exit(code);
    }
}

process.on('SIGINT', () => {
    end(1);
});

process.on('exit', () => {
    end();
});

describe('start homekit2mqtt', () => {
    it('should start without error', function (done) {
        this.timeout(20000);
        subscribe('homekit', /homekit2mqtt [0-9.]+ starting/, () => {
            done();
        });
        startHomekit();
    });
    it('should create accessories', function (done) {
        this.timeout(20000);
        subscribe('homekit', /hap created [0-9]+ Accessories/, () => {
            done();
        });
    });
    it('should announce the bridge', function (done) {
        subscribe('homekit', /hap publishing bridge/, () => {
            done();
        });
    });
    it('should listen on port 51826', function (done) {
        subscribe('homekit', /hap Bridge listening on port 51826/, () => {
            done();
        });
    });
});

describe('homekit2mqtt - mqtt connection', () => {
    it('homekit2mqtt should connect to the mqtt broker', function (done) {
        this.timeout(36000);
        subscribe('homekit', /mqtt connected/, () => {
            done();
        });
    });
    it('should publish connected=2 on mqtt', function (done) {
        mqttSubscribe('homekit/connected', function (payload) {
            if (payload === '2') {
                done();
            }
        });
    });
});

let aid = {};
let iid = {};
/*
if (process.platform !== 'darwin' && process.env.TRAVIS) {
    describe('start dbus', function () {

        it('should start dbus', done => {
            cp.exec('dbus-launch', (err, stdout, stderr) => {
		if (!err) {
                	setTimeout(done, 3000);
		}
            });
        });
    });
}
*/

describe('hap-client - homekit2mqtt pairing', function () {
    this.timeout(180000);
    it('should pair without error', function (done) {
        this.timeout(180000);
        subscribe('homekit', /hap paired/, () => {
            setTimeout(function () {
                done();
            }, 3000);
        });

        console.log('--- trying to pair...');
        try {
            var pair = cp.spawn(path.join(__dirname, '/../node_modules/.bin/hap-client-tool'), ['-d', '127.0.0.1', '-p', '51826', 'pair']);

            pair.on('close', (code) => {
                console.log(`--- pair close - child process exited with code ${code}`);
            });
            pair.on('exit', (code) => {
                console.log(`--- pair exit- child process exited with code ${code}`);
            });
            pair.on('error', (err) => {
                console.log('--- pair error - Failed to start child process.', err);
            });
            pair.stdout.on('data', data => {
                data = data.toString();
                console.log('pair stdout', data);
                if (data.match(/pin code/)) {
                    console.log('--- writing pin to stdin');
                    pair.stdin.write('031-45-154\n');
                    pair.stdin.write('\n');
                }
            });
            pair.stderr.on('data', data => {
                console.log('pair stderr', data.toString());
            });
        } catch (err) {
            console.log('...', err);
        }


    });


});

describe('hap-client - homekit2mqtt', function () {
    this.retries(5);
    it('should be able to dump accessories', function (done) {
        this.timeout(36000);
        this.retries(5);

        cp.exec(clientCmd + ' dump', {maxBuffer: 1024 * 2048}, (err, stdout, stderr) => {
            console.log(err, stderr);
            if (err) {
                done(err);
            }
            let clientAccs;
            try {
                clientAccs = JSON.parse(stdout).accessories;
            } catch (err) {
                done(err);
            }
            clientAccs.forEach(acc => {
                let name;
                let iidTmp = {};

                acc.services.forEach(service => {
                    service.characteristics.forEach(ch => {
                        iidTmp[String(ch.Name).replace(/ /g, '')] = ch.iid;
                        if (ch.Name === 'Name') {
                            name = ch.value
                        }
                    });

                });
                aid[name] = acc.aid;
                iid[name] = iidTmp;
            });

            // add one because the bridge itself is also an accessory
            if (clientAccs.length === (Object.keys(config).length + 1)) {
                done();
            } else {
                done(new Error('wrong clientAccs length'));
            }
        });
    });
});

describe('Fan', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Fan On true/, () => {
            done();
        });
        mqtt.publish('Fan/status', 'true');
    });
    it('client should get the status of the Fan', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Fan + ' --iid ' + iid.Fan.On, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Fan/set', payload => {
            if (payload === 'true') {
                mqttUnsubscribe('Fan/set', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Fan + ' --iid ' + iid.Fan.On + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Fan/set', payload => {
            if (payload === 'false') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Fan + ' --iid ' + iid.Fan.On + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Fan RotationSpeed', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Fan RotationSpeed 80/, () => {
            done();
        });
        mqtt.publish('Fan/status/RotationSpeed', '80');
    });
    it('client should get the status of the Fan', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Fan + ' --iid ' + iid.Fan.RotationSpeed, (err, stdout, stderr) => {
            if (stdout === '80\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Fan/set/RotationSpeed', payload => {
            if (payload === '20') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Fan + ' --iid ' + iid.Fan.RotationSpeed + ' 20';
        console.log(cmd);
        cp.exec(cmd);
    });
});

describe('Fan RotationDirection', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Fan RotationDirection 1/, () => {
            done();
        });
        mqtt.publish('Fan/status/RotationDirection', 'left');
    });
    it('client should get the status of the Fan', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Fan + ' --iid ' + iid.Fan.RotationDirection, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Fan/set/RotationDirection', payload => {
            if (payload === 'right') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Fan + ' --iid ' + iid.Fan.RotationDirection + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });
});


describe('Lightbulb', () => {


    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb On true/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status', '1');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.On, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb On false/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status', '0');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.On, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Lightbulb/set', payload => {
            if (payload === '254') {
                mqttUnsubscribe('Lightbulb/set', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.On + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb On true/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status', '254');
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Lightbulb/set', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.On + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});


describe('Lightbulb Brightness', () => {


    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Brightness 100/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Brightness', '254');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Brightness, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Brightness 0/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Brightness', '0');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Brightness, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Lightbulb/set/Brightness', payload => {
            if (payload === '254') {
                mqttUnsubscribe('Lightbulb/set/Brightness', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Brightness + ' 100';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Brightness 100/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Brightness', '254');
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Lightbulb/set/Brightness', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Brightness + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});
/* TODO iid.Lightbulb.ColorTemperature undefined...
describe('Lightbulb ColorTemperature', () => {


    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb ColorTemperature 254/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/ColorTemperature', '254');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.ColorTemperature, (err, stdout, stderr) => {
            if (stdout === '254\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb ColorTemperature 330/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/ColorTemperature', '330');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.ColorTemperature, (err, stdout, stderr) => {
            if (stdout === '330\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Lightbulb/set/ColorTemperature', payload => {
            if (payload === '254') {
                mqttUnsubscribe('Lightbulb/set/ColorTemperature', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.ColorTemperature + ' 254';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb ColorTemperature 200/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/ColorTemperature', '200');
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Lightbulb/set/ColorTemperature', payload => {
            if (payload === '200') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.ColorTemperature + ' 200';
        console.log(cmd);
        cp.exec(cmd);
    });

});
*/
describe('Lightbulb Saturation', () => {


    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Saturation 100/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Saturation', '254');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Saturation, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Saturation 0/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Saturation', '0');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Saturation, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Lightbulb/set/Saturation', payload => {
            if (payload === '254') {
                mqttUnsubscribe('Lightbulb/set/Saturation', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Saturation + ' 100';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Saturation 100/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Saturation', '254');
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Lightbulb/set/Saturation', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Saturation + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Lightbulb Hue', () => {


    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Hue 360/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Hue', '65535');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Hue, (err, stdout, stderr) => {
            if (stdout === '360\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Hue 0/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Hue', '0');
    });
    it('client should get the status of the Lightbulb', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Hue, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Lightbulb/set/Hue', payload => {
            if (payload === '65535') {
                mqttUnsubscribe('Lightbulb/set/Hue', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Hue + ' 360';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Lightbulb Hue 360/, () => {
            done();
        });
        mqtt.publish('Lightbulb/status/Hue', '65535');
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Lightbulb/set/Hue', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Lightbulb + ' --iid ' + iid.Lightbulb.Hue + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Switch', () => {
    it('should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Switch1 On true/, () => {
            done();
        });
        mqtt.publish('Switch/status', '1');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Switch1 On false/, () => {
            done();
        });
        mqtt.publish('Switch/status', '0');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Switch/set', payload => {
            if (payload === '1') {
                mqttUnsubscribe('Switch/set', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Switch/set', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Switch1 + ' --iid ' + iid.Switch1.On + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('HumiditySensor', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update HumiditySensor CurrentRelativeHumidity 21/, () => {
            done();
        });
        mqtt.publish('HumiditySensor/status', '21');
    });
    it('client should get the temperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.HumiditySensor + ' --iid ' + iid.HumiditySensor.CurrentRelativeHumidity, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
});

testLowBattery('HumiditySensor');

describe('LightSensor', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update LightSensor CurrentAmbientLightLevel 21/, () => {
            done();
        });
        mqtt.publish('LightSensor/Brightness', '21');
    });
    it('client should get the Brightness', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.LightSensor + ' --iid ' + iid.LightSensor.CurrentAmbientLightLevel, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
});

testLowBattery('LightSensor');

describe('TemperatureSensor', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update TemperatureSensor CurrentTemperature 21/, () => {
            done();
        });
        mqtt.publish('TemperatureSensor/Temperature', '21');
    });
    it('client should get the temperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.TemperatureSensor + ' --iid ' + iid.TemperatureSensor.CurrentTemperature, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
});

testLowBattery('TemperatureSensor');

describe('TemperatureSensor Fahrenheit', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update TemperatureSensorF CurrentTemperature 20/, () => {
            done();
        });
        mqtt.publish('TemperatureSensorF/Temperature', '68');
    });
    it('client should get the temperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.TemperatureSensorF + ' --iid ' + iid.TemperatureSensorF.CurrentTemperature, (err, stdout, stderr) => {
            if (stdout === '20\n') {
                done();
            }
        });
    });
});

describe('ContactSensor ContactSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update ContactSensor ContactSensorState 1/, () => {
            done();
        });
        mqtt.publish('ContactSensor/status', '1');
    });
    it('client should get the status of the ContactSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ContactSensor + ' --iid ' + iid.ContactSensor.ContactSensorState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update ContactSensor ContactSensorState 0/, () => {
            done();
        });
        mqtt.publish('ContactSensor/status', '0');
    });
    it('client should get the status of the ContactSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ContactSensor + ' --iid ' + iid.ContactSensor.ContactSensorState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('ContactSensor');

describe('MotionSensor MotionSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update MotionSensor MotionDetected true/, () => {
            done();
        });
        mqtt.publish('MotionSensor/status', '1');
    });
    it('client should get the status of the MotionSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.MotionSensor + ' --iid ' + iid.MotionSensor.MotionDetected, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update MotionSensor MotionDetected false/, () => {
            done();
        });
        mqtt.publish('MotionSensor/status', '0');
    });
    it('client should get the status of the MotionSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.MotionSensor + ' --iid ' + iid.MotionSensor.MotionDetected, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });
});

testLowBattery('MotionSensor');

describe('OccupancySensor OccupancySensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update OccupancySensor OccupancyDetected true/, () => {
            done();
        });
        mqtt.publish('OccupancySensor/status', '1');
    });
    it('client should get the status of the OccupancySensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.OccupancySensor + ' --iid ' + iid.OccupancySensor.OccupancyDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update OccupancySensor OccupancyDetected false/, () => {
            done();
        });
        mqtt.publish('OccupancySensor/status', '0');
    });
    it('client should get the status of the OccupancySensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.OccupancySensor + ' --iid ' + iid.OccupancySensor.OccupancyDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('OccupancySensor');

describe('SmokeSensor SmokeSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update SmokeSensor SmokeDetected 1/, () => {
            done();
        });
        mqtt.publish('SmokeSensor/status', '1');
    });
    it('client should get the status of the SmokeSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.SmokeSensor + ' --iid ' + iid.SmokeSensor.SmokeDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update SmokeSensor SmokeDetected 0/, () => {
            done();
        });
        mqtt.publish('SmokeSensor/status', '0');
    });
    it('client should get the status of the SmokeSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.SmokeSensor + ' --iid ' + iid.SmokeSensor.SmokeDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('SmokeSensor');

describe('CarbonMonoxideSensor CarbonMonoxideSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update CarbonMonoxideSensor CarbonMonoxideDetected 1/, () => {
            done();
        });
        mqtt.publish('CarbonMonoxideSensor/status', '1');
    });
    it('client should get the status of the CarbonMonoxideSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonMonoxideSensor + ' --iid ' + iid.CarbonMonoxideSensor.CarbonMonoxideDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update CarbonMonoxideSensor CarbonMonoxideDetected 0/, () => {
            done();
        });
        mqtt.publish('CarbonMonoxideSensor/status', '0');
    });
    it('client should get the status of the CarbonMonoxideSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonMonoxideSensor + ' --iid ' + iid.CarbonMonoxideSensor.CarbonMonoxideDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('CarbonMonoxideSensor');

describe('CarbonDioxideSensor CarbonDioxideSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update CarbonDioxideSensor CarbonDioxideDetected 1/, () => {
            done();
        });
        mqtt.publish('CarbonDioxideSensor/status', '1');
    });
    it('client should get the status of the CarbonDioxideSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonDioxideSensor + ' --iid ' + iid.CarbonDioxideSensor.CarbonDioxideDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update CarbonDioxideSensor CarbonDioxideDetected 0/, () => {
            done();
        });
        mqtt.publish('CarbonDioxideSensor/status', '0');
    });
    it('client should get the status of the CarbonDioxideSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.CarbonDioxideSensor + ' --iid ' + iid.CarbonDioxideSensor.CarbonDioxideDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('CarbonDioxideSensor');

describe('LeakSensor LeakSensorState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update LeakSensor LeakDetected 1/, () => {
            done();
        });
        mqtt.publish('LeakSensor/status', '1');
    });
    it('client should get the status of the LeakSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.LeakSensor + ' --iid ' + iid.LeakSensor.LeakDetected, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update LeakSensor LeakDetected 0/, () => {
            done();
        });
        mqtt.publish('LeakSensor/status', '0');
    });
    it('client should get the status of the LeakSensor', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.LeakSensor + ' --iid ' + iid.LeakSensor.LeakDetected, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

testLowBattery('LeakSensor');


describe('Doorbell', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap set Doorbell ProgrammableSwitchEvent 1/, () => {
            done();
        });
        mqtt.publish('Doorbell/status', '1');
    });
});





describe('Outlet', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Outlet On true/, () => {
            done();
        });
        mqtt.publish('Outlet/status', '1');
    });
    it('client should get the status of the Outlet', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Outlet + ' --iid ' + iid.Outlet.On, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        let id = mqttSubscribe('Outlet/set', payload => {
            if (payload === '1') {
                mqttUnsubscribe('Outlet/set', id);
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Outlet + ' --iid ' + iid.Outlet.On + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Outlet/set', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Outlet + ' --iid ' + iid.Outlet.On + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Outlet OutletInUse', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Outlet OutletInUse true/, () => {
            done();
        });
        mqtt.publish('Outlet/status/OutletInUse', '1');
    });
    it('client should get the status of the Outlet', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Outlet + ' --iid ' + iid.Outlet.OutletInUse, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
});


describe('SecuritySystem CurrentState', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update SecuritySystem SecuritySystemCurrentState 1/, () => {
            done();
        });
        mqtt.publish('SecuritySystem/status/CurrentState', '1');
    });
    it('client should get the status of the SecuritySystem', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.SecuritySystem + ' --iid ' + iid.SecuritySystem.SecuritySystemCurrentState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update SecuritySystem SecuritySystemCurrentState 0/, () => {
            done();
        });
        mqtt.publish('SecuritySystem/status/CurrentState', '0');
    });
    it('client should get the status of the SecuritySystem', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.SecuritySystem + ' --iid ' + iid.SecuritySystem.SecuritySystemCurrentState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update SecuritySystem SecuritySystemCurrentState 4/, () => {
            done();
        });
        mqtt.publish('SecuritySystem/status/CurrentState', '4');
    });
    it('client should get the status of the SecuritySystem', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.SecuritySystem + ' --iid ' + iid.SecuritySystem.SecuritySystemCurrentState, (err, stdout, stderr) => {
            if (stdout === '4\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('SecuritySystem/set/TargetState', payload => {
            if (payload === '2') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.SecuritySystem + ' --iid ' + iid.SecuritySystem.SecuritySystemTargetState + ' 2';
        console.log(cmd);
        cp.exec(cmd);
    });
});



describe('Speaker Mute', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Speaker Mute true/, () => {
            done();
        });
        mqtt.publish('Speaker/status/Mute', 'true');
    });
    it('client should get the status of the Speaker', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Speaker + ' --iid ' + iid.Speaker.Mute, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Speaker Mute false/, () => {
            done();
        });
        mqtt.publish('Speaker/status/Mute', 'false');
    });
    it('client should get the status of the Speaker', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Speaker + ' --iid ' + iid.Speaker.Mute, (err, stdout, stderr) => {
            if (stdout === 'false\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Speaker/set/Mute', payload => {
            console.log(payload);
            if (payload === 'false') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Speaker + ' --iid ' + iid.Speaker.Mute + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Speaker/set/Mute', payload => {
            console.log(payload);
            if (payload === 'true') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Speaker + ' --iid ' + iid.Speaker.Mute + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });
});



describe('Speaker Volume', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Speaker Volume 80/, () => {
            done();
        });
        mqtt.publish('Speaker/status/Volume', '80');
    });
    it('client should get the status of the Speaker', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Speaker + ' --iid ' + iid.Speaker.Volume, (err, stdout, stderr) => {
            if (stdout === '80\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Speaker/set/Volume', payload => {
            if (payload === '20') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Speaker + ' --iid ' + iid.Speaker.Volume + ' 20';
        console.log(cmd);
        cp.exec(cmd);
    });
});





describe('WindowCovering CurrentPosition', () => {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering CurrentPosition 100/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/CurrentPosition', '1');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.CurrentPosition, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering CurrentPosition 0/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/CurrentPosition', '0');
    });
    it('client should get the status of the WindowCovering', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.CurrentPosition, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

});

describe('WindowCovering TargetPosition', () => {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering TargetPosition 100/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/TargetPosition', '1');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.TargetPosition, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering TargetPosition 0/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/TargetPosition', '0');
    });
    it('client should get the status of the WindowCovering', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.TargetPosition, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('WindowCovering/set/TargetPosition', payload => {
            if (payload === '0.5') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.TargetPosition + ' 50';
        console.log(cmd);
        cp.exec(cmd);
    });
});

describe('WindowCovering PositionState', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering PositionState.INCREASING/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/PositionState', '1');
    });
    it('client should get the status of the WindowCovering', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.PositionState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering PositionState.DECREASING/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/PositionState', '2');
    });
    it('client should get the status of the WindowCovering', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.PositionState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update WindowCovering PositionState.STOPPED/, () => {
            done();
        });
        mqtt.publish('WindowCovering/status/PositionState', '0');
    });
    it('client should get the status of the WindowCovering', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.WindowCovering + ' --iid ' + iid.WindowCovering.PositionState, (err, stdout, stderr) => {
            if (stdout === '2\n') {
                done();
            }
        });
    });

});


describe('Window CurrentPosition', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window CurrentPosition 100/, () => {
            done();
        });
        mqtt.publish('Window/status/CurrentPosition', '100');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.CurrentPosition, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window CurrentPosition 0/, () => {
            done();
        });
        mqtt.publish('Window/status/CurrentPosition', '0');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.CurrentPosition, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

});

describe('Window TargetPosition', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window TargetPosition 100/, () => {
            done();
        });
        mqtt.publish('Window/status/TargetPosition', '100');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.TargetPosition, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window TargetPosition 0/, () => {
            done();
        });
        mqtt.publish('Window/status/TargetPosition', '0');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.TargetPosition, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Window/set/TargetPosition', payload => {
            if (payload === '50') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Window + ' --iid ' + iid.Window.TargetPosition + ' 50';
        console.log(cmd);
        cp.exec(cmd);
    });
});

describe('Window PositionState', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window PositionState.INCREASING/, function () {
            done();
        });
        mqtt.publish('Window/status/PositionState', '1');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.PositionState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window PositionState.DECREASING/, () => {
            done();
        });
        mqtt.publish('Window/status/PositionState', '2');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.PositionState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window PositionState.STOPPED/, () => {
            done();
        });
        mqtt.publish('Window/status/PositionState', '0');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.PositionState, (err, stdout, stderr) => {
            if (stdout === '2\n') {
                done();
            }
        });
    });

});

describe('Window Obstruction', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window ObstructionDetected false/, function () {
            done();
        });
        mqtt.publish('Window/status/Obstruction', '0');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.ObstructionDetected, (err, stdout, stderr) => {
            console.log(stdout);
            if (stdout === 'false\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Window ObstructionDetected true/, () => {
            done();
        });
        mqtt.publish('Window/status/Obstruction', '1');
    });
    it('client should get the status of the Window', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Window + ' --iid ' + iid.Window.ObstructionDetected, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });


});



describe('Door CurrentPosition', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door CurrentPosition 100/, () => {
            done();
        });
        mqtt.publish('Door/status/CurrentPosition', '100');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.CurrentPosition, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door CurrentPosition 0/, () => {
            done();
        });
        mqtt.publish('Door/status/CurrentPosition', '0');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.CurrentPosition, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

});

describe('Door TargetPosition', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door TargetPosition 100/, () => {
            done();
        });
        mqtt.publish('Door/status/TargetPosition', '100');
    });
    it('client should get the status of the switch', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.TargetPosition, (err, stdout, stderr) => {
            if (stdout === '100\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door TargetPosition 0/, () => {
            done();
        });
        mqtt.publish('Door/status/TargetPosition', '0');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.TargetPosition, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Door/set/TargetPosition', payload => {
            if (payload === '50') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Door + ' --iid ' + iid.Door.TargetPosition + ' 50';
        console.log(cmd);
        cp.exec(cmd);
    });
});

describe('Door PositionState', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door PositionState.INCREASING/, () => {
            done();
        });
        mqtt.publish('Door/status/PositionState', '1');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.PositionState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door PositionState.DECREASING/, () => {
            done();
        });
        mqtt.publish('Door/status/PositionState', '2');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.PositionState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door PositionState.STOPPED/, () => {
            done();
        });
        mqtt.publish('Door/status/PositionState', '0');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.PositionState, (err, stdout, stderr) => {
            if (stdout === '2\n') {
                done();
            }
        });
    });

});

describe('Door Obstruction', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door ObstructionDetected false/, () => {
            done();
        });
        mqtt.publish('Door/status/Obstruction', '0');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.ObstructionDetected, (err, stdout, stderr) => {
            console.log(stdout);
            if (stdout === 'false\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Door ObstructionDetected true/, () => {
            done();
        });
        mqtt.publish('Door/status/Obstruction', '1');
    });
    it('client should get the status of the Door', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Door + ' --iid ' + iid.Door.ObstructionDetected, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });


});

describe('GarageDoorOpener CurrentDoorState', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener CurrentDoorState.OPEN/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status', '4');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.CurrentDoorState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener CurrentDoorState.CLOSED/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status', '0');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.CurrentDoorState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener CurrentDoorState.OPENING/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status', '1');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.CurrentDoorState, (err, stdout, stderr) => {
            if (stdout === '2\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener CurrentDoorState.CLOSING/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status', '2');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.CurrentDoorState, (err, stdout, stderr) => {
            if (stdout === '3\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener CurrentDoorState.STOPPED/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status', '3');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.CurrentDoorState, (err, stdout, stderr) => {
            if (stdout === '4\n') {
                done();
            }
        });
    });

});


describe('GarageDoorOpener TargetDoorState', () => {

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('GarageDoorOpener/set', payload => {
            if (payload === '4') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.TargetDoorState + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('GarageDoorOpener/set', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.TargetDoorState + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('GarageDoorOpener Obstruction', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener ObstructionDetected false/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status/Obstruction', '0');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.ObstructionDetected, (err, stdout, stderr) => {
            console.log(stdout);
            if (stdout === 'false\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener ObstructionDetected true/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status/Obstruction', '1');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.ObstructionDetected, (err, stdout, stderr) => {
            if (stdout === 'true\n') {
                done();
            }
        });
    });


});

describe('GarageDoorOpener LockCurrentState', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener LockCurrentState.UNSECURED/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status/Lock', '0');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.LockCurrentState, (err, stdout, stderr) => {
            console.log(stdout)
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update GarageDoorOpener LockCurrentState.SECURED/, () => {
            done();
        });
        mqtt.publish('GarageDoorOpener/status/Lock', '1');
    });
    it('client should get the status of the GarageDoorOpener', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.LockCurrentState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });

});

describe('GarageDoorOpener LockTargetState', function () {

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('GarageDoorOpener/set/Lock', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.LockTargetState + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('GarageDoorOpener/set/Lock', payload => {
            if (payload === '1') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.GarageDoorOpener + ' --iid ' + iid.GarageDoorOpener.LockTargetState + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

});


describe('LockMechanism LockCurrentState', function () {


    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update LockMechanism LockCurrentState.UNSECURED/, () => {
            done();
        });
        mqtt.publish('LockMechanism/status', '1');
    });
    it('client should get the status of the LockMechanism', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.LockMechanism + ' --iid ' + iid.LockMechanism.LockCurrentState, (err, stdout, stderr) => {
            console.log(stdout)
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update LockMechanism LockCurrentState.SECURED/, () => {
            done();
        });
        mqtt.publish('LockMechanism/status', '0');
    });
    it('client should get the status of the LockMechanism', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.LockMechanism + ' --iid ' + iid.LockMechanism.LockCurrentState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });

});

describe('LockMechanism LockTargetState', function () {


    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('LockMechanism/set', payload => {
            if (payload === '1') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.LockMechanism + ' --iid ' + iid.LockMechanism.LockTargetState + ' 0';
        console.log(cmd);
        cp.exec(cmd);
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('LockMechanism/set', payload => {
            if (payload === '0') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.LockMechanism + ' --iid ' + iid.LockMechanism.LockTargetState + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

});


describe('ThermostatSimple CurrentTemperature', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update ThermostatSimple CurrentTemperature 21/, () => {
            done();
        });
        mqtt.publish('ThermostatSimple/status/CurrentTemperature', '21');
    });

    it('client should get the CurrentTemperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ThermostatSimple + ' --iid ' + iid.ThermostatSimple.CurrentTemperature, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
});

describe('ThermostatSimple TargetTemperature', function () {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update ThermostatSimple TargetTemperature 21/, () => {
            done();
        });
        mqtt.publish('ThermostatSimple/status/TargetTemperature', '21');
    });

    it('client should get the TargetTemperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ThermostatSimple + ' --iid ' + iid.ThermostatSimple.TargetTemperature, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('ThermostatSimple/set/TargetTemperature', payload => {
            if (payload === '24') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.ThermostatSimple + ' --iid ' + iid.ThermostatSimple.TargetTemperature + ' 24';
        console.log(cmd);
        cp.exec(cmd);
    });

});


describe('ThermostatSimple CurrentHeatingCoolingState', function () {

    it('client should get the CurrentHeatingCoolingState', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ThermostatSimple + ' --iid ' + iid.ThermostatSimple.CurrentHeatingCoolingState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
});

describe('ThermostatSimple TargetHeatingCoolingState', function () {

    it('client should get the TargetHeatingCoolingState', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ThermostatSimple + ' --iid ' + iid.ThermostatSimple.TargetHeatingCoolingState, (err, stdout, stderr) => {
            if (stdout === '1\n') {
                done();
            }
        });
    });
});

describe('ThermostatSimple TemperatureDisplayUnits', function () {

    it('client should get the TemperatureDisplayUnits', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.ThermostatSimple + ' --iid ' + iid.ThermostatSimple.TemperatureDisplayUnits, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
});

describe('Thermostat CurrentTemperature', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat CurrentTemperature 21/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/CurrentTemperature', '21');
    });

    it('client should get the CurrentTemperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.CurrentTemperature, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
});

describe('Thermostat TargetTemperature', function () {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat TargetTemperature 21/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/TargetTemperature', '21');
    });

    it('client should get the TargetTemperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.TargetTemperature, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Thermostat/set/TargetTemperature', payload => {
            if (payload === '24') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.TargetTemperature + ' 24';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Thermostat CurrentHeatingCoolingState', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat CurrentHeatingCoolingState 2/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/CurrentHeatingCoolingState', '2');
    });

    it('client should get the CurrentHeatingCoolingState', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.CurrentHeatingCoolingState, (err, stdout, stderr) => {
            if (stdout === '2\n') {
                done();
            }
        });
    });
});

describe('Thermostat TargetHeatingCoolingState', function () {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat TargetHeatingCoolingState 0/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/TargetHeatingCoolingState', '0');
    });

    it('client should get the TargetHeatingCoolingState', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.TargetHeatingCoolingState, (err, stdout, stderr) => {
            if (stdout === '0\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Thermostat/set/TargetHeatingCoolingState', payload => {
            if (payload === '1') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.TargetHeatingCoolingState + ' 1';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Thermostat CurrentRelativeHumidity', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat CurrentRelativeHumidity 65/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/CurrentRelativeHumidity', '65');
    });
    it('client should get the CurrentRelativeHumidity', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.CurrentRelativeHumidity, (err, stdout, stderr) => {
            if (stdout === '65\n') {
                done();
            }
        });
    });

});

describe('Thermostat TargetRelativeHumidity', function () {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat TargetRelativeHumidity 21/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/TargetRelativeHumidity', '21');
    });

    it('client should get the TargetRelativeHumidity', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.TargetRelativeHumidity, (err, stdout, stderr) => {
            if (stdout === '21\n') {
                done();
            }
        });
    });
    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Thermostat/set/TargetRelativeHumidity', payload => {
            if (payload === '24') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.TargetRelativeHumidity + ' 24';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Thermostat HeatingThresholdTemperature', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat HeatingThresholdTemperature 22/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/HeatingThresholdTemperature', '22');
    });
    it('client should get the HeatingThresholdTemperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.HeatingThresholdTemperature, (err, stdout, stderr) => {
            if (stdout === '22\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Thermostat/set/HeatingThresholdTemperature', payload => {
            if (payload === '24') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.HeatingThresholdTemperature + ' 24';
        console.log(cmd);
        cp.exec(cmd);
    });

});

describe('Thermostat CoolingThresholdTemperature', function () {

    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap update Thermostat CoolingThresholdTemperature 22/, () => {
            done();
        });
        mqtt.publish('Thermostat/status/CoolingThresholdTemperature', '22');
    });
    it('client should get the CoolingThresholdTemperature', function (done) {
        this.timeout(36000);
        cp.exec(clientCmd + ' get --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.CoolingThresholdTemperature, (err, stdout, stderr) => {
            if (stdout === '22\n') {
                done();
            }
        });
    });

    it('homekit2mqtt should publish on mqtt after client did a set', function (done) {
        this.timeout(36000);
        mqttSubscribe('Thermostat/set/CoolingThresholdTemperature', payload => {
            if (payload === '24') {
                done();
            }
        });
        const cmd = clientCmd + ' set --aid ' + aid.Thermostat + ' --iid ' + iid.Thermostat.CoolingThresholdTemperature + ' 24';
        console.log(cmd);
        cp.exec(cmd);
    });

});


describe('StatelessProgrammableSwitch', () => {
    it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
        this.timeout(36000);
        subscribe('homekit', /hap set StatelessProgrammableSwitch ProgrammableSwitchEvent 1/, () => {
            done();
        });
        mqtt.publish('StatelessProgrammableSwitch/status', '1');
    });
});



function testLowBattery(name) {
    describe(name + ' StatusLowBattery', function () {

        it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
            this.timeout(36000);
            subscribe('homekit', new RegExp('hap update ' + name + ' StatusLowBattery 1'), () => {
                done();
            });
            mqtt.publish(name + '/status/LowBattery', '{"val":1}');
        });
        it('client should get the status of the ' + name, function (done) {
            this.timeout(36000);
            cp.exec(clientCmd + ' get --aid ' + aid[name] + ' --iid ' + iid[name].StatusLowBattery, (err, stdout, stderr) => {
                if (stdout === '1\n') {
                    done();
                }
            });
        });
        it('homekit2mqtt should receive a status via mqtt and update it on hap', function (done) {
            this.timeout(36000);
            subscribe('homekit', new RegExp('hap update ' + name + ' StatusLowBattery 0'), () => {
                done();
            });
            mqtt.publish(name + '/status/LowBattery', '{"val":0}');
        });
        it('client should get the status of ' + name, function (done) {
            this.timeout(36000);
            cp.exec(clientCmd + ' get --aid ' + aid[name] + ' --iid ' + iid[name].StatusLowBattery, (err, stdout, stderr) => {
                if (stdout === '0\n') {
                    done();
                }
            });
        });
    });
}

setTimeout(() => {
    homekit.kill();
    process.exit(1);
}, 1800000);
