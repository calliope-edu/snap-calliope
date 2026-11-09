/*
    calliope.js

    The Calliope mini library of Snap! for Calliope Campus.

    Snap! has no device code of its own. Like the Blocks editor (its
    CalliopeRemote, scratch-vm src/io/calliopeRemote.js) it is a puppet of
    its host page: every access to the Calliope mini goes to the parent
    window as a postMessage, and Campus forwards it to whatever the
    connection widget is connected to, over Bluetooth or USB
    (src/lib/blocks/calliopeRemoteHost.ts in calliope-campus). Campus owns
    the connection; there is no connect or disconnect block.

    The host is the parent window on the origin given by ?parentOrigin=...
    in the page's URL ("*" for any). Without one (Snap! opened on its own)
    the blocks do nothing.

    Snap! -> host
        {type: 'calliope.read', serviceId, characteristicId, reqId}
        {type: 'calliope.write', serviceId, characteristicId, message,
            encoding: 'base64', withResponse}
        {type: 'calliope.subscribe', serviceId, characteristicId}
        {type: 'snap.runtimeVersion', runtimeVersion, hardware}
    host -> Snap!
        {type: 'calliope.readResult', reqId, message}    empty: no device
        {type: 'calliope.notify', characteristicId, message}
        {type: 'calliope.setActive', active}  false: no device access
        {type: 'calliope.rehandshake'}        read COMMAND, report version
        {type: 'calliope.onConnect'}          show "C", fire "when connected"
        {type: 'calliope.rearmInputs'}        arm touch pads and pins anew
        {type: 'calliope.disconnect'}         forget the device's state

    The device runs the Blocks program (the firmware of the Blocks editor).
    Its protocol, as the Blocks editor's calliopeMini extension speaks it:
    service 0b50f3e4-..., characteristics COMMAND 0x0100 (commands,
    handshake), STATE 0x0101 and MOTION 0x0102 (sensors; notified from
    runtime version 2 on, polled before), SENSOR_EVENT 0x0110 (button,
    gesture and pin events, kind in byte 19), ANALOG_IN 0x0120 (P0..P3).

    All primitives are registered in SnapExtensions with the prefix "cal_";
    the custom blocks in calliope_module.xml call them.
*/

/*global SnapExtensions, List, Color, IDE_Morph*/

(function () {
    'use strict';

    if (SnapExtensions.primitives.has('cal_when_connected()')) {
        return; // already loaded
    }

    // ---------------------------------------------------------------------
    // protocol

    var SERVICE = '0b50f3e4-607f-4151-9091-7d008d6ffc5c',
        CH = {COMMAND: 0x0100, STATE: 0x0101, MOTION: 0x0102,
            SENSOR_EVENT: 0x0110, ANALOG_IN: 0x0120},
        CMD = {CONFIG: 0, PIN: 1, DISPLAY: 2, AUDIO: 3, RGB: 5, MOTOR: 6},
        CONFIG = {MIC: 1, TOUCH: 2},
        PIN = {OUTPUT: 1, PWM: 2, SERVO: 3, PULL: 4, EVENT: 5},
        DISPLAY = {TEXT: 1, PIXELS_0: 2, PIXELS_1: 3, PIXELS_PACKED: 4},
        AUDIO = {STOP: 0, PLAY: 1},
        MOTOR = {m0: 1, m1: 2, m0m1: 3},
        EVENT_KIND = {PIN: 0x11, ACTION: 0x12},
        ACTION = {BUTTON: 1, GESTURE: 2},
        ROUTE = {BLE: 0, SERIAL: 1, DAP: 2},
        HW_DAL = 1, // mini 1 and 2; 2 is CODAL (mini 3)
        V2_FEATURES = 2, // runtime version with notified sensors, packed
                         // pixels and the display generation byte
        BUTTON_ID = {1: 'A', 2: 'B', 100: 'P0', 101: 'P1', 102: 'P2',
            103: 'P3', 121: 'LOGO'},
        BUTTON_EVENT_ID = {1: 'DOWN', 2: 'UP', 3: 'CLICK'},
        STATE_BIT = {P0: 24, P1: 25, P2: 26, P3: 27, A: 28, B: 29, LOGO: 30},
        TOUCH_PIN = {P0: 0, P1: 1, P2: 2, P3: 3},
        GESTURE_ID = {1: 'TILT_UP', 2: 'TILT_DOWN', 3: 'TILT_LEFT',
            4: 'TILT_RIGHT', 5: 'FACE_UP', 6: 'FACE_DOWN', 7: 'FREEFALL',
            8: 'G3', 9: 'G6', 10: 'G8', 11: 'SHAKE'},
        GPIO = [0, 1, 2, 3, 8, 9, 12, 13, 14, 15, 16, 17],
        PULL = {NONE: 0, DOWN: 1, UP: 2},
        PIN_EVENT_TYPE = {NONE: 0, ON_EDGE: 1, ON_PULSE: 2},
        PIN_EVENT = {RISE: 2, FALL: 3, PULSE_HIGH: 4, PULSE_LOW: 5},
        READ_TIMEOUT = 2000, // ms until a read counts as unanswered
        HANDSHAKE_DELAY = 500, // ms after start before the first COMMAND read
        RECHECK_TICKS = 20, // updater ticks between COMMAND reads
        STATE_STALE = 200, // ms without a STATE notification => poll
        ARM_RETRY = 1000, // ms between attempts to arm a touch pad or pin
        PIN_EVENT_GRACE = 500, // ms before a pin event counts as unarmed
        CONNECT_HAT_DELAY = 500; // ms the "C" shows before "when connected"

    function uuid(ch) {
        return '0b50' + ch.toString(16).padStart(4, '0') +
            '-607f-4151-9091-7d008d6ffc5c';
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function num(x, fallback) {
        var n = Number(x);
        return isNaN(n) ? (fallback || 0) : n;
    }

    function toBase64(bytes) {
        return btoa(String.fromCharCode.apply(null, bytes));
    }

    function fromBase64(b64) {
        var raw = b64 ? atob(b64) : '';
        return Uint8Array.from(raw, c => c.charCodeAt(0));
    }

    function view(bytes) {
        return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    var lastStamp = 0;

    function stamp() {
        // strictly increasing, so two equal events never look like one
        lastStamp = Math.max(Date.now(), lastStamp + 1);
        return lastStamp;
    }

    function hostOrigin() {
        var origin = new URLSearchParams(location.search).get('parentOrigin');
        return origin && window.parent !== window ? origin.trim() : null;
    }

    // ---------------------------------------------------------------------
    // link to the host

    function Link(origin) {
        this.origin = origin;
        this.active = true;
        this.nextReqId = 1;
        this.pendingReads = new Map(); // reqId -> resolve
        this.listeners = {}; // characteristic uuid -> callback
        this.writes = Promise.resolve(); // commands go out one at a time
        this.onSignal = null; // other calliope.* messages
        window.addEventListener('message', event => this.receive(event));
    }

    Link.prototype.post = function (message) {
        window.parent.postMessage(message, this.origin);
    };

    Link.prototype.receive = function (event) {
        var data = event.data, resolve, cb;
        if (event.source !== window.parent ||
                (this.origin !== '*' && event.origin !== this.origin) ||
                !data || typeof data.type !== 'string' ||
                !data.type.startsWith('calliope.')) {
            return;
        }
        if (data.type === 'calliope.readResult') {
            resolve = this.pendingReads.get(data.reqId);
            if (resolve) {resolve(fromBase64(data.message)); }
        } else if (data.type === 'calliope.notify') {
            cb = this.listeners[String(data.characteristicId).toLowerCase()];
            if (cb) {cb(fromBase64(data.message)); }
        } else if (this.onSignal) {
            this.onSignal(data);
        }
    };

    Link.prototype.read = function (ch) {
        // answers the bytes, empty without a device
        if (!this.active) {return Promise.resolve(new Uint8Array(0)); }
        return new Promise(resolve => {
            var reqId = this.nextReqId,
                done = bytes => {
                    this.pendingReads.delete(reqId);
                    clearTimeout(timer);
                    resolve(bytes);
                },
                timer = setTimeout(() => done(new Uint8Array(0)),
                    READ_TIMEOUT);
            this.nextReqId += 1;
            this.pendingReads.set(reqId, done);
            this.post({type: 'calliope.read', serviceId: SERVICE,
                characteristicId: uuid(ch), reqId: reqId});
        });
    };

    Link.prototype.write = function (ch, bytes, acknowledged, gap) {
        // resolves once the command is out and the device had time for it
        var job = () => {
            if (!this.active) {return; }
            this.post({type: 'calliope.write', serviceId: SERVICE,
                characteristicId: uuid(ch), message: toBase64(bytes),
                encoding: 'base64', withResponse: acknowledged});
            return sleep(gap);
        };
        this.writes = this.writes.then(job);
        return this.writes;
    };

    Link.prototype.subscribe = function (ch, callback) {
        // the host keeps subscriptions across reconnects and flashes
        this.listeners[uuid(ch)] = callback;
        this.post({type: 'calliope.subscribe', serviceId: SERVICE,
            characteristicId: uuid(ch)});
    };

    // ---------------------------------------------------------------------
    // Calliope mini

    function Calliope(link) {
        this.link = link;
        this.hardware = 2;
        this.route = ROUTE.BLE;
        this.runtimeVersion = undefined; // unknown until COMMAND answers
        this.stateSubscribed = false;
        this.lastStateNotify = 0;
        this.ticks = 0;
        this.connectedAt = 0; // when "when connected" last fired
        this.connectTimer = null;
        this.displayGeneration = 0;
        this.resistiveTouch = false;
        this.resetDeviceState();
        this.resetSession();
        if (link) {
            link.onSignal = msg => this.signal(msg);
            link.subscribe(CH.SENSOR_EVENT, data => this.parseEvent(data));
            setTimeout(() => this.recheck().then(() => this.update()),
                HANDSHAKE_DELAY);
        }
    }

    Calliope.prototype.resetDeviceState = function () {
        // what the device reported; gone with the device
        this.digitalLevel = {};
        this.buttonState = {};
        this.lightLevel = 0;
        this.temperature = 0;
        this.soundLevel = 0;
        this.pitch = 0;
        this.roll = 0;
        this.acceleration = {x: 0, y: 0, z: 0};
        this.compassHeading = 0;
        this.magneticForce = {x: 0, y: 0, z: 0};
        this.analogValue = [0, 0, 0, 0];
        this.analogUpdated = 0;
        this.analogPending = null;
        this.buttonEvents = {}; // name -> event -> stamp
        this.gestureEvents = {}; // name -> stamp
        this.pinEvents = {}; // pin -> event -> {value, stamp}
        this.mic = false;
        this.pinMode = {}; // pin -> 'INPUT', 'OUTPUT', 'PWM', 'SERVO', 'TOUCH'
        this.armAttempt = {}; // touch pad -> ms of the last attempt
        this.pinEventArmed = {}; // pin -> type the device is believed to have
        this.pinEventAttempt = {}; // pin -> ms of the last attempt
    };

    Calliope.prototype.resetSession = function () {
        // what the program asked for; a newly opened project starts over
        this.touchWanted = new Set(); // touch pads 0..3 the program reads
        this.pinEventWanted = {}; // pin -> pin event type
        this.resistiveTouch = false;
        this.pinMode = {};
        this.armAttempt = {};
        this.pinEventArmed = {};
        this.pinEventAttempt = {};
    };

    Calliope.prototype.signal = function (msg) {
        switch (msg.type) {
        case 'calliope.setActive':
            var wasActive = this.link.active;
            this.link.active = msg.active !== false;
            if (this.link.active && !wasActive) {
                // the device may have changed while nobody looked
                this.rehandshake();
            }
            break;
        case 'calliope.rehandshake':
            this.rehandshake();
            break;
        case 'calliope.onConnect':
            this.greet();
            break;
        case 'calliope.rearmInputs':
            this.rearmInputs();
            break;
        case 'calliope.disconnect':
            this.resetDeviceState();
            break;
        }
    };

    // handshake -----------------------------------------------------------

    Calliope.prototype.rehandshake = function () {
        this.runtimeVersion = undefined; // so the version is reported again
        this.recheck();
    };

    Calliope.prototype.recheck = async function () {
        // COMMAND: hardware, protocol, route, runtime version, armed touch
        // pads (bit n = Pn), armed pin events (bit n = pin n, 3 bytes)
        var data = await this.link.read(CH.COMMAND), version;
        if (data.length < 3) {return; } // no device or no Blocks program
        if (data.length >= 5) {this.reconcileTouch(data[4]); }
        if (data.length >= 8) {
            this.reconcilePinEvents(data[5] | (data[6] << 8) |
                (data[7] << 16));
        }
        version = data.length > 3 ? data[3] : 0;
        if (version === this.runtimeVersion) {return; }
        this.hardware = data[0];
        this.route = data[2];
        this.runtimeVersion = version;
        if (version >= V2_FEATURES && !this.stateSubscribed) {
            this.stateSubscribed = true;
            this.link.subscribe(CH.STATE, value => {
                this.lastStateNotify = Date.now();
                this.parseState(value);
            });
            this.link.subscribe(CH.MOTION, value => this.parseMotion(value));
        }
        // for the host's "outdated Blocks program" hint
        this.link.post({type: 'snap.runtimeVersion',
            runtimeVersion: version, hardware: this.hardware});
    };

    Calliope.prototype.greet = function () {
        // the host connected a Blocks program: show "C", then fire "when
        // connected", whose blocks may draw over it
        clearTimeout(this.connectTimer);
        this.displayText('C', 0);
        this.connectTimer = setTimeout(() => {
            this.connectedAt = stamp();
        }, CONNECT_HAT_DELAY);
    };

    // updater -------------------------------------------------------------

    Calliope.prototype.updateInterval = function () {
        return this.hardware === HW_DAL ? 100 : 50;
    };

    Calliope.prototype.commandGap = function () {
        if (this.route === ROUTE.DAP) {return 5; }
        if (this.route === ROUTE.SERIAL || this.hardware === HW_DAL) {
            return 30;
        }
        return 15;
    };

    Calliope.prototype.update = async function () {
        while (true) {
            if (this.link.active) {
                this.ticks += 1;
                if (this.ticks % RECHECK_TICKS === 0) {
                    await this.recheck();
                }
                this.armTouch();
                this.armPinEvents();
                if (!this.stateSubscribed ||
                        Date.now() - this.lastStateNotify > STATE_STALE) {
                    this.parseState(await this.link.read(CH.STATE));
                    this.parseMotion(await this.link.read(CH.MOTION));
                }
            }
            await sleep(this.updateInterval());
        }
    };

    // parsing -------------------------------------------------------------

    Calliope.prototype.parseState = function (data) {
        if (data.length < 7) {return; }
        var gpio = view(data).getUint32(0, true);
        GPIO.forEach(pin => {
            this.digitalLevel[pin] = (gpio >> pin) & 1;
        });
        Object.keys(STATE_BIT).forEach(name => {
            this.buttonState[name] = (gpio >> STATE_BIT[name]) & 1;
        });
        this.lightLevel = data[4];
        this.temperature = data[5] - 128;
        this.soundLevel = data[6];
    };

    Calliope.prototype.parseMotion = function (data) {
        if (data.length < 18) {return; }
        var dv = view(data),
            degrees = mrad => Math.round(mrad * 180 / Math.PI / 1000);
        this.pitch = degrees(dv.getInt16(0, true));
        this.roll = degrees(dv.getInt16(2, true));
        this.acceleration = {x: dv.getInt16(4, true) * 1000 / 1024,
            y: dv.getInt16(6, true) * 1000 / 1024,
            z: dv.getInt16(8, true) * 1000 / 1024};
        this.compassHeading = dv.getUint16(10, true);
        this.magneticForce = {x: dv.getInt16(12, true),
            y: dv.getInt16(14, true), z: dv.getInt16(16, true)};
    };

    Calliope.prototype.parseEvent = function (data) {
        if (data.length < 20) {return; }
        var dv = view(data), name, event, pin;
        if (data[19] === EVENT_KIND.ACTION && data[0] === ACTION.BUTTON) {
            name = BUTTON_ID[dv.getUint16(1, true)];
            event = BUTTON_EVENT_ID[data[3]];
            if (name && event) {
                this.buttonEvents[name] = this.buttonEvents[name] || {};
                this.buttonEvents[name][event] = stamp();
            }
        } else if (data[19] === EVENT_KIND.ACTION &&
                data[0] === ACTION.GESTURE) {
            name = GESTURE_ID[data[1]];
            if (name) {this.gestureEvents[name] = stamp(); }
        } else if (data[19] === EVENT_KIND.PIN) {
            pin = data[0];
            this.pinEvents[pin] = this.pinEvents[pin] || {};
            // edge: device time in µs; pulse: its duration in µs
            this.pinEvents[pin][data[1]] = {value: dv.getUint32(2, true),
                stamp: stamp()};
        }
    };

    // commands ------------------------------------------------------------

    Calliope.prototype.command = function (cmd, sub, bytes, unacknowledged) {
        // header (cmd << 5) | sub, payload little endian
        return this.link.write(CH.COMMAND, [(cmd << 5) | sub].concat(bytes),
            !unacknowledged, this.commandGap());
    };

    Calliope.prototype.displayText = function (text, delay) {
        // answers how long the text scrolls, in ms
        var chars = Array.from(String(text).slice(0, 18), c => {
            var code = c.charCodeAt(0);
            return code < 128 ? code : 63; // the device's font is ASCII
        });
        this.command(CMD.DISPLAY, DISPLAY.TEXT,
            [clamp(Math.floor(delay / 10), 0, 255)].concat(chars, [0]));
        return delay * (6 * chars.length + 6);
    };

    Calliope.prototype.displayPixels = function (levels) {
        // levels: 25 brightness values 0..255, row by row from the top
        var bits = 0;
        if (this.runtimeVersion >= V2_FEATURES &&
                levels.every(v => v === 0 || v === 255)) {
            levels.forEach((v, i) => {
                if (v) {bits |= 1 << i; }
            });
            this.command(CMD.DISPLAY, DISPLAY.PIXELS_PACKED,
                [bits & 0xFF, (bits >> 8) & 0xFF, (bits >> 16) & 0xFF,
                    (bits >>> 24) & 0xFF]);
            return;
        }
        // two halves; the device shows them together when their
        // generation bytes match
        this.displayGeneration = (this.displayGeneration + 1) & 0xFF;
        this.command(CMD.DISPLAY, DISPLAY.PIXELS_0,
            levels.slice(0, 15).concat([this.displayGeneration]));
        this.command(CMD.DISPLAY, DISPLAY.PIXELS_1,
            levels.slice(15, 25).concat([this.displayGeneration]));
    };

    Calliope.prototype.setRGB = function (colors) {
        this.command(CMD.RGB, 0, [].concat.apply([], colors));
    };

    Calliope.prototype.setMotor = function (motor, speed) {
        speed = Math.trunc(clamp(speed, -100, 100));
        this.command(CMD.MOTOR, MOTOR[motor] || MOTOR.m0m1,
            [speed < 0 ? 1 : 0, Math.abs(speed)]);
    };

    Calliope.prototype.setPull = function (pin, mode) {
        this.pinMode[pin] = 'INPUT';
        this.command(CMD.PIN, PIN.PULL, [pin, mode]);
    };

    Calliope.prototype.setOutput = function (pin, high) {
        this.pinMode[pin] = 'OUTPUT';
        this.command(CMD.PIN, PIN.OUTPUT, [pin, high ? 1 : 0]);
    };

    Calliope.prototype.setPWM = function (pin, level) {
        this.pinMode[pin] = 'PWM';
        this.command(CMD.PIN, PIN.PWM, [pin, level & 0xFF, level >> 8]);
    };

    Calliope.prototype.setServo = function (pin, angle) {
        // range and centre 0: the firmware's defaults
        this.pinMode[pin] = 'SERVO';
        this.command(CMD.PIN, PIN.SERVO, [pin, angle & 0xFF, angle >> 8,
            0, 0, 0, 0]);
    };

    Calliope.prototype.playTone = function (freq, volume) {
        // no duration: the tone plays until "stop tone"
        var period = freq > 0 ? Math.round(1000000 / freq) : 0;
        this.command(CMD.AUDIO, AUDIO.PLAY, [period & 0xFF,
            (period >> 8) & 0xFF, (period >> 16) & 0xFF,
            (period >>> 24) & 0xFF,
            Math.round(clamp(volume, 0, 100) * 255 / 100)]);
    };

    Calliope.prototype.stopTone = function () {
        this.command(CMD.AUDIO, AUDIO.STOP, []);
    };

    Calliope.prototype.ensureMic = function () {
        if (!this.mic) {
            this.mic = true;
            this.command(CMD.CONFIG, CONFIG.MIC, [1], true);
        }
    };

    Calliope.prototype.ensureInput = function (pin, pull) {
        if (this.pinMode[pin] !== 'INPUT') {this.setPull(pin, pull); }
    };

    Calliope.prototype.analog = function (pin) {
        // answers P0..P3 as 0..1023, or -1 while the device is asked
        if (Date.now() - this.analogUpdated < 100) {
            return this.analogValue[pin];
        }
        this.ensureInput(pin, PULL.NONE);
        if (!this.analogPending) {
            this.analogPending = this.link.read(CH.ANALOG_IN).then(data => {
                var dv = view(data);
                this.analogValue = [0, 1, 2, 3].map(p =>
                    data.length >= p * 2 + 2 ? dv.getUint16(p * 2, true) : 0);
                this.analogUpdated = Date.now();
                this.analogPending = null;
            });
        }
        return -1;
    };

    // arming touch pads and pin events -------------------------------------
    // The program states what it wants; the updater arms it, one pad per
    // tick, and the COMMAND bitmaps tell what the device has armed (they go
    // when it resets).

    Calliope.prototype.wantTouch = function (pin) {
        this.touchWanted.add(pin);
        return this.pinMode[pin] === 'TOUCH';
    };

    Calliope.prototype.armTouch = function () {
        var now = Date.now(),
            pin = Array.from(this.touchWanted).find(p =>
                !this.pinMode[p] || this.pinMode[p] === 'INPUT');
        if (pin === undefined || now - (this.armAttempt[pin] || 0) < ARM_RETRY) {
            return;
        }
        this.armAttempt[pin] = now;
        this.command(CMD.CONFIG, CONFIG.TOUCH,
            [pin, 1, this.resistiveTouch ? 1 : 0], true).then(() => {
                this.pinMode[pin] = 'TOUCH';
            });
    };

    Calliope.prototype.reconcileTouch = function (armed) {
        [0, 1, 2, 3].forEach(pin => {
            var bit = (armed >> pin) & 1;
            if (this.pinMode[pin] === 'TOUCH' && !bit) {
                delete this.pinMode[pin]; // the device reset: arm again
                delete this.armAttempt[pin];
            } else if (this.pinMode[pin] !== 'TOUCH' && bit &&
                    this.touchWanted.has(pin) && this.armAttempt[pin]) {
                this.pinMode[pin] = 'TOUCH';
            }
        });
    };

    Calliope.prototype.setTouchType = function (resistive) {
        // the updater arms the pads again with the new type
        this.resistiveTouch = resistive;
        [0, 1, 2, 3].forEach(pin => {
            if (this.pinMode[pin] === 'TOUCH') {delete this.pinMode[pin]; }
            delete this.armAttempt[pin];
        });
    };

    Calliope.prototype.listenPinEvent = function (pin, type) {
        if (type === PIN_EVENT_TYPE.NONE) {
            delete this.pinEventWanted[pin];
        } else {
            this.pinEventWanted[pin] = type;
        }
        this.pinEventArmed[pin] = type;
        this.pinEventAttempt[pin] = Date.now();
        this.command(CMD.PIN, PIN.EVENT, [pin, type], true);
    };

    Calliope.prototype.armPinEvents = function () {
        var now = Date.now();
        Object.keys(this.pinEventWanted).forEach(pin => {
            var type = this.pinEventWanted[pin];
            if (this.pinEventArmed[pin] !== type &&
                    now - (this.pinEventAttempt[pin] || 0) >= ARM_RETRY) {
                this.listenPinEvent(Number(pin), type);
            }
        });
    };

    Calliope.prototype.reconcilePinEvents = function (armed) {
        var now = Date.now();
        Object.keys(this.pinEventArmed).forEach(pin => {
            if (this.pinEventArmed[pin] && !((armed >> pin) & 1) &&
                    now - (this.pinEventAttempt[pin] || 0) >=
                        PIN_EVENT_GRACE) {
                delete this.pinEventArmed[pin];
                delete this.pinEventAttempt[pin];
            }
        });
    };

    Calliope.prototype.rearmInputs = function () {
        // the device ignores arming a pad that is armed already: off first
        this.touchWanted.forEach(pin => {
            this.command(CMD.CONFIG, CONFIG.TOUCH, [pin, 0], true);
            delete this.pinMode[pin];
            delete this.armAttempt[pin];
        });
        this.pinEventArmed = {};
        this.pinEventAttempt = {};
        this.armTouch();
        this.armPinEvents();
    };

    // ---------------------------------------------------------------------
    // edge detection for event hat blocks
    // Each hat block (the top block of the evaluating process) remembers
    // the last event it has seen, so several hats react to the same event
    // independently, and only to events after it started watching.

    var globalSeen = {};

    function isNewEvent(proc, key, eventStamp) {
        var owner = proc && proc.topBlock,
            seen = owner ?
                    owner.calliopeSeen || (owner.calliopeSeen = {})
                    : globalSeen;
        eventStamp = eventStamp || 0;
        if (seen[key] === undefined || seen[key] === eventStamp) {
            seen[key] = eventStamp;
            return false;
        }
        seen[key] = eventStamp;
        return true;
    }

    // ---------------------------------------------------------------------
    // inputs

    function parseColor(c) {
        var hex, m;
        if (c instanceof Color) {
            return [Math.round(c.r), Math.round(c.g), Math.round(c.b)];
        }
        if (c instanceof List) {
            m = c.itemsArray().map(v => clamp(Math.round(num(v)), 0, 255));
            return [m[0] || 0, m[1] || 0, m[2] || 0];
        }
        hex = String(c).trim().replace(/^#/, '');
        if (/^[0-9a-f]{3}$/i.test(hex)) {
            hex = hex.replace(/./g, d => d + d);
        }
        if (!/^[0-9a-f]{6}$/i.test(hex)) {return [0, 0, 0]; }
        return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    }

    function flatten(x) {
        return x instanceof List ?
                [].concat.apply([], x.itemsArray().map(flatten))
                : [x];
    }

    function parseMatrix(input) {
        // "01010 11111 ..." (0 off, anything else on), "0,50,100,..." or
        // a list of 25 values (0..100 %), or a 5x5 list
        var str = String(input), values;
        if (input instanceof List) {
            values = flatten(input).map(v => clamp(num(v), 0, 100));
        } else if (str.includes(',')) {
            values = str.split(/[,\n]/).map(v => clamp(num(v), 0, 100));
        } else {
            values = Array.from(str.replace(/\s/g, ''),
                ch => ch === '0' ? 0 : 100);
        }
        while (values.length < 25) {values.push(0); }
        return values.slice(0, 25).map(v => Math.round(v * 255 / 100));
    }

    // menu entries of the blocks (German, as in the Blocks editor)
    var MENU = {
        // button and touch events
        'unten': 'DOWN', 'oben': 'UP', 'geklickt': 'CLICK',
        'berührt': 'DOWN', 'losgelassen': 'UP', 'getippt': 'CLICK',
        // gestures
        'logo nach oben': 'TILT_UP', 'logo nach unten': 'TILT_DOWN',
        'nach links gedreht': 'TILT_LEFT', 'nach rechts gedreht': 'TILT_RIGHT',
        'display nach oben': 'FACE_UP', 'display nach unten': 'FACE_DOWN',
        'freier fall': 'FREEFALL', '3g beschleunigt': 'G3',
        '6g beschleunigt': 'G6', '8g beschleunigt': 'G8',
        'geschüttelt': 'SHAKE',
        // pull modes
        'nichts': 'NONE', 'pullup': 'UP', 'pulldown': 'DOWN',
        // pin event types
        'flanke': 'ON_EDGE', 'impuls': 'ON_PULSE',
        // pin events
        'ansteigen': 'RISE', 'abfallen': 'FALL',
        'impuls hoch': 'PULSE_HIGH', 'impuls tief': 'PULSE_LOW',
        // axes
        'betrag': 'absolute',
        // touch type
        'resistiv': 'RESISTIVE', 'kapazitiv': 'CAPACITIVE'
    };

    function code(choice) {
        var text = String(choice).trim();
        return MENU[text.toLowerCase()] || text.toUpperCase();
    }

    function pinNumber(p) {
        return parseInt(String(p).replace(/^[PC]/i, ''), 10) || 0;
    }

    function percent(byte, max) {
        return Math.round(byte * 1000 / max) / 10;
    }

    function axis(vector, choice) {
        var a = code(choice).toLowerCase();
        if (a === 'x' || a === 'y' || a === 'z') {return Math.round(vector[a]); }
        return Math.round(Math.hypot(vector.x, vector.y, vector.z));
    }

    // ---------------------------------------------------------------------
    // Snap! extension primitives

    var link = hostOrigin() ? new Link(hostOrigin()) : null,
        cal = new Calliope(link),
        prims = SnapExtensions.primitives,
        hinted = false;

    window.SnapCalliope = cal; // for the host bridge and debugging

    function device(fn) {
        // a command for the device: without a host, say once where the
        // Calliope mini connects instead of silently doing nothing
        return function () {
            var ide;
            if (link) {return fn.apply(this, arguments); }
            if (!hinted) {
                hinted = true;
                // this: the sprite or stage running the block
                ide = this.parentThatIsA ? this.parentThatIsA(IDE_Morph) : null;
                if (ide) {
                    ide.showMessage('Den Calliope mini verbindest du in ' +
                        'Calliope Campus.', 4);
                }
            }
            return 0;
        };
    }

    prims.set('cal_when_connected()', function (proc) {
        return isNewEvent(proc, 'connected', cal.connectedAt);
    });

    // buttons, touch, gestures

    prims.set('cal_button_event(name, event)', function (name, event, proc) {
        return isNewEvent(proc, 'btn:' + name + ':' + code(event),
            (cal.buttonEvents[String(name).toUpperCase()] || {})[code(event)]);
    });

    prims.set('cal_button_pressed(name)', function (name) {
        return cal.buttonState[String(name).toUpperCase()] === 1;
    });

    prims.set('cal_touch_event(pin, event)', function (pin, event, proc) {
        var name = String(pin).toUpperCase(),
            key = 'touch:' + name + ':' + code(event),
            armed = name === 'LOGO' || cal.wantTouch(TOUCH_PIN[name]);
        return isNewEvent(proc, key,
            armed ? (cal.buttonEvents[name] || {})[code(event)] : 0);
    });

    prims.set('cal_touched(pin)', function (pin) {
        var name = String(pin).toUpperCase();
        if (name !== 'LOGO' && !cal.wantTouch(TOUCH_PIN[name])) {
            return false;
        }
        return cal.buttonState[name] === 1;
    });

    prims.set('cal_touch_type(type)', function (type) {
        cal.setTouchType(code(type) === 'RESISTIVE');
    });

    prims.set('cal_gesture(name)', function (name, proc) {
        return isNewEvent(proc, 'gst:' + code(name),
            cal.gestureEvents[code(name)]);
    });

    // display, LEDs, motors

    prims.set('cal_show_pattern(matrix)', device(function (matrix) {
        cal.displayPixels(parseMatrix(matrix));
    }));

    prims.set('cal_show_text(text, delay)', device(function (text, delay) {
        // answers the scrolling time in seconds
        delay = parseInt(delay, 10);
        return cal.displayText(text, isNaN(delay) ? 120 :
                clamp(delay, 0, 2550)) / 1000;
    }));

    prims.set('cal_clear_display()', device(function () {
        cal.displayPixels(new Array(25).fill(0));
    }));

    prims.set('cal_rgb(c1, c2, c3)', device(function (c1, c2, c3) {
        cal.setRGB([parseColor(c1), parseColor(c2), parseColor(c3)]);
    }));

    prims.set('cal_motor(motor, speed)', device(function (motor, speed) {
        cal.setMotor(String(motor).toLowerCase().replace(/\W/g, ''),
            num(speed));
    }));

    // sensors

    prims.set('cal_light()', function () {
        return percent(cal.lightLevel, 255);
    });

    prims.set('cal_temperature()', function () {
        return cal.temperature;
    });

    prims.set('cal_compass()', function () {
        return cal.compassHeading;
    });

    prims.set('cal_pitch()', function () {
        return cal.pitch;
    });

    prims.set('cal_roll()', function () {
        return cal.roll;
    });

    prims.set('cal_sound()', function () {
        if (link) {cal.ensureMic(); }
        return cal.mic ? percent(cal.soundLevel, 255) : 0;
    });

    prims.set('cal_acceleration(axis)', function (choice) {
        return axis(cal.acceleration, choice);
    });

    prims.set('cal_magnetic(axis)', function (choice) {
        return axis(cal.magneticForce, choice);
    });

    prims.set('cal_analog(pin)', device(function (pin) {
        // answers 0..100 (%), or -1 while waiting for the device
        var raw = cal.analog(clamp(pinNumber(pin), 0, 3));
        return raw < 0 ? -1 : percent(raw, 1024);
    }));

    // pins

    prims.set('cal_pull(pin, mode)', device(function (pin, mode) {
        cal.setPull(pinNumber(pin), PULL[code(mode)] || PULL.NONE);
    }));

    prims.set('cal_pin_high(pin)', function (pin) {
        pin = pinNumber(pin);
        if (link) {cal.ensureInput(pin, PULL.DOWN); }
        return cal.digitalLevel[pin] === 1;
    });

    prims.set('cal_digital_out(pin, level)', device(function (pin, level) {
        cal.setOutput(pinNumber(pin), level === true || num(level) > 0 ||
            /^(true|wahr|hoch|an)$/i.test(String(level).trim()));
    }));

    prims.set('cal_analog_out(pin, percent)', device(function (pin, value) {
        cal.setPWM(pinNumber(pin),
            Math.round(clamp(num(value), 0, 100) * 1024 / 100));
    }));

    prims.set('cal_servo(pin, angle)', device(function (pin, angle) {
        cal.setServo(pinNumber(pin), Math.round(clamp(num(angle), 0, 180)));
    }));

    prims.set('cal_listen_pin(pin, type)', device(function (pin, type) {
        cal.listenPinEvent(pinNumber(pin),
            PIN_EVENT_TYPE[code(type)] || PIN_EVENT_TYPE.NONE);
    }));

    prims.set('cal_pin_event(pin, event)', function (pin, event, proc) {
        var p = pinNumber(pin),
            id = PIN_EVENT[code(event)],
            e = (cal.pinEvents[p] || {})[id];
        return isNewEvent(proc, 'pin:' + p + ':' + id, e ? e.stamp : 0);
    });

    prims.set('cal_pin_event_value(pin, event)', function (pin, event) {
        var e = (cal.pinEvents[pinNumber(pin)] || {})[PIN_EVENT[code(event)]];
        return e ? e.value : 0;
    });

    // sound

    prims.set('cal_tone(freq, volume)', device(function (freq, volume) {
        cal.playTone(num(freq, 440), num(volume, 100));
    }));

    prims.set('cal_stop_tone()', device(function () {
        cal.stopTone();
    }));

    // the red stop sign also stops the tone and the motors
    if (link && window.IDE_Morph) {
        var stopAllScripts = IDE_Morph.prototype.stopAllScripts;
        IDE_Morph.prototype.stopAllScripts = function () {
            cal.stopTone();
            cal.setMotor('m0m1', 0);
            return stopAllScripts.apply(this, arguments);
        };
    }
}());
