/* eslint unicorn/filename-case: "off", func-names: "off", camelcase: "off", no-unused-vars: "off", no-negated-condition: "off" */

/*
 this.addOptionalCharacteristic(Characteristic.StatusActive);
 this.addOptionalCharacteristic(Characteristic.StatusFault);
 this.addOptionalCharacteristic(Characteristic.StatusTampered);
 */

module.exports = function (iface) {
    const {mqttPub, mqttSub, mqttStatus, log, newAccessory, Service, Characteristic} = iface;

    return function createAccessory_CarbonDioxideSensor(settings) {
        const sensor = newAccessory(settings);

        sensor.addService(Service.CarbonDioxideSensor, settings.name)
            .getCharacteristic(Characteristic.CarbonDioxideDetected)
            .on('get', callback => {
                log.debug('< hap get', settings.name, 'CarbonDioxideDetected');
                const contact = mqttStatus[settings.topic.statusCarbonDioxideDetected] === settings.payload.onCarbonDioxideDetected ?
                    Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL :
                    Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;

                log.debug('> hap re_get', settings.name, 'CarbonDioxideDetected', contact);
                callback(null, contact);
            });

        mqttSub(settings.topic.statusCarbonDioxideDetected, val => {
            const contact = val === settings.payload.onCarbonDioxideDetected ?
                Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL :
                Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
            log.debug('> hap update', settings.name, 'CarbonDioxideDetected', contact);
            sensor.getService(Service.CarbonDioxideSensor)
                .updateCharacteristic(Characteristic.CarbonDioxideDetected, contact);
        });

        /* istanbul ignore else */
        if (settings.topic.statusLowBattery) {
            sensor.getService(Service.CarbonDioxideSensor, settings.name)
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
                sensor.getService(Service.CarbonDioxideSensor)
                    .updateCharacteristic(Characteristic.StatusLowBattery, bat);
            });
        }

        return sensor;
    };
};

