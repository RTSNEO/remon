const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('buildAntiLoopWarning', () => {
  let context;
  let buildAntiLoopWarning;

  beforeAll(() => {
    const code = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

    // Mock chrome API
    const chrome = {
      sidePanel: { setPanelBehavior: jest.fn().mockReturnValue({ catch: jest.fn() }) },
      offscreen: {
        hasDocument: jest.fn().mockResolvedValue(false),
        createDocument: jest.fn().mockResolvedValue({}),
        closeDocument: jest.fn().mockResolvedValue({}),
      },
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn().mockReturnValue({ catch: jest.fn() }),
        lastError: null,
      },
      storage: {
        local: {
          set: jest.fn(),
          get: jest.fn(),
        },
      },
      tabs: {
        query: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        get: jest.fn().mockResolvedValue({}),
        sendMessage: jest.fn(),
        captureVisibleTab: jest.fn().mockResolvedValue(''),
        reload: jest.fn().mockResolvedValue({}),
      },
      scripting: {
        executeScript: jest.fn().mockResolvedValue([]),
      },
    };

    context = {
      chrome,
      console: {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      },
      setTimeout: jest.fn(),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
      fetch: jest.fn(),
      URL: global.URL,
      URLSearchParams: global.URLSearchParams,
      Math: global.Math,
      Promise: global.Promise,
      JSON: global.JSON,
    };

    vm.createContext(context);
    vm.runInContext(code, context);
    buildAntiLoopWarning = context.buildAntiLoopWarning;
  });

  test('should return empty string for short action history', () => {
    expect(buildAntiLoopWarning([])).toBe('');
    expect(buildAntiLoopWarning([{ type: 'click', id: 1 }])).toBe('');
    expect(buildAntiLoopWarning([{ type: 'click', id: 1 }, { type: 'click', id: 2 }])).toBe('');
  });

  test('should return empty string when no loop is detected', () => {
    const recentActions = [
      { type: 'click', id: 1 },
      { type: 'click', id: 2 },
      { type: 'click', id: 3 },
    ];
    expect(buildAntiLoopWarning(recentActions)).toBe('');
  });

  test('should detect consecutive loop (A, A, A)', () => {
    const recentActions = [
      { type: 'click', id: 1 },
      { type: 'click', id: 1 },
      { type: 'click', id: 1 },
    ];
    const warning = buildAntiLoopWarning(recentActions);
    expect(warning).toContain('CRITICAL WARNING');
    expect(warning).toContain('interacted with element ID [1] 3 times recently');
  });

  test('should detect sequence loop (A, B, A, B)', () => {
    const recentActions = [
      { type: 'click', id: 1 },
      { type: 'type', id: 2 },
      { type: 'click', id: 1 },
      { type: 'type', id: 2 },
    ];
    const warning = buildAntiLoopWarning(recentActions);
    expect(warning).toContain('WARNING: You are in a repeating sequence loop');
    expect(warning).toContain('Alternating between [1] and [2]');
  });

  test('consecutive loop takes precedence over sequence loop', () => {
    // A, A, A, A
    // Technically, it hits the first IF and returns.
    const recentActions = [
      { type: 'click', id: 1 },
      { type: 'click', id: 1 },
      { type: 'click', id: 1 },
      { type: 'click', id: 1 },
    ];
    const warning = buildAntiLoopWarning(recentActions);
    expect(warning).toContain('CRITICAL WARNING');
  });

  test('should handle different action types with same ID correctly (no consecutive loop)', () => {
    const recentActions = [
      { type: 'click', id: 1 },
      { type: 'type', id: 1 },
      { type: 'click', id: 1 },
    ];
    // count will be 2 for {type: 'click', id: 1} and 1 for others.
    // wait, count = recentActions.filter(a => a.type === last.type && a.id === last.id).length;
    // last is {type: 'click', id: 1}. filter returns 2 elements.
    // 2 < 3, so no consecutive loop warning.
    expect(buildAntiLoopWarning(recentActions)).toBe('');
  });

  test('should handle same type but different IDs correctly (no consecutive loop)', () => {
    const recentActions = [
      { type: 'click', id: 1 },
      { type: 'click', id: 2 },
      { type: 'click', id: 1 },
    ];
    expect(buildAntiLoopWarning(recentActions)).toBe('');
  });
});
