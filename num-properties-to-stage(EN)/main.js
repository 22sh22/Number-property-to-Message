'use strict';

const { Plugin, PluginSettingTab, Setting, Modal, MarkdownView } = require('obsidian');

const DEFAULT_SETTINGS = {
    properties: []
};

class PropertySettingModal extends Modal {
    constructor(app, plugin, property, onSubmit) {
        super(app);
        this.plugin = plugin;
        this.property = property;
        this.onSubmit = onSubmit;
        this.tempProperty = property ? 
            JSON.parse(JSON.stringify(property)) : 
            {
                name: "",
                range: { min: 0, max: 4 },
                messages: []
            };
        this.adjustMessages();
    }

    onOpen() {
        this.contentEl.empty();

        this.contentEl.createEl('h2', { text: this.property ? 'Edit Properties' : 'New Property' });

        new Setting(this.contentEl)
            .setName('Property Name')
            .addText(text => text
                .setValue(this.tempProperty.name)
                .onChange(value => this.tempProperty.name = value));

        new Setting(this.contentEl)
            .setName('Set Range')
            .addText(text => text
                .setValue(String(this.tempProperty.range.min))
                .setPlaceholder('Minimum')
                .onChange(value => {
                    this.tempProperty.range.min = parseInt(value);
                    this.adjustMessages();
                }))
            .addText(text => text
                .setValue(String(this.tempProperty.range.max))
                .setPlaceholder('Maximum')
                .onChange(value => {
                    this.tempProperty.range.max = parseInt(value);
                    this.adjustMessages();
                }));

        this.createMessageSettings();

        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    this.onSubmit(this.tempProperty);
                    this.close();
                }))
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => this.close()));
    }

    createMessageSettings() {
        this.contentEl.createEl('h3', { text: 'Stage Messages' });
        
        this.tempProperty.messages.forEach((message, index) => {
            new Setting(this.contentEl)
                .setName(`Stage ${this.tempProperty.range.min + index}`)
                .addText(text => text
                    .setValue(message)
                    .onChange(value => {
                        this.tempProperty.messages[index] = value;
                    }));
        });
    }

    adjustMessages() {
        const count = this.tempProperty.range.max - this.tempProperty.range.min + 1;
        while (this.tempProperty.messages.length > count) {
            this.tempProperty.messages.pop();
        }
        while (this.tempProperty.messages.length < count) {
            const index = this.tempProperty.messages.length;
            this.tempProperty.messages.push(
                `It's on Stage ${this.tempProperty.range.min + index}`
            );
        }
        this.onOpen();
    }

    onClose() {
        this.contentEl.empty();
    }
}

class MetadataCustomizerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        this.containerEl.empty();

        this.containerEl.createEl('h2', { text: 'Stage Settings' });

        new Setting(this.containerEl)
            .setName('New Property')
            .setDesc('Configure number properties as stages')
            .addButton(button => button
                .setButtonText('Add')
                .onClick(async () => {
                    const modal = new PropertySettingModal(
                        this.app,
                        this.plugin,
                        null,
                        async (newProperty) => {
                            this.plugin.settings.properties.push(newProperty);
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    );
                    modal.open();
                }));

        this.plugin.settings.properties.forEach((property, index) => {
            new Setting(this.containerEl)
                .setName(property.name)
                .setDesc(`Range: ${property.range.min}-${property.range.max}`)
                .addButton(button => button
                    .setButtonText('Edit')
                    .onClick(() => {
                        const modal = new PropertySettingModal(
                            this.app,
                            this.plugin,
                            property,
                            async (updatedProperty) => {
                                this.plugin.settings.properties[index] = updatedProperty;
                                await this.plugin.saveSettings();
                                this.display();
                            }
                        );
                        modal.open();
                    }))
                .addButton(button => button
                    .setButtonText('Remove')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.properties.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        });
    }
}

class MetadataCustomizerPlugin extends Plugin {
    settings = DEFAULT_SETTINGS;
    mutationObserver = null;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new MetadataCustomizerSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.initializeMetadataObserver();
            })
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', () => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    const container = activeView.contentEl.querySelector('.metadata-container');
                    if (container) {
                        this.setupMetadataFields(container);
                    }
                }
            })
        );

        this.addStyle();
        this.initializeMetadataObserver();
    }

    initializeMetadataObserver() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const metadataContainer = activeView.contentEl.querySelector('.metadata-container');
        if (!metadataContainer) return;

        this.setupMetadataFields(metadataContainer);

        this.mutationObserver = new MutationObserver((mutations) => {
            const hasNewFields = mutations.some(mutation => 
                mutation.type === 'childList' && 
                Array.from(mutation.addedNodes).some(node => 
                    node.classList?.contains('metadata-property-value')
                )
            );
            
            if (hasNewFields) {
                this.setupMetadataFields(metadataContainer);
            }
        });

        this.mutationObserver.observe(metadataContainer, {
            childList: true,
            subtree: true
        });
    }

    addStyle() {
        const style = document.createElement('style');
        style.id = 'metadata-customizer-styles';
        style.textContent = `
            .metadata-property-value {
                position: relative;
                isolation: isolate;
            }
            .metadata-property-value.editing .metadata-input-number {
                color: var(--metadata-input-text-color);
                z-index: 2;
                position: relative;
            }
            .metadata-property-value.has-valid-message.editing .metadata-input-number {
                color: var(--metadata-input-text-color);
            }
            .metadata-property-value.has-valid-message .metadata-input-number {
                color: transparent;
            }
            .level-display {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                display: flex;
                align-items: center;
                cursor: text;
                white-space: pre-wrap;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 3;
                color: var(--metadata-input-text-color);
                font-size: var(--metadata-input-font-size);
                max-height: 300px;
                overflow-y: auto;
                padding: var(--size-4-1) var(--size-4-2);
                width: 100%;
                z-index: 1;
                background: transparent;
            }
            .metadata-property-value.editing .level-display {
                display: none;
                visibility: hidden;
                z-index: -1;
            }
            .metadata-property-value.no-custom .level-display {
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    setupMetadataFields(container) {
        container.querySelectorAll('.level-display').forEach(el => el.remove());
        container.querySelectorAll('.metadata-property-value').forEach(el => {
            el.classList.remove('editing', 'no-custom', 'has-valid-message');
        });

        container.querySelectorAll('.metadata-property-value').forEach(propertyValue => {
            const numberInput = propertyValue.querySelector('.metadata-input-number[type="number"]');
            if (!numberInput) return;

            const propertyKey = propertyValue.closest('.metadata-property')
                ?.querySelector('.metadata-property-key-input')
                ?.getAttribute('aria-label');
            
            if (!propertyKey) return;
            
            const property = this.settings.properties.find(p => p.name === propertyKey);
            if (!property) return;

            this.setupPropertyField(propertyValue, numberInput, property);
        });
    }

    setupPropertyField(propertyValue, inputElement, property) {
        const levelDisplay = propertyValue.createEl('div', { cls: 'level-display' });
        inputElement.placeholder = `${property.range.min}-${property.range.max} 사이의 수`;

        const updateDisplay = () => {
            const value = parseInt(inputElement.value);
            const messageIndex = value - property.range.min;
            
            if (value >= property.range.min && 
                value <= property.range.max && 
                property.messages[messageIndex]) {
                levelDisplay.textContent = property.messages[messageIndex];
                propertyValue.classList.remove('no-custom');
                propertyValue.classList.add('has-valid-message');
            } else {
                propertyValue.classList.add('no-custom');
                propertyValue.classList.remove('has-valid-message');
            }
            propertyValue.classList.remove('editing');
        };

        propertyValue.addEventListener('click', () => {
            propertyValue.classList.add('editing');
            propertyValue.classList.remove('no-custom');
            inputElement.focus();
        });

        inputElement.addEventListener('change', updateDisplay);
        inputElement.addEventListener('blur', updateDisplay);
        inputElement.addEventListener('keydown', e => {
            if (e.key === 'Escape') inputElement.blur();
        });

        if (inputElement.value) updateDisplay();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
        }

        const style = document.getElementById('metadata-customizer-styles');
        if (style) style.remove();
        
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            const container = activeView.contentEl.querySelector('.metadata-container');
            if (container) {
                container.querySelectorAll('.level-display').forEach(el => el.remove());
                container.querySelectorAll('.metadata-property-value').forEach(el => {
                    el.classList.remove('editing', 'no-custom', 'has-valid-message');
                });
            }
        }
    }
}

module.exports = MetadataCustomizerPlugin;