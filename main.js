const { Plugin, PluginSettingTab, Setting } = require('obsidian');

const defSettings = {
    customColor: '#ce5d97',
    colorGroups: [
        { id: "1", label: "Default: Latex", color: "#ce5d97", strings: "{=latex}" },
        { id: "2", label: "Alerts", color: "#e06c75", strings: "Choose Keyword..." }
    ]
}

class CodeColorPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.styleEl = document.createElement('style');
        this.styleEl.id = 'custom-code-color-styles';
        document.head.appendChild(this.styleEl);
        this.updateStyles();

        this.registerInterval(
            window.setInterval(() => this.highlightReadingMode(), 1000)
        );
        this.registerEvent(
            this.app.workspace.on('layout-change', () => this.highlightReadingMode())
        );

        this.registerEditorExtension(this.buildCodeMirrorExtension());

        this.addSettingTab(new CodeColorSettingTab(this.app, this));
    }

    onunload() {
        if (this.styleEl) this.styleEl.remove();
        this.clearReadingModeHighlights();
    }

    async loadSettings() {
        this.settings = Object.assign({}, defSettings, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    getCM6Modules() {
        try {
            const viewPkg = window.CodeMirrorViewer?.['@codemirror/view'] || require('@codemirror/view');
            const statePkg = window.CodeMirrorViewer?.['@codemirror/state'] || require('@codemirror/state');
            return {
                Decoration: viewPkg.Decoration,
                ViewPlugin: viewPkg.ViewPlugin,
                MatchDecorator: viewPkg.MatchDecorator,
                RangeSet: statePkg.RangeSet
            };
        } catch (e) {
            console.error("Custom Colorizer: Could not fetch internal CodeMirror 6 extensions.", e);
            return null;
        }
    }

    buildCodeMirrorExtension() {
        const modules = this.getCM6Modules();
        if (!modules) return [];

        const { Decoration, ViewPlugin, MatchDecorator, RangeSet } = modules;
        const pluginInstance = this;

        return ViewPlugin.fromClass(
            class {
                constructor(view) {
                    this.decorators = [];
                    this.updateDecorators();
                    this.decorations = this.combineDecorations(view);
                }

                update(update) {
                    if (update.docChanged || update.viewportChanged) {
                        this.decorations = this.combineDecorations(update.view);
                    }
                }

                updateDecorators() {
                    this.decorators = pluginInstance.settings.colorGroups.map(group => {
                        const targets = group.strings
                            .split(',')
                            .map(s => s.trim())
                            .filter(s => s.length > 0);

                        if (targets.length === 0) return null;

                        const escaped = targets.map(s => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
                        
                        return new MatchDecorator({
                            regexp: new RegExp(`(${escaped})`, 'g'),
                            decoration: Decoration.mark({
                                attributes: { 
                                    style: `color: ${group.color} !important; font-weight: bold;` 
                                }
                            })
                        });
                    }).filter(Boolean);
                }

                combineDecorations(view) {
                    this.updateDecorators();
                    
                    let sets = this.decorators.map(d => d.createDeco(view));
                    if (sets.length === 0) return Decoration.none;
                    
                    return RangeSet.join(sets);
                }
            },
            { decorations: v => v.decorations }
        );
    }

    highlightReadingMode() {
        const groups = this.settings.colorGroups || [];
        const targets = document.querySelectorAll('.markdown-preview-view');
        if (targets.length === 0) return;

        targets.forEach(preview => {
            const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null, false);
            let textNode;
            const nodesToReplace = [];

            while ((textNode = walker.nextNode())) {
                const parent = textNode.parentElement;
                if (!parent || parent.classList.contains('custom-user-string-highlight')) continue;

                const textVal = textNode.nodeValue;
                if (!textVal) continue;

                for (const group of groups) {
                    const phrases = group.strings.split(',').map(s => s.trim()).filter(s => s.length > 0);
                    for (const phrase of phrases) {
                        if (textVal.includes(phrase)) {
                            nodesToReplace.push({ node: textNode, match: phrase, color: group.color });
                            break;
                        }
                    }
                }
            }

            nodesToReplace.forEach(({ node, match, color }) => {
                if (!node.parentNode) return;
                const val = node.nodeValue;
                const index = val.indexOf(match);
                if (index !== -1) {
                    const fragment = document.createDocumentFragment();
                    if (index > 0) fragment.appendChild(document.createTextNode(val.substring(0, index)));

                    const span = document.createElement('span');
                    span.className = 'custom-user-string-highlight';
                    span.textContent = match;
                    span.style.color = color;
                    span.style.fontWeight = 'bold';
                    fragment.appendChild(span);

                    if (index + match.length < val.length) {
                        fragment.appendChild(document.createTextNode(val.substring(index + match.length)));
                    }
                    node.parentNode.replaceChild(fragment, node);
                }
            });
        });
    }

    clearReadingModeHighlights() {
        document.querySelectorAll('.custom-user-string-highlight').forEach(el => {
            if (el.parentNode) el.parentNode.replaceChild(document.createTextNode(el.textContent), el);
        });
    }

    hexToRgba(hex, alpha) {
        let c;
        if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
            c= hex.substring(1).split('');
            if(c.length== 3) c= [c[0], c[0], c[1], c[1], c[2], c[2]];
            c= '0x' + c.join('');
            return `rgba(${(c>>16)&255}, ${(c>>8)&255}, ${c&255}, ${alpha})`;
        }
        return hex;
    }

    updateStyles() {
        const color = this.settings.customColor;
        const bgColor = this.hexToRgba(color, 0.1);

        this.styleEl.textContent = `
            .markdown-source-view.mod-cm6 .cm-inline-code,
            .markdown-rendered code {
                color: ${color} !important; 
                background-color: ${bgColor} !important;
                border-radius: 4px !important;
                font-family: var(--font-monospace) !important;
            }
            .markdown-source-view.mod-cm6 .cm-atom,
            .markdown-source-view.mod-cm6 .cm-punctuation,
            .markdown-source-view.mod-cm6 .cm-operator,
            .markdown-source-view.mod-cm6 .cm-property,
            .markdown-source-view.mod-cm6 .cm-variable-2 {
                color: ${color} !important;
            }
            .cm-formatting-code-syntax {
                color: #999 !important;
                background-color: transparent !important;
            }
        `;
    }

    refreshEditors() {
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view && leaf.view.editor && leaf.view.editor.cm) {
                const cm = leaf.view.editor.cm;
                cm.dispatch({
                    effects: []
                });
            }
        });
    }
}

class CodeColorSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Custom Colorizer Settings' });

        new Setting(containerEl)
            .setName('Base Code Block Color')
            .setDesc('Color for standard markdown inline code components.')
            .addColorPicker(colorPicker => colorPicker
                .setValue(this.plugin.settings.customColor)
                .onChange(async (value) => {
                    this.plugin.settings.customColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateStyles();
                })
            );

        containerEl.createEl('hr');
        containerEl.createEl('h3', { text: 'Custom String Highlight Groups' });

        const groupsContainer = containerEl.createDiv('custom-color-groups-container');

        this.plugin.settings.colorGroups.forEach((group, index) => {
            const groupDiv = groupsContainer.createDiv({ attr: { style: 'border: 1px solid var(--background-modifier-border); padding: 12px; margin-bottom: 12px; border-radius: 6px;' } });
            
            new Setting(groupDiv)
                .setName(`Group #${index + 1}: Name`)
                .addText(text => text
                    .setValue(group.label)
                    .onChange(async (val) => {
                        group.label = val;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(groupDiv)
                .setName('Highlight Color')
                .addColorPicker(picker => picker
                    .setValue(group.color)
                    .onChange(async (val) => {
                        group.color = val;
                        await this.plugin.saveSettings();
                        this.plugin.clearReadingModeHighlights();
                        this.plugin.refreshEditors();
                    })
                );

            new Setting(groupDiv)
                .setName('Target Strings')
                .addTextArea(text => text
                    .setValue(group.strings)
                    .onChange(async (val) => {
                        group.strings = val;
                        await this.plugin.saveSettings();
                        this.plugin.clearReadingModeHighlights();
                        this.plugin.refreshEditors();
                    })
                );

            new Setting(groupDiv)
                .addButton(btn => btn
                    .setButtonText('Delete Group')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.clearReadingModeHighlights();
                        this.plugin.settings.colorGroups.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display();
                        this.plugin.refreshEditors();
                    })
                );
        });

        new Setting(containerEl)
            .addButton(btn => btn
                .setButtonText('+ Add Custom Color Group')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.colorGroups.push({
                        id: Date.now().toString(),
                        label: "New Group",
                        color: "#00ff00",
                        strings: "keyword1"
                    });
                    await this.plugin.saveSettings();
                    this.display();
                })
            );
    }
}

module.exports = CodeColorPlugin;