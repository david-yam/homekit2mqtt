/* eslint unicorn/filename-case: "off", func-names: "off", camelcase: "off", no-unused-vars: "off", no-negated-condition: "off" */

/* TODO
 this.addOptionalCharacteristic(Characteristic.StatusActive);
 this.addOptionalCharacteristic(Characteristic.StatusFault);
 this.addOptionalCharacteristic(Characteristic.StatusTampered);
 */

module.exports = function (iface) {
    const {mqttPub, mqttSub, mqttStatus, log, newAccessory, Service, Characteristic} = iface;

    return function createAccessory_LeakSensor(settings) {
        const sensor = newAccessory(settings);

        sensor.addService(Service.LeakSensor, settings.name)
            .getCharacteristic(Characteristic.LeakDetected)
            .on('get', callback => {
                log.debug('< hap get', settings.name, 'LeakDetected');
                const contact = mqttStatus[settings.topic.statusLeakDetected] === settings.payload.onLeakDetected ?
                    Characteristic.LeakDetected.LEAK_DETECTED :
                    Characteristic.LeakDetected.LEAK_NOT_DETECTED;

                log.debug('> hap re_get', settings.name, 'LeakDetected', contact);
                callback(null, contact);
            });

        mqttSub(settings.topic.statusLeakDetected, val => {
            const contact = val === settings.payload.onLeakDetected ?
                Characteristic.LeakDetected.LEAK_DETECTED :
                Characteristic.LeakDetected.LEAK_NOT_DETECTED;
            log.debug('> hap update', settings.name, 'LeakDetected', contact);
            sensor.getService(Service.LeakSensor)
                .updateCharacteristic(Characteristic.LeakDetected, contact);
        });

        /* istanbul ignore else */
        if (settings.topic.statusLowBattery) {
            sensor.getService(Service.LeakSensor, settings.name)
                .getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'StatusLowBattery');
                    const bat = mqttStatus[settings.topic.statusLowBattery] !== settings.payload.onLowBattery ?
                        Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL :
                        Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
                    log.debug('> hap re_get', settings.name, 'StatusLowBattery', bat);
                    callback(null, bat);
                });

            mqttSub(settings.topic.statusLowBattery, val => {
                const bat = val !== settings.payload.onLowBattery ?
                    Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL :
                    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
                log.debug('> hap update', settings.name, 'StatusLowBattery', bat);
                sensor.getService(Service.LeakSensor)
                    .updateCharacteristic(Characteristic.StatusLowBattery, bat);
            });
        }

        return sensor;
    };
};
