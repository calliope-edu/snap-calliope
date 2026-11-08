/*
    render.js

    Preview pictures of Snap! projects for render.html. Snap! runs without
    a visible IDE; each job opens a project and draws its scripts.

    host -> page
        {type: 'rendersnap', id, project}   project: the project XML
    page -> host (to the window and origin the job came from)
        {source: 'snap-calliope-render', type: 'renderready'}
        {source: 'snap-calliope-render', type: 'rendersnap', id,
            png, width, height}             png: a data URL
        {source: 'snap-calliope-render', type: 'rendersnap', id, error}

    The picture shows the scripts of the sprite that was selected when the
    project was saved, else those of the stage, else of any other sprite;
    a project without scripts gets a picture of its stage.
*/

/*global WorldMorph, IDE_Morph, SnapExtensions, newCanvas, Point*/

(function () {
    'use strict';

    var SOURCE = 'snap-calliope-render',
        TEMPLATE = 'libraries/calliope/template.xml',
        MAX_SIDE = 1600, // px; larger pictures are scaled down
        PADDING = 8,
        params = new URLSearchParams(location.search),
        world,
        ide,
        ready = false,
        queue = [];

    function hasScripts(obj) {
        return obj && obj.scripts &&
            obj.scripts.children.some(child => child.isVisible);
    }

    function pick() {
        var sprites = ide.sprites.itemsArray();
        if (hasScripts(ide.currentSprite)) {return ide.currentSprite; }
        if (hasScripts(ide.stage)) {return ide.stage; }
        return sprites.find(hasScripts) || null;
    }

    function picture() {
        var owner = pick(), pic, scale, out, ctx;
        if (owner) {
            pic = owner.scripts.scriptsPicture();
        } else {
            pic = ide.stage.fullImage();
        }
        if (!pic || !pic.width || !pic.height) {
            throw new Error('Empty picture');
        }
        scale = Math.min(1, MAX_SIDE / Math.max(pic.width, pic.height));
        out = newCanvas(new Point(
            Math.round(pic.width * scale) + 2 * PADDING,
            Math.round(pic.height * scale) + 2 * PADDING
        ), true); // non-retina: exact pixels
        ctx = out.getContext('2d');
        ctx.drawImage(
            pic,
            PADDING,
            PADDING,
            out.width - 2 * PADDING,
            out.height - 2 * PADDING
        );
        return out;
    }

    function render(job) {
        var answer = {source: SOURCE, type: 'rendersnap', id: job.id}, pic;
        try {
            if (typeof job.project !== 'string' || !job.project) {
                throw new Error('No project');
            }
            ide.rawOpenProjectString(job.project);
            pic = picture();
            answer.png = pic.toDataURL('image/png');
            answer.width = pic.width;
            answer.height = pic.height;
        } catch (err) {
            answer.error = String(err && err.message ? err.message : err);
        }
        job.reply(answer);
    }

    window.addEventListener('message', event => {
        var data = event.data, source = event.source, origin = event.origin;
        if (!data || data.type !== 'rendersnap' || !source) {return; }
        queue.push({
            id: data.id,
            project: data.project,
            reply: answer => source.postMessage(answer, origin)
        });
        if (ready) {
            while (queue.length) {render(queue.shift()); }
        }
    });

    window.onload = function () {
        SnapExtensions.scripts.push('libraries/calliope/calliope.js');
        world = new WorldMorph(document.getElementById('world'), false);
        ide = new IDE_Morph({
            lang: params.get('lang') || 'de',
            noCloud: true,
            hideCloudMenu: true,
            noExitWarning: true,
            noDevWarning: true,
            noUserSettings: true,
            load: TEMPLATE,
            onload: () => {
                ready = true;
                while (queue.length) {render(queue.shift()); }
                if (window.parent !== window) {
                    window.parent.postMessage(
                        {source: SOURCE, type: 'renderready'},
                        '*' // carries nothing but the news that it is up
                    );
                }
            }
        });
        ide.openIn(world);
        // a slow heartbeat for what Snap! defers to its next step; nothing
        // is shown, so there is no need for 60 frames a second
        setInterval(() => world.doOneCycle(), 100);
    };
}());
