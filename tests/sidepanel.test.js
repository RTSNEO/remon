const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('sidepanel.js unit tests', () => {
    let sandbox;
    let sidepanelCode;

    beforeAll(() => {
        sidepanelCode = fs.readFileSync(path.join(__dirname, '../extension/sidepanel.js'), 'utf8');
    });

    beforeEach(() => {
        // Mock DOM and Chrome API
        const dom = {
            addEventListener: jest.fn(),
            getElementById: jest.fn((id) => {
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
                className: ''
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

    test('should load logs from storage on initialization', () => {
        const storedLogs = [{ message: 'test message', type: 'info', time: '12:00:00 PM' }];
        sandbox.chrome.storage.local.get = jest.fn((keys, cb) => cb({ logEntries: storedLogs }));

        // Execute the script
        vm.runInContext(sidepanelCode, sandbox);

        // Find the DOMContentLoaded callback
        const domContentLoadedCallback = sandbox.document.addEventListener.mock.calls.find(call => call[0] === 'DOMContentLoaded')[1];
        domContentLoadedCallback();

        expect(sandbox.chrome.storage.local.get).toHaveBeenCalledWith(
            ['isRunning', 'goal', 'logEntries', 'cvFileName', 'cvContent'],
            expect.any(Function)
        );

        // Check if logs were reconstructed (renderLogEntry should have been called)
        expect(sandbox.document.createElement).toHaveBeenCalledWith('div');
    });

    test('log function should save structured data', () => {
        vm.runInContext(sidepanelCode, sandbox);
        const domContentLoadedCallback = sandbox.document.addEventListener.mock.calls.find(call => call[0] === 'DOMContentLoaded')[1];
        domContentLoadedCallback();

        // Extract the log function from the scope if possible,
        // but it's hidden in the DOMContentLoaded closure.
        // We can trigger it via a message.
        const onMessageCallback = sandbox.chrome.runtime.onMessage.addListener.mock.calls[0][0];

        onMessageCallback({ type: 'LOG', text: 'Hello Security', level: 'info' });

        expect(sandbox.chrome.storage.local.set).toHaveBeenCalledWith(
            expect.objectContaining({
                logEntries: expect.arrayContaining([
                    expect.objectContaining({
                        message: 'Hello Security',
                        type: 'info'
                    })
                ])
            })
        );
    });
});
