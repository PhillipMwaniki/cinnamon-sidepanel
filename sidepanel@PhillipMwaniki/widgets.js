// Finds widget packages, loads them into cards, and keeps a broken widget
// from taking the rest of the panel down with it. See docs/WIDGETS.md for
// the contract widgets implement.

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const { requireModule, unloadModule, getModuleByIndex } = imports.misc.fileUtils;

var API_VERSION = 1;

const DEFAULT_ORDER = 50;

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
        this._loaded = [];      // records of widgets on the panel, in order
        this._entries = [];     // every widget found, shown or hidden
        this._editing = false;

        this._hiddenSection = new St.BoxLayout({ vertical: true, style_class: 'sidepanel-card sidepanel-hidden-widgets', visible: false });
        this._container.add_child(this._hiddenSection);
    }

    load() {
        const order = this._settings.getValue('widget-order') || [];
        const disabled = new Set(this._settings.getValue('disabled-widgets') || []);
        // Widgets the user has placed come first, in their order; the rest
        // follow by the "order" hint in their widget.json.
        const rank = entry => {
            const index = order.indexOf(entry.meta.id);
            if (index !== -1)
                return index;
            const hint = typeof entry.meta.order === 'number' ? entry.meta.order : DEFAULT_ORDER;
            return order.length + hint;
        };
        this._entries = discover(this._builtinDir, this._settings.getValue('extra-widget-dirs') || [])
            .sort((a, b) => rank(a) - rank(b) || a.meta.name.localeCompare(b.meta.name));

        for (const entry of this._entries) {
            if (!disabled.has(entry.meta.id))
                this._loaded.push(this._create(entry));
        }
        this._updateHiddenSection();
        this._updateEditing();
    }

    reload() {
        this.destroy();
        this.load();
    }

    // Settings changed from outside (the settings dialog or a file edit;
    // our own setValue() calls don't signal).
    onSettingsChanged() {
        this.reload();
    }

    get editing() {
        return this._editing;
    }

    setEditing(editing) {
        this._editing = editing;
        this._updateEditing();
    }

    shown() {
        this._each('onShown');
    }

    hidden() {
        this._each('onHidden');
    }

    destroy() {
        for (const record of this._loaded)
            this._unload(record);
        this._loaded = [];
        this._entries = [];
    }

    _unload(record) {
        this._call(record, 'destroy');
        record.card.destroy();
        if (record.moduleIndex !== undefined)
            unloadModule(record.moduleIndex);
    }

    _create(entry) {
        const { meta, dir } = entry;
        const card = new St.BoxLayout({ vertical: true, style_class: meta.card === false ? 'sidepanel-bare' : 'sidepanel-card' });
        const record = { entry, card, widget: null, moduleIndex: undefined, title: null };

        card.add_child(this._editBar(record));
        if (meta.card !== false && meta.showTitle !== false) {
            record.title = new St.Label({ text: meta.name, style_class: 'sidepanel-card-title' });
            card.add_child(record.title);
        }
        this._container.insert_child_below(card, this._hiddenSection);

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

    // Shown only while customising: name, move up, move down, hide.
    _editBar(record) {
        const bar = new St.BoxLayout({ style_class: 'sidepanel-edit-bar', visible: false });
        bar.add_child(new St.Label({ text: record.entry.meta.name, style_class: 'sidepanel-card-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        const button = (iconName, label, callback) => {
            const b = new St.Button({ style_class: 'sidepanel-edit-button', can_focus: true, accessible_name: label });
            b.set_child(new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, icon_size: 14 }));
            b.connect('clicked', callback);
            new Tooltips.Tooltip(b, label);
            bar.add_child(b);
            return b;
        };
        record.upButton = button('go-up-symbolic', _('Move up'), () => this._move(record, -1));
        record.downButton = button('go-down-symbolic', _('Move down'), () => this._move(record, 1));
        button('view-conceal-symbolic', _('Hide'), () => this._hide(record));
        record.editBar = bar;
        return bar;
    }

    _move(record, delta) {
        const from = this._loaded.indexOf(record);
        const to = from + delta;
        if (to < 0 || to >= this._loaded.length)
            return;
        this._loaded.splice(from, 1);
        this._loaded.splice(to, 0, record);
        this._container.set_child_at_index(record.card, to);
        this._save();
        this._updateEditing();
    }

    _hide(record) {
        this._loaded.splice(this._loaded.indexOf(record), 1);
        this._unload(record);
        this._save();
        this._updateHiddenSection();
        this._updateEditing();
    }

    _show(entry) {
        const record = this._create(entry);
        this._loaded.push(record);
        if (this._panel.isOpen)
            this._call(record, 'onShown');
        this._save();
        this._updateHiddenSection();
        this._updateEditing();
    }

    _hiddenEntries() {
        const shown = new Set(this._loaded.map(record => record.entry.meta.id));
        return this._entries.filter(entry => !shown.has(entry.meta.id));
    }

    // The order keeps hidden widgets too, so re-adding one later puts it
    // back where it was relative to the others.
    _save() {
        const hidden = this._hiddenEntries().map(entry => entry.meta.id);
        const order = [...this._loaded.map(record => record.entry.meta.id), ...hidden];
        this._settings.setValue('widget-order', order);
        this._settings.setValue('disabled-widgets', hidden);
    }

    _updateEditing() {
        this._loaded.forEach((record, index) => {
            record.editBar.visible = this._editing;
            if (record.title)
                record.title.visible = !this._editing;
            record.upButton.reactive = index > 0;
            record.upButton.opacity = index > 0 ? 255 : 80;
            record.downButton.reactive = index < this._loaded.length - 1;
            record.downButton.opacity = index < this._loaded.length - 1 ? 255 : 80;
        });
        this._hiddenSection.visible = this._editing;
    }

    _updateHiddenSection() {
        this._hiddenSection.destroy_all_children();
        this._hiddenSection.add_child(new St.Label({ text: _('Hidden widgets'), style_class: 'sidepanel-card-title' }));
        const hidden = this._hiddenEntries();
        if (!hidden.length)
            this._hiddenSection.add_child(new St.Label({ text: _('Every widget is on the panel.'), style_class: 'sidepanel-empty' }));
        for (const entry of hidden) {
            const row = new St.BoxLayout({ style_class: 'sidepanel-hidden-row' });
            const text = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
            text.add_child(new St.Label({ text: entry.meta.name, style_class: 'sidepanel-hidden-name' }));
            if (entry.meta.description) {
                const description = new St.Label({ text: entry.meta.description, style_class: 'sidepanel-hidden-description' });
                description.clutter_text.line_wrap = true;
                text.add_child(description);
            }
            const add = new St.Button({ label: _('Add'), style_class: 'sidepanel-edit-add', can_focus: true, y_align: Clutter.ActorAlign.CENTER });
            add.connect('clicked', () => this._show(entry));
            row.add_child(text);
            row.add_child(add);
            this._hiddenSection.add_child(row);
        }
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
