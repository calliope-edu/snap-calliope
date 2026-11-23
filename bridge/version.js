/*
    version.js

    Says which build of snap-calliope runs (docs/build-info.md), from
    window.SNAP_CALLIOPE_BUILD, the constant scripts/build.mjs writes into
    build-info.js next to BUILD.json with the same values:

    - one line at the bottom of Snap!'s logo menu, below a separator, black
      text: "calliope-v1.0.0 · 7ea9962" on live; on dev and local a framed
      "dev" or "local" mark before "calliope-main · a1b2c3d". A click opens
      the commit on GitHub; the hint names the Snap! release and build time.
    - embedded in Campus (?parentOrigin=...), one line in the console at
      startup.

    Snap! itself stays unchanged: this wraps IDE_Morph.prototype.snapMenu at
    runtime and adds to the menu it builds.
*/

/*global IDE_Morph, MenuMorph, MorphicPreferences, newCanvas, Point*/

(function () {
    'use strict';

    var REPO = 'https://github.com/calliope-edu/snap-calliope',
        info = window.SNAP_CALLIOPE_BUILD,
        params = new URLSearchParams(location.search),
        embedded = !!params.get('parentOrigin') && window.parent !== window;

    if (!info) {return; }

    function short(commit) {
        return (commit || '').slice(0, 7);
    }

    // "calliope-v1.0.0 · 7ea9962", without the dot when there is no commit
    function versionText() {
        return [info.version, short(info.commit)].filter(Boolean).join(' · ');
    }

    // the framed channel mark, drawn black on transparent like the menu text
    function channelMark(text) {
        var size = Math.round(MorphicPreferences.menuFontSize * 0.85),
            font = size + 'px ' + MorphicPreferences.menuFontName,
            pad = 3,
            canvas = newCanvas(new Point(1, 1)),
            ctx = canvas.getContext('2d'),
            width,
            height = size + pad * 2;

        ctx.font = font;
        width = Math.ceil(ctx.measureText(text).width) + pad * 2 + 2;
        canvas = newCanvas(new Point(width, height));
        ctx = canvas.getContext('2d');
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
        ctx.fillStyle = 'black';
        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, pad + 1, height / 2 + 0.5);
        return canvas;
    }

    function label() {
        if (info.channel === 'live') {return versionText(); }
        return [channelMark(info.channel), versionText()];
    }

    function hint() {
        var lines = [];
        if (info.libs && info.libs.snap) {lines.push('Snap! ' + info.libs.snap); }
        if (info.builtAt) {lines.push('gebaut ' + info.builtAt); }
        return lines.join('\n');
    }

    function openCommit() {
        if (info.commit) {
            window.open(REPO + '/commit/' + info.commit, '_blank');
        }
    }

    function addVersionLine(menu) {
        menu.addLine();
        menu.addItem(
            label(),
            openCommit,
            hint(),
            null, // color: the menu's own, black
            null, // bold
            null, // italic
            null, // doubleClickAction
            null, // shortcut
            true // verbatim: no translation
        );
    }

    // snapMenu() builds its menu and pops it up in one go; the line goes in
    // just before that popup.
    var snapMenu = IDE_Morph.prototype.snapMenu;
    IDE_Morph.prototype.snapMenu = function () {
        var ide = this,
            popup = MenuMorph.prototype.popup;
        MenuMorph.prototype.popup = function () {
            MenuMorph.prototype.popup = popup;
            if (this.target === ide) {addVersionLine(this); }
            return popup.apply(this, arguments);
        };
        try {
            return snapMenu.apply(this, arguments);
        } finally {
            MenuMorph.prototype.popup = popup;
        }
    };

    if (embedded) {
        console.info(
            '[snap-calliope] ' + info.channel + ' ' + versionText(),
            info
        );
    }
}());
