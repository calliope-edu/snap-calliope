#!/usr/bin/env node
/*
    Generates from the block table below
      - calliope_module.xml, the Snap! library "Calliope mini"
      - template.xml, an empty project with the library already loaded
        (the start project of a new Snap! program in Calliope Campus)

        node calliope/build-library.js      (or: npm run library)

    Every custom block first runs src_load(libraries/calliope/calliope.js)
    (a no-op after the first call) and then calls the cal_* primitives
    defined in calliope.js.
*/

'use strict';

const fs = require('fs');
const path = require('path');

const CATEGORY = 'Calliope mini';
const COLOR = '0,150,136,1';
const SRC = 'libraries/calliope/calliope.js';

// --- helpers --------------------------------------------------------------

const esc = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, '&#xD;');

const l = v => `<l>${esc(v)}</l>`;
const v = name => `<block var="${esc(name)}"/>`;
const list = items => `<list>${items.join('')}</list>`;
const load = () =>
    `<block s="doApplyExtension">${l('src_load(url)')}${list([l(SRC)])}</block>`;
const run = (prim, args = []) =>
    `<block s="doApplyExtension">${l(prim)}${list(args)}</block>`;
const call = (prim, args = []) =>
    `<block s="reportApplyExtension">${l(prim)}${list(args)}</block>`;
const report = expr => `<block s="doReport">${expr}</block>`;
const not = a => `<block s="reportNot">${a}</block>`;
const lt = (a, b) => `<block s="reportVariadicLessThan">${list([a, b])}</block>`;

// input slot declarations
const menu = (options, def = options[0], type = '%s') => ({
    type, def, options, readonly: true
});
const field = (def = '', type = '%s', options = null) => ({
    type, def, options, readonly: false
});

const PINS_GPIO = ['P0', 'P1', 'P2', 'P3', 'C8', 'C9', 'C12', 'C13',
    'C14', 'C15', 'C16', 'C17'];
const PINS_ANALOG = ['P0', 'P1', 'P2', 'P3'];
const BUTTONS = ['A', 'B'];
const BUTTON_EVENTS = ['geklickt', 'unten', 'oben'];
const TOUCH = ['Logo', 'P0', 'P1', 'P2', 'P3'];
const TOUCH_EVENTS = ['berührt', 'losgelassen', 'getippt'];
const GESTURES = ['geschüttelt', 'Logo nach oben', 'Logo nach unten',
    'nach links gedreht', 'nach rechts gedreht', 'Display nach oben',
    'Display nach unten', 'freier Fall', '3g beschleunigt',
    '6g beschleunigt', '8g beschleunigt'];
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff',
    '#00ffff', '#ffffff', '#000000'];
const AXES = ['x', 'y', 'z', 'Betrag'];
const PIN_EVENTS = ['Impuls tief', 'Impuls hoch', 'Abfallen', 'Ansteigen'];

// --- blocks ---------------------------------------------------------------
// The blocks of the Blocks editor's Calliope mini extension, with its German
// labels. spec: English spec with %'param' names, de: German translation
// (_ = input).

const sensor = (spec, de, prim, space = false) =>
    ({spec, de, type: 'reporter', body: [report(call(prim))], space});

const blocks = [
    // connection: Campus connects; this fires once the device is there
    {
        spec: 'when Calliope mini connected',
        de: 'Wenn Calliope mini verbunden ist',
        type: 'hat',
        body: [report(call('cal_when_connected()'))]
    },

    // buttons, touch, gestures
    {
        spec: "when button %'button' is %'event'",
        de: 'Wenn Taste _ _ ist',
        type: 'hat',
        inputs: [menu(BUTTONS), menu(BUTTON_EVENTS)],
        body: [report(call('cal_button_event(name, event)',
            [v('button'), v('event')]))],
        space: true
    },
    {
        spec: "button %'button' pressed?",
        de: 'Taste _ wird gedrückt?',
        type: 'predicate',
        inputs: [menu(BUTTONS)],
        body: [report(call('cal_button_pressed(name)', [v('button')]))]
    },
    {
        spec: "when pin %'pin' is %'event'",
        de: 'Wenn Pin _ _ wird',
        type: 'hat',
        inputs: [menu(TOUCH), menu(TOUCH_EVENTS)],
        body: [report(call('cal_touch_event(pin, event)',
            [v('pin'), v('event')]))]
    },
    {
        spec: "pin %'pin' touched?",
        de: 'Pin _ wird berührt?',
        type: 'predicate',
        inputs: [menu(TOUCH)],
        body: [report(call('cal_touched(pin)', [v('pin')]))]
    },
    {
        spec: "set all pins to touch mode %'type'",
        de: 'setze alle Pins auf Berührungsmodus _',
        type: 'command',
        inputs: [menu(['Kapazitiv', 'Resistiv'])],
        body: [run('cal_touch_type(type)', [v('type')])]
    },
    {
        spec: "when %'gesture'",
        de: 'Wenn _',
        type: 'hat',
        inputs: [menu(GESTURES)],
        body: [report(call('cal_gesture(name)', [v('gesture')]))]
    },

    // display, LEDs, motors
    {
        spec: "show pattern %'pattern'",
        de: 'zeige Bild _',
        type: 'command',
        inputs: [field('01010 11111 11111 01110 00100', '%s', [
            '01010 11111 11111 01110 00100',
            '00000 01010 00000 10001 01110',
            '00100 01110 10101 00100 00100',
            '11111 11111 11111 11111 11111'
        ])],
        body: [run('cal_show_pattern(matrix)', [v('pattern')])],
        space: true
    },
    {
        spec: "show text %'text' delay %'delay' ms",
        de: 'zeige Text _ mit _ ms Verzögerung',
        type: 'command',
        inputs: [field('Hallo!'), field('120', '%n')],
        body: [`<block s="doWait">${call('cal_show_text(text, delay)',
            [v('text'), v('delay')])}</block>`]
    },
    {
        spec: 'clear display',
        de: 'lösche Display',
        type: 'command',
        body: [run('cal_clear_display()')]
    },
    {
        spec: "set RGB LEDs to %'color 1' %'color 2' %'color 3'",
        de: 'setze Farben auf _ _ _',
        type: 'command',
        inputs: [field('#ff0000', '%s', COLORS),
            field('#00ff00', '%s', COLORS), field('#0000ff', '%s', COLORS)],
        body: [run('cal_rgb(c1, c2, c3)',
            [v('color 1'), v('color 2'), v('color 3')])]
    },
    {
        spec: 'turn off RGB LEDs',
        de: 'eingebaute RGB-LEDs ausschalten',
        type: 'command',
        body: [run('cal_rgb(c1, c2, c3)',
            [l('#000000'), l('#000000'), l('#000000')])]
    },
    {
        spec: "set motor %'motor' to %'speed' %",
        de: 'Motor _ an mit _ %',
        type: 'command',
        inputs: [menu(['M0', 'M1', 'M0 & M1']), field('100', '%n')],
        body: [run('cal_motor(motor, speed)', [v('motor'), v('speed')])]
    },

    // sound
    {
        spec: "play tone %'frequency' Hz volume %'volume' %",
        de: 'spiele Ton _ Hz mit Lautstärke _ %',
        type: 'command',
        inputs: [field('440', '%n', ['262', '294', '330', '349', '392',
            '440', '494', '523']), field('100', '%n')],
        body: [run('cal_tone(freq, volume)', [v('frequency'), v('volume')])],
        space: true
    },
    {
        spec: 'stop tone',
        de: 'stoppe Ton',
        type: 'command',
        body: [run('cal_stop_tone()')]
    },

    // sensors
    sensor('light intensity', 'Lichtstärke', 'cal_light()', true),
    sensor('temperature °C', 'Temperatur °C', 'cal_temperature()'),
    sensor('compass heading °', 'Kompassrichtung °', 'cal_compass()'),
    sensor('pitch', 'Pitch', 'cal_pitch()'),
    sensor('roll', 'Roll', 'cal_roll()'),
    sensor('sound level', 'Lautstärke', 'cal_sound()'),
    {
        spec: "acceleration %'axis' mg",
        de: 'Beschleunigung _ mg',
        type: 'reporter',
        inputs: [menu(AXES)],
        body: [report(call('cal_acceleration(axis)', [v('axis')]))]
    },
    {
        spec: "magnetic force %'axis' µT",
        de: 'Magnetkraft _ µT',
        type: 'reporter',
        inputs: [menu(AXES, 'Betrag')],
        body: [report(call('cal_magnetic(axis)', [v('axis')]))]
    },
    {
        spec: "analog value of pin %'pin'",
        de: 'analoger Wert von Pin _',
        type: 'reporter',
        inputs: [menu(PINS_ANALOG)],
        body: [
            `<block s="doDeclareVariables">${list([l('value')])}</block>`,
            `<block s="doSetVar">${l('value')}${call('cal_analog(pin)',
                [v('pin')])}</block>`,
            `<block s="doUntil">${not(lt(v('value'), l('0')))}<script>` +
                `<block s="doSetVar">${l('value')}${call('cal_analog(pin)',
                    [v('pin')])}</block></script></block>`,
            report(v('value'))
        ]
    },

    // pins
    {
        spec: "set pin %'pin' to input %'mode'",
        de: 'setze Eingang _ auf _',
        type: 'command',
        inputs: [menu(PINS_GPIO), menu(['Pullup', 'Pulldown', 'nichts'])],
        body: [run('cal_pull(pin, mode)', [v('pin'), v('mode')])],
        space: true
    },
    {
        spec: "pin %'pin' is high?",
        de: 'ist Pin _ hoch?',
        type: 'predicate',
        inputs: [menu(PINS_GPIO)],
        body: [report(call('cal_pin_high(pin)', [v('pin')]))]
    },
    {
        spec: "set digital pin %'pin' to %'level'",
        de: 'setze digitalen Ausgang _ auf _',
        type: 'command',
        inputs: [menu(PINS_GPIO), field('1', '%n', ['0', '1'])],
        body: [run('cal_digital_out(pin, level)', [v('pin'), v('level')])]
    },
    {
        spec: "set analog pin %'pin' to %'level' %",
        de: 'setze analogen Ausgang _ auf _ %',
        type: 'command',
        inputs: [menu(PINS_GPIO), field('50', '%n')],
        body: [run('cal_analog_out(pin, percent)', [v('pin'), v('level')])]
    },
    {
        spec: "set servo at %'pin' to %'angle' °",
        de: 'setze Servo an _ auf Winkel _ °',
        type: 'command',
        inputs: [menu(PINS_GPIO), field('90', '%n')],
        body: [run('cal_servo(pin, angle)', [v('pin'), v('angle')])]
    },
    {
        spec: "listen for %'type' at pin %'pin'",
        de: 'warte auf _ an Pin _',
        type: 'command',
        inputs: [menu(['Impuls', 'Flanke', 'nichts']), menu(PINS_GPIO)],
        body: [run('cal_listen_pin(pin, type)', [v('pin'), v('type')])],
        space: true
    },
    {
        spec: "when %'event' at pin %'pin'",
        de: 'Wenn ein _ an Pin _ erkannt wird',
        type: 'hat',
        inputs: [menu(PIN_EVENTS), menu(PINS_GPIO)],
        body: [report(call('cal_pin_event(pin, event)',
            [v('pin'), v('event')]))]
    },
    {
        spec: "value of %'event' at pin %'pin'",
        de: 'Wert von _ an Pin _',
        type: 'reporter',
        inputs: [menu(PIN_EVENTS), menu(PINS_GPIO)],
        body: [report(call('cal_pin_event_value(pin, event)',
            [v('pin'), v('event')]))]
    }
];

// --- XML ------------------------------------------------------------------

function inputXML(inp) {
    const attrs = inp.readonly ? ' readonly="true"' : '';
    const opts = inp.options ?
            `<options>${esc(inp.options.join('\n'))}</options>` : '';
    return `<input type="${inp.type}"${attrs}>${esc(inp.def)}${opts}</input>`;
}

function definitionXML(b) {
    const inputs = (b.inputs || []).map(inputXML).join('');
    return `<block-definition s="${esc(b.spec)}" type="${b.type}" ` +
        `category="${esc(CATEGORY)}"${b.space ? ' space="true"' : ''}>` +
        '<header></header><code></code>' +
        `<translations>${esc('de:' + b.de + '\n')}</translations>` +
        `<inputs>${inputs}</inputs>` +
        `<script>${[load()].concat(b.body).join('')}</script>` +
        '</block-definition>';
}

const palette =
    `<palette><category name="${esc(CATEGORY)}" color="${COLOR}"/></palette>`;
const definitions = blocks.map(definitionXML).join('');

const library = '<blocks app="Snap! 12, https://snap.berkeley.edu" version="2">' +
    palette + definitions + '</blocks>';

const target = path.join(__dirname, 'calliope_module.xml');
fs.writeFileSync(target, library);
console.log(`wrote ${blocks.length} blocks to ${target}`);

// --- start project with the library preloaded ------------------------------
// An empty project (German names, one sprite) whose scene carries the
// "Calliope mini" category and all its blocks as global custom blocks.

const PROJECT = 'Calliope mini';
const project =
    `<project name="${esc(PROJECT)}" app="Snap! 12, https://snap.berkeley.edu" version="2">` +
    '<notes></notes>' +
    '<scenes select="1">' +
    `<scene name="${esc(PROJECT)}">` +
    '<notes></notes>' + palette + '<hidden></hidden>' +
    '<headers></headers><code></code>' +
    `<blocks>${definitions}</blocks>` +
    '<primitives></primitives>' +
    '<stage name="Bühne" width="480" height="360" costume="0" ' +
    'color="255,255,255,1" tempo="60" threadsafe="false" penlog="false" ' +
    'volume="100" pan="0" lines="round" ternary="false" hyperops="true" ' +
    'codify="false" inheritance="true" sublistIDs="false">' +
    '<costumes><list struct="atomic"></list></costumes>' +
    '<sounds><list struct="atomic"></list></sounds>' +
    '<variables></variables><blocks></blocks><scripts></scripts>' +
    '<sprites select="1">' +
    '<sprite name="Objekt" idx="1" x="0" y="0" heading="90" scale="1" ' +
    'volume="100" pan="0" rotation="1" draggable="true" costume="0" ' +
    'color="80,80,80,1" pen="tip">' +
    '<costumes><list struct="atomic"></list></costumes>' +
    '<sounds><list struct="atomic"></list></sounds>' +
    '<blocks></blocks><variables></variables><scripts></scripts>' +
    '</sprite>' +
    '</sprites>' +
    '</stage>' +
    '<variables></variables>' +
    '</scene>' +
    '</scenes>' +
    '</project>';

const templateTarget = path.join(__dirname, 'template.xml');
fs.writeFileSync(templateTarget, project);
console.log(`wrote start project ${templateTarget}`);
