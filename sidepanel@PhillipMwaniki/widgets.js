// Finds widget packages, loads them into cards, and keeps a broken widget
// from taking the rest of the panel down with it. See docs/WIDGETS.md for
// the contract widgets implement.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const { requireModule, unloadModule, getModuleByIndex } = imports.misc.fileUtils;

var API_VERSION = 1;

// Other applets offer a widget by shipping it in this folder.
const XLET_WIDGET_DIR = 'sidepanel-widget';

function readManifest(dir) {
    const file = Gio.File.new_for_path(`${dir}/widget.json`);
    if (!file.query_exists(null))
        return null;
    const [, bytes] = file.load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
}

function listSubdirs(path) {
    const dirs = [];
    const parent = Gio.File.new_for_path(path);
    if (!parent.query_exists(null))
        return dirs;
    // Default flags follow symlinks, which matters because applets under
    // development are usually symlinked into place.
    const children = parent.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null)) !== null) {
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            dirs.push(`${path}/${info.get_name()}`);
    }
    children.close(null);
    return dirs;
}

// Built-in widgets win over same-id widgets from applets; user-installed
// applets win over system ones.
function discover(builtinDir, extraDirs) {
    const found = new Map();
    const add = (dir, builtin) => {
        try {
            const meta = readManifest(dir);
            if (meta && meta.id && !found.has(meta.id))
                found.set(meta.id, { meta, dir, builtin });
        } catch (e) {
            global.logError(`sidepanel: bad widget.json in ${dir}: ${e.message}`);
        }
    };

    for (const dir of listSubdirs(builtinDir))
        add(dir, true);
    for (const root of [`${GLib.get_user_data_dir()}/cinnamon/applets`, '/usr/share/cinnamon/applets']) {
        for (const xletDir of listSubdirs(root))
            add(`${xletDir}/${XLET_WIDGET_DIR}`, false);
    }
    for (const dir of extraDirs)
        add(dir, false);
    return [...found.values()];
}

var WidgetHost = class WidgetHost {
    constructor({ container, settings, panel, builtinDir }) {
        this._container = container;
        this._settings = settings;
        this._panel = panel;
        this._builtinDir = builtinDir;
        this._loaded = [];
    }

    load() {
        const order = this._settings.getValue('widget-order') || [];
        const disabled = new Set(this._settings.getValue('disabled-widgets') || []);
        const rank = entry => {
            const index = order.indexOf(entry.meta.id);
            return index === -1 ? order.length + (entry.builtin ? 0 : 1) : index;
        };
        const entries = discover(this._builtinDir, this._settings.getValue('extra-widget-dirs') || [])
            .filter(entry => !disabled.has(entry.meta.id))
            .sort((a, b) => rank(a) - rank(b) || a.meta.name.localeCompare(b.meta.name));

        for (const entry of entries)
            this._loaded.push(this._create(entry));
    }

    reload() {
        this.destroy();
        this.load();
    }

    shown() {
        this._each('onShown');
    }

    hidden() {
        this._each('onHidden');
    }

    destroy() {
        for (const record of this._loaded) {
            this._call(record, 'destroy');
            record.card.destroy();
            if (record.moduleIndex !== undefined)
                unloadModule(record.moduleIndex);
        }
        this._loaded = [];
    }

    _create(entry) {
        const { meta, dir } = entry;
        const card = new St.BoxLayout({ vertical: true, style_class: meta.card === false ? 'sidepanel-bare' : 'sidepanel-card' });
        if (meta.card !== false && meta.showTitle !== false)
            card.add_child(new St.Label({ text: meta.name, style_class: 'sidepanel-card-title' }));
        this._container.add_child(card);

        const record = { entry, card, widget: null, moduleIndex: undefined };
        try {
            if ((meta.api || 1) > API_VERSION)
                throw new Error(`needs widget API ${meta.api}, this panel provides ${API_VERSION}`);
            // Loading through requireModule with the widget's own folder lets
            // the widget require() its own files relative to itself, and lets
            // us unload them again on reload.
            record.moduleIndex = requireModule(`${dir}/${meta.main || 'widget.js'}`, dir, meta, 'applet', false, true);
            const module = getModuleByIndex(record.moduleIndex);
            if (!module || typeof module.Widget !== 'function')
                throw new Error('widget.js does not define a Widget class');
            record.widget = new module.Widget(this._context(entry));
            card.add_child(record.widget.actor);
        } catch (e) {
            global.logError(`sidepanel: widget ${meta.id} failed to load: ${e.message}\n${e.stack || ''}`);
            card.add_child(new St.Label({ text: `${meta.name} could not load: ${e.message}`, style_class: 'sidepanel-error' }));
            card.get_last_child().clutter_text.line_wrap = true;
            record.widget = null;
        }
        return record;
    }

    _context(entry) {
        const id = entry.meta.id;
        return {
            id,
            dir: entry.dir,
            meta: entry.meta,
            apiVersion: API_VERSION,
            closePanel: () => this._panel.close(),
            settings: {
                get: (key, fallback) => {
                    const all = this._settings.getValue('widget-settings') || {};
                    const own = all[id] || {};
                    return key in own ? own[key] : fallback;
                },
                set: (key, value) => {
                    const all = Object.assign({}, this._settings.getValue('widget-settings') || {});
                    all[id] = Object.assign({}, all[id], { [key]: value });
                    this._settings.setValue('widget-settings', all);
                },
            },
        };
    }

    _each(method) {
        for (const record of this._loaded)
            this._call(record, method);
    }

    _call(record, method) {
        if (!record.widget || typeof record.widget[method] !== 'function')
            return;
        try {
            record.widget[method]();
        } catch (e) {
            global.logError(`sidepanel: widget ${record.entry.meta.id}.${method}() failed: ${e.message}`);
        }
    }
};
