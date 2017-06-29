/* eslint unicorn/filename-case: "off", func-names: "off", camelcase: "off", no-unused-vars: "off" */

module.exports = function (iface) {
    const {mqttPub, mqttSub, mqttStatus, log, newAccessory, Service, Characteristic} = iface;

    return function createAccessory_ContactSensor(settings) {
        const sensor = newAccessory(settings);

        sensor.addService(Service.ContactSensor, settings.name)
            .getCharacteristic(Characteristic.ContactSensorState)
            .on('get', callback => {
                log.debug('< hap get', settings.name, 'ContactSensorState');
                const contact = mqttStatus[settings.topic.statusContactSensorState] === settings.payload.onContactDetected ?
                    Characteristic.ContactSensorState.CONTACT_DETECTED :
                    Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;

                log.debug('> hap re_get', settings.name, 'ContactSensorState', contact);
                callback(null, contact);
            });

        mqttSub(settings.topic.statusContactSensorState, val => {
            const contact = val === settings.payload.onContactDetected ?
                Characteristic.ContactSensorState.CONTACT_DETECTED :
                Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
            log.debug('> hap set', settings.name, 'ContactSensorState', contact);
            sensor.getService(Service.ContactSensor)
                .setCharacteristic(Characteristic.ContactSensorState, contact);
        });

        if (settings.topic.statusLowBattery) {
            sensor.getService(Service.ContactSensor, settings.name)
                .getCharacteristic(Characteristic.StatusLowBattery)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'StatusLowBattery');
                    const bat = mqttStatus[settings.topic.statusLowBattery] === settings.payload.onLowBattery ?
                        Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                        Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                    log.debug('> hap re_get', settings.name, 'StatusLowBattery', bat);
                    callback(null, bat);
                });

            mqttSub(settings.topic.statusLowBattery, val => {
                const bat = val === settings.payload.onLowBattery ?
                    Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW :
                    Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                log.debug('> hap set', settings.name, 'StatusLowBattery', bat);
                sensor.getService(Service.ContactSensor)
                    .setCharacteristic(Characteristic.StatusLowBattery, bat);
            });
        }

        return sensor;
    };
};
