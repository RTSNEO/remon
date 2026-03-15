const { io, updateStatus } = require('../server');

describe('updateStatus Utility', () => {
  let emitSpy;
  let consoleSpy;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    emitSpy = jest.spyOn(io, 'emit');

    // The task description mentioned a console.log, but the actual code doesn't have it.
    // If the function is updated to match the task description, this spy will catch it.
    // We mock console.log to avoid cluttering test output anyway.
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    emitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('should emit a status-update event with the provided message and default values', () => {
    const message = 'Test message';
    updateStatus(message);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('status-update', expect.objectContaining({
      message: message,
      type: 'info',
      progress: null,
      timestamp: expect.any(Date)
    }));
    expect(consoleSpy).toHaveBeenCalledWith('[INFO] Test message');
  });

  it('should emit a status-update event with specific type and progress values', () => {
    const message = 'Downloading...';
    const type = 'warning';
    const progress = 50;

    updateStatus(message, type, progress);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('status-update', expect.objectContaining({
      message: message,
      type: type,
      progress: progress,
      timestamp: expect.any(Date)
    }));
    expect(consoleSpy).toHaveBeenCalledWith('[WARNING] Downloading...');
  });

  it('should handle error status types correctly', () => {
    const message = 'An error occurred';
    const type = 'error';

    updateStatus(message, type);

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('status-update', expect.objectContaining({
      message: message,
      type: type,
      progress: null,
      timestamp: expect.any(Date)
    }));
    expect(consoleSpy).toHaveBeenCalledWith('[ERROR] An error occurred');
  });
});
