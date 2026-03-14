const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('sidepanel.js security tests', () => {
    let sandbox;
    let sidepanelCode;
    let logArea;

    beforeAll(() => {
        sidepanelCode = fs.readFileSync(path.join(__dirname, '../extension/sidepanel.js'), 'utf8');
    });

    beforeEach(() => {
        logArea = {
            appendChild: jest.fn(),
            innerHTML: '',
            scrollTop: 0,
            scrollHeight: 100
        };

        const dom = {
            addEventListener: jest.fn(),
            getElementById: jest.fn((id) => {
                if (id === 'logArea') return logArea;
                return {
                    addEventListener: jest.fn(),
                    appendChild: jest.fn(),
                    value: '',
                    style: {},
                    children: []
                };
            }),
            createElement: jest.fn((tag) => ({
                style: {},
                textContent: '',
                className: '',
                set textContent(val) { this._textContent = val; },
                get textContent() { return this._textContent; }
            }))
        };

        sandbox = {
            document: dom,
            window: {
                addEventListener: dom.addEventListener
            },
            chrome: {
                storage: {
                    local: {
                        get: jest.fn((keys, cb) => cb({})),
                        set: jest.fn((data, cb) => cb && cb())
                    }
                },
                runtime: {
                    sendMessage: jest.fn(),
                    onMessage: {
                        addListener: jest.fn()
                    }
                }
            },
            console: console,
            setTimeout: setTimeout,
            Date: Date
        };

        vm.createContext(sandbox);
    });

    test('should NOT use innerHTML for storing logs', () => {
        vm.runInContext(sidepanelCode, sandbox);
        const domContentLoadedCallback = sandbox.document.addEventListener.mock.calls.find(call => call[0] === 'DOMContentLoaded')[1];
        domContentLoadedCallback();

        const onMessageCallback = sandbox.chrome.runtime.onMessage.addListener.mock.calls[0][0];

        // Mock innerHTML to see if it's accessed
        Object.defineProperty(logArea, 'innerHTML', {
            get: jest.fn(() => '<div style="color: var(--text-color); margin-bottom: 4px;">[12:00:00 PM] test</div>'),
            set: jest.fn()
        });

        onMessageCallback({ type: 'LOG', text: 'Secure message', level: 'info' });

        // Verify that chrome.storage.local.set was NOT called with innerHTML content
        const lastSetCall = sandbox.chrome.storage.local.set.mock.calls[sandbox.chrome.storage.local.set.mock.calls.length - 1][0];

        expect(lastSetCall.logs).toBeUndefined(); // Should not use 'logs' key anymore
        expect(lastSetCall.logEntries).toBeDefined();
        expect(lastSetCall.logEntries[0].message).toBe('Secure message');

        // Verify innerHTML was NOT read for storage
        expect(Object.getOwnPropertyDescriptor(logArea, 'innerHTML').get).not.toHaveBeenCalled();
    });

    test('should escape HTML using textContent', () => {
        vm.runInContext(sidepanelCode, sandbox);
        const domContentLoadedCallback = sandbox.document.addEventListener.mock.calls.find(call => call[0] === 'DOMContentLoaded')[1];
        domContentLoadedCallback();

        const onMessageCallback = sandbox.chrome.runtime.onMessage.addListener.mock.calls[0][0];

        const malicious = '<img src=x onerror=alert(1)>';
        onMessageCallback({ type: 'LOG', text: malicious, level: 'info' });

        // Find the created element
        const createdElement = sandbox.document.createElement.mock.results.find(r => r.value && r.value._textContent !== undefined).value;

        expect(createdElement._textContent).toContain(malicious);
        // In a real DOM, setting textContent escapes HTML.
        // Our mock confirms we used textContent instead of innerHTML.
    });
});
