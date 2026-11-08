/*
    campus.js

    Starts Snap! in campus.html and connects it to its host page
    (Calliope Campus) by postMessage. Snap! itself offers no postMessage
    interface; this bridge translates the messages into its JavaScript API
    (src/api.js), which only a page on Snap!'s own origin can use.

    The host passes ?parentOrigin=<its origin> in the URL. Messages from any
    other window or origin are ignored, and messages go out to that origin
    only.

    host -> Snap!
        {type: 'snap.load', xml, key}     open a project; an empty xml opens
                                          the start project (template.xml)
        {type: 'snap.setActive', active}  false while the host shows another
                                          editor: Snap! pauses completely
        {type: 'snap.readonly', readonly} lock editing as far as Snap! allows
                                          and report no changes
        {type: 'snap.requestProject'}     answer with snap.changed right away
        {type: 'calliope.*'}              device messages, see calliope.js

    Snap! -> host
        {type: 'snap.ready'}              the IDE is up, waiting for snap.load
        {type: 'snap.loaded', key, xml, fromTemplate}
                                          the project is open; xml is how
                                          Snap! serializes it
        {type: 'snap.changed', key, xml}  the project changed (debounced)
        {type: 'snap.save', key, xml}     the user saved (Ctrl+S, menu)
        {type: 'snap.runtimeVersion', runtimeVersion, hardware}
                                          from calliope.js after a handshake
        {type: 'calliope.*'}              device access, see calliope.js
*/

/*global WorldMorph, IDE_Morph, HandMorph, WorldMorph, ScriptsMorph,
SnapExtensions*/

(function () {
    'use strict';

    var TEMPLATE = 'libraries/calliope/template.xml',
        CALLIOPE_JS = 'libraries/calliope/calliope.js',
        CATEGORY = 'Calliope mini',
        DEBOUNCE = 800, // ms after the last edit before changes go out
        CHECK = 400, // ms between checks for unsaved changes
        params = new URLSearchParams(location.search),
        parentOrigin = params.get('parentOrigin'),
        embedded = !!parentOrigin && window.parent !== window,
        world,
        ide,
        ready = false,
        active = true,
        readonly = false,
        loading = false,
        key = null,
        lastXml = null,
        paletteWidth = null, // the palette's width before read only
        changedAt = 0,
        pendingLoad = null;

    function post(message) {
        if (embedded) {
            window.parent.postMessage(message, parentOrigin);
        }
    }

    // loading projects ----------------------------------------------------

    function selectCategory(category) {
        if (!ide.categories || !ide.categories.buttons) {return; }
        if (!ide.categories.buttons.some(b => b.category === category)) {
            return;
        }
        ide.currentCategory = category;
        ide.categories.buttons.forEach(each => each.refresh());
        ide.refreshPalette(true);
    }

    function armHats() {
        // Snap! pauses generic WHEN hats after opening a project until the
        // green flag is clicked. Here they react right away, as hats do in
        // the other Calliope editors, so "when button A is clicked" works
        // as soon as a program is open. Not in read only: a viewer's copy
        // must not drive the device.
        var threads = ide.stage.threads;
        threads.pauseCustomHatBlocks = readonly;
        ide.controlBar.stopButton.refresh();
    }

    function load(xml, projectKey) {
        if (!ready) {
            pendingLoad = {xml: xml, key: projectKey};
            return;
        }
        var fromTemplate = !xml;
        loading = true;
        key = projectKey === undefined ? null : projectKey;
        if (fromTemplate) {
            ide.getURL(TEMPLATE, template => open(template, true));
        } else {
            open(xml, false);
        }
    }

    function open(xml, fromTemplate) {
        // what ide.loadProjectXML() does, with a callback once it is open
        ide.onNextStep = null;
        ide.world().animations = [];
        ide.openProjectString(xml, () => {
            selectCategory(CATEGORY);
            applyReadonly();
            armHats();
            ide.resetUnsavedChanges();
            lastXml = ide.getProjectXML();
            changedAt = 0;
            loading = false;
            post({
                type: 'snap.loaded',
                key: key,
                xml: lastXml,
                fromTemplate: fromTemplate
            });
        });
    }

    // reporting changes ---------------------------------------------------

    function flush(type, force) {
        var xml;
        if (!ready || loading || readonly) {return; }
        if (!force && !ide.unsavedChanges()) {return; }
        xml = ide.getProjectXML();
        ide.resetUnsavedChanges();
        changedAt = 0;
        if (xml === lastXml && type === 'snap.changed' && !force) {return; }
        lastXml = xml;
        post({type: type, key: key, xml: xml});
    }

    function watchChanges() {
        var record = ide.recordUnsavedChanges,
            save = IDE_Morph.prototype.save;

        // remember when the last edit happened, for the debounce
        ide.recordUnsavedChanges = function () {
            changedAt = Date.now();
            return record.apply(this, arguments);
        };

        // "save" (Ctrl+S, file menu) goes to the host instead of the
        // browser's local storage
        IDE_Morph.prototype.save = function () {
            if (!embedded) {return save.apply(this, arguments); }
            if (readonly) {return; }
            flush('snap.save', true);
            this.showMessage('Gespeichert', 1);
        };

        setInterval(() => {
            if (!active || loading || readonly) {return; }
            if (!ide.unsavedChanges()) {return; }
            if (!changedAt) {changedAt = Date.now(); }
            if (Date.now() - changedAt >= DEBOUNCE) {
                flush('snap.changed');
            }
        }, CHECK);
    }

    // read only -----------------------------------------------------------
    // Snap! has no read-only mode. Locked here: dragging (blocks, sprites,
    // palette), editing text and numbers in blocks, context menus, typing
    // blocks with the keyboard; the palette is hidden. Scripts can still be
    // clicked and run; nothing of it is reported to the host.

    function lockEditing() {
        var grab = HandMorph.prototype.grab,
            mouseUp = HandMorph.prototype.processMouseUp,
            edit = WorldMorph.prototype.edit;

        HandMorph.prototype.grab = function () {
            if (readonly) {return; }
            return grab.apply(this, arguments);
        };
        HandMorph.prototype.processMouseUp = function () {
            if (readonly && this.mouseButton === 'right') {
                this.mouseButton = null;
                return;
            }
            return mouseUp.apply(this, arguments);
        };
        WorldMorph.prototype.edit = function () {
            if (readonly) {return; }
            return edit.apply(this, arguments);
        };
    }

    function applyReadonly() {
        var hidden = readonly;
        ScriptsMorph.prototype.enableKeyboard = !readonly;
        // the scripts take the palette's room (not saved as a preference)
        if (hidden && paletteWidth === null) {
            paletteWidth = ide.paletteWidth;
            ide.paletteWidth = 0;
        } else if (!hidden && paletteWidth !== null) {
            ide.paletteWidth = paletteWidth;
            paletteWidth = null;
        }
        [ide.categories, ide.palette, ide.paletteHandle].forEach(pane => {
            if (!pane) {return; }
            if (hidden) {
                pane.hide();
            } else {
                pane.show();
            }
        });
        ide.fixLayout();
    }

    function setReadonly(flag) {
        if (flag) {flush('snap.changed'); } // before it stops reporting
        readonly = !!flag;
        if (ready) {
            applyReadonly();
            armHats();
        }
    }

    // active / paused -----------------------------------------------------

    function setActive(flag) {
        var wasActive = active;
        if (!flag && wasActive) {flush('snap.changed'); }
        active = !!flag;
        if (active && !wasActive && world) {
            // the frame may have changed size while it was hidden
            world.fillPage();
        }
    }

    // messages from the host ----------------------------------------------

    window.addEventListener('message', event => {
        var data = event.data;
        if (!embedded || event.source !== window.parent ||
                event.origin !== parentOrigin) {
            return;
        }
        if (!data || typeof data !== 'object' ||
                typeof data.type !== 'string') {
            return;
        }
        switch (data.type) {
        case 'snap.load':
            load(data.xml, data.key);
            break;
        case 'snap.setActive':
            setActive(data.active !== false);
            break;
        case 'snap.readonly':
            setReadonly(data.readonly !== false);
            break;
        case 'snap.requestProject':
            flush('snap.changed', true);
            break;
        }
    });

    // start ---------------------------------------------------------------
    // like snap.html, without service worker and tracking

    window.onload = function () {
        var FPS = 60,
            lastTime = 0,
            loop = timestamp => {
                requestAnimationFrame(loop);
                if (!active) {return; } // paused: no stepping, no drawing
                if (timestamp - lastTime < 1000 / FPS) {return; }
                world.doOneCycle();
                lastTime = Math.max(
                    lastTime + 1000 / FPS,
                    timestamp - 1000 / FPS
                );
            };

        // calliope.js is already loaded; blocks asking for it again are fine
        SnapExtensions.scripts.push(CALLIOPE_JS);
        lockEditing();

        world = new WorldMorph(document.getElementById('world'));
        ide = new IDE_Morph({
            lang: params.get('lang') || 'de',
            noCloud: true,
            hideCloudMenu: true,
            noExitWarning: embedded,
            noDevWarning: true,
            // the start project; also tells when the IDE is ready
            load: TEMPLATE,
            onload: () => {
                selectCategory(CATEGORY);
                ide.resetUnsavedChanges();
                lastXml = ide.getProjectXML();
                ready = true;
                watchChanges();
                window.SnapCampus = {ide: ide, world: world}; // for debugging
                if (pendingLoad) {
                    load(pendingLoad.xml, pendingLoad.key);
                    pendingLoad = null;
                }
                post({type: 'snap.ready'});
            }
        });
        ide.openIn(world);
        requestAnimationFrame(loop);
    };
}());
