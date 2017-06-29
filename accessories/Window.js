/* eslint unicorn/filename-case: "off", func-names: "off", camelcase: "off", no-unused-vars: "off" */

module.exports = function (iface) {
    const {mqttPub, mqttSub, mqttStatus, log, newAccessory, Service, Characteristic} = iface;

    /*
     // Required Characteristics
     this.addCharacteristic(Characteristic.CurrentPosition);
     this.addCharacteristic(Characteristic.TargetPosition);
     this.addCharacteristic(Characteristic.PositionState);

     // Optional Characteristics
     TODO this.addOptionalCharacteristic(Characteristic.HoldPosition);
     this.addOptionalCharacteristic(Characteristic.ObstructionDetected);
     this.addOptionalCharacteristic(Characteristic.Name);
     */

    return function createAccessory_Window(settings) {
        const acc = newAccessory(settings);

        acc.addService(Service.Window, settings.name)
            .getCharacteristic(Characteristic.TargetPosition)
            .on('set', (value, callback) => {
                log.debug('< hap set', settings.name, 'TargetPosition', value);
                value *= (settings.payload.targetPositionFactor || 1);
                if (settings.payload.roundTarget) {
                    value = Math.round(value);
                }
                log.debug('> mqtt', settings.topic.setTargetPosition, value);
                mqttPub(settings.topic.setTargetPosition, value);
                callback();
            });

        if (settings.topic.statusTargetPosition) {
            mqttSub(settings.topic.statusTargetPosition, val => {
                const position = Math.round(mqttStatus[settings.topic.statusTargetPosition] / (settings.payload.targetPositionFactor || 1));
                log.debug('> hap update', settings.name, 'TargetPosition', position);
                acc.getService(Service.Window)
                    .updateCharacteristic(Characteristic.TargetPosition, position);
            });
            acc.getService(Service.Window)
                .getCharacteristic(Characteristic.TargetPosition)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'TargetPosition');
                    const position = Math.round(mqttStatus[settings.topic.statusTargetPosition] / (settings.payload.targetPositionFactor || 1));
                    log.debug('> hap re_get', settings.name, 'TargetPosition', position);
                    callback(null, position);
                });
        }

        if (settings.topic.statusCurrentPosition) {
            mqttSub(settings.topic.statusCurrentPosition, val => {
                const pos = Math.round(val / (settings.payload.currentPositionFactor || 1));
                log.debug('> hap set', settings.name, 'CurrentPosition', pos);
                acc.getService(Service.Window)
                    .setCharacteristic(Characteristic.CurrentPosition, pos);
            });
            acc.getService(Service.Window)
                .getCharacteristic(Characteristic.CurrentPosition)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'CurrentPosition');
                    const position = Math.round(mqttStatus[settings.topic.statusCurrentPosition] / (settings.payload.currentPositionFactor || 1));
                    log.debug('> hap re_get', settings.name, 'CurrentPosition', position);
                    callback(null, position);
                });
        }

        if (settings.topic.statusPositionStatus) {
            mqttSub(settings.topic.statusPositionStatus, val => {
                let state;
                if (val === settings.payload.positionStatusDecreasing) {
                    state = Characteristic.PositionState.DECREASING;
                    log.debug('> hap set', settings.name, 'PositionState.DECREASING');
                } else if (val === settings.payload.positionStatusIncreasing) {
                    state = Characteristic.PositionState.INCREASING;
                    log.debug('> hap set', settings.name, 'PositionState.INCREASING');
                } else {
                    state = Characteristic.PositionState.STOPPED;
                    log.debug('> hap set', settings.name, 'PositionState.STOPPED');
                }
                acc.getService(Service.Window)
                    .setCharacteristic(Characteristic.PositionState, state);
            });
            acc.getService(Service.Window)
                .getCharacteristic(Characteristic.PositionState)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'PositionState');

                    if (mqttStatus[settings.topic.statusPositionState] === settings.payload.positionStatusDecreasing) {
                        log.debug('> hap re_get', settings.name, 'PositionState.DECREASING');
                        callback(null, Characteristic.PositionState.DECREASING);
                    } else if (mqttStatus[settings.topic.statusPositionState] === settings.payload.positionStatusIncreasing) {
                        log.debug('> hap re_get', settings.name, 'PositionState.INCREASING');
                        callback(null, Characteristic.PositionState.INCREASING);
                    } else {
                        log.debug('> hap re_get', settings.name, 'PositionState.STOPPED');
                        callback(null, Characteristic.PositionState.STOPPED);
                    }
                });
        }

        if (settings.topic.statusObstruction) {
            acc.getService(Service.GarageDoorOpener, settings.name)
                .getCharacteristic(Characteristic.ObstructionDetected)
                .on('get', callback => {
                    log.debug('< hap get', settings.name, 'ObstructionDetected');
                    const obstruction = mqttStatus[settings.topic.statusObstruction] === settings.payload.onObstructionDetected;
                    log.debug('> hap re_get', settings.name, 'ObstructionDetected', obstruction);
                    callback(null, obstruction);
                });

            mqttSub(settings.topic.statusObstruction, val => {
                const obstruction = val === settings.payload.onObstructionDetected;
                log.debug('> hap set', settings.name, 'ObstructionDetected', obstruction);
                acc.getService(Service.GarageDoorOpener)
                    .setCharacteristic(Characteristic.ObstructionDetected, obstruction);
            });
        }

        return acc;
    };
};
