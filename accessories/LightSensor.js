/* eslint unicorn/filename-case: "off", func-names: "off", camelcase: "off", no-unused-vars: "off" */

/*
 this.addOptionalCharacteristic(Characteristic.StatusActive);
 this.addOptionalCharacteristic(Characteristic.StatusFault);
 this.addOptionalCharacteristic(Characteristic.StatusTampered);
 */

module.exports = function (iface) {
    const {mqttPub, mqttSub, mqttStatus, log, newAccessory, Service, Characteristic} = iface;

    return function createAccessory_LightSensor(settings) {
        const sensor = newAccessory(settings);

        mqttSub(settings.topic.statusAmbientLightLevel, val => {
            val /= (settings.payload.ambientLightLevelFactor || 1);
            log.debug('> hap update', settings.name, 'CurrentAmbientLightLevel', mqttStatus[settings.topic.statusAmbientLightLevel]);
            sensor.getService(Service.LightSensor)
                .updateCharacteristic(Characteristic.CurrentAmbientLightLevel, val);
        });

        sensor.addService(Service.LightSensor)
            .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
            .on('get', callback => {
                const val = mqttStatus[settings.topic.statusAmbientLightLevel] / (settings.payload.ambientLightLevelFactor || 1);
                log.debug('< hap get', settings.name, 'LightSensor', 'CurrentAmbientLightLevel');
                log.debug('> hap re_get', settings.name, val);
                callback(null, val);
            });

        /* istanbul ignore else */
        if (settings.topic.statusLowBattery) {
            sensor.getService(Service.LightSensor, settings.name)
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
                log.debug('> hap update', settings.name, 'StatusLowBattery', bat);
                sensor.getService(Service.LightSensor)
                    .updateCharacteristic(Characteristic.StatusLowBattery, bat);
            });
        }

        return sensor;
    };
};
